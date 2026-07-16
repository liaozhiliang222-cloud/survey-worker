"""阿里云 ECS 上的 Python-PPTX API 服务（FastAPI）。

本服务独立于前端运行：前端托管在 Cloudflare Pages，通过 Cloudflare Function
（`functions/api/pptx-report*`）把请求代理转发到本服务的公网地址。

与前端约定的契约（和本地 server.js 代理完全一致，前端零改动）：
  - 文件：POST 请求体 = 原始 .xlsx 字节（Content-Type: application/octet-stream）
  - 参数：放在 query string 中
        segments   : JSON 数组字符串，如 '["Total","都市中产"]'（空/[] => 全部人群）
        title      : 报告标题
        dimension  : 维度分组名（多级表头文件），如「购买」「4K+」；可为空
        page_config: 前端编辑后的页面规划 JSON（确认生成时附带）

端点：
  GET  /healthz
  POST /api/pptx-report/parse          -> {segments, questions, dimension_groups}
  POST /api/pptx-report/preview?<qs>   -> 页面规划 JSON
  POST /api/pptx-report[?<qs>]         -> .pptx 文件流（attachment 下载）
"""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import quote

# 确保运行日志中的中文 debug print 不会因 stdout 编码非 UTF-8 而崩溃
# （Windows 默认控制台编码 / 部分 Linux 容器 locale 非 utf-8 时会触发 latin-1 报错）
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

HERE = Path(__file__).resolve().parent
PARENT = HERE.parent
for p in (str(HERE), str(PARENT)):
    if p not in sys.path:
        sys.path.insert(0, p)

from pptx_report.cli import _collect_segments
from pptx_report.build_jd_report import parse_crosstab
from pptx_report.wizard import build_page_plan, run_wizard

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
REQUEST_ENVELOPE_MAGIC = b"SKPPTX1\n"
MAX_METADATA_BYTES = 1024 * 1024
JOB_TTL_SECONDS = 2 * 60 * 60
JOB_DIR = Path(tempfile.gettempdir()) / "surveykit-ppt-jobs"
JOB_DIR.mkdir(parents=True, exist_ok=True)
app = FastAPI(title="PPTX Report API")

# CORS：允许前端域名（surveykit.cc）和本地开发直连阿里云
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://surveykit.cc",
        "https://aiwiki.surveykit.cc",
        "http://localhost:4281",
        "*",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _read_segments(s: str | None):
    """解析前端传来的 segments 查询参数。None/[]/空 => 展示全部人群。"""
    if not s or s in ("[]", "null"):
        return None
    try:
        arr = json.loads(s)
        if isinstance(arr, list):
            return [str(x) for x in arr]
    except Exception:
        pass
    return None


def _safe_title(t: str) -> str:
    t = (t or "调研分析报告").strip()
    return re.sub(r'[\\/:*?"<>|]', "_", t)[:60] or "调研分析报告"


def _write_temp(data: bytes, suffix: str) -> str:
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp.write(data)
    tmp.close()
    return tmp.name


@app.get("/healthz")
def healthz():
    return {"ok": True, "service": "pptx-report"}


@app.post("/api/pptx-report/parse")
async def parse(request: Request):
    data = await request.body()
    if len(data) > MAX_UPLOAD_BYTES:
        return JSONResponse({"error": {"message": "文件过大（>25MB）。"}}, status_code=413)
    tmp = _write_temp(data, ".xlsx")
    try:
        result = _collect_segments(tmp)
        return JSONResponse(result)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": {"message": f"解析失败：{exc}"}}, status_code=500)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


@app.post("/api/pptx-report/preview")
async def preview(request: Request):
    data = await request.body()
    if len(data) > MAX_UPLOAD_BYTES:
        return JSONResponse({"error": {"message": "文件过大（>25MB）。"}}, status_code=413)
    qs = request.query_params
    segs = _read_segments(qs.get("segments"))
    title = qs.get("title") or "调研分析报告"
    dimension = qs.get("dimension") or None
    tmp = _write_temp(data, ".xlsx")
    try:
        questions = parse_crosstab(tmp)
        plan = build_page_plan(questions, title=title, segments=segs, dimension=dimension)
        return JSONResponse(plan)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": {"message": f"预览失败：{exc}"}}, status_code=500)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def _unpack_generate_request(data: bytes, content_type: str) -> tuple[bytes, dict]:
    """Unpack the binary request envelope used by the web client.

    Legacy clients still send raw XLSX bytes and query parameters. The envelope
    keeps large page plans out of the request URL so Nginx does not reject them.
    """
    if not (content_type or "").lower().startswith("application/vnd.surveykit.pptx-request"):
        return data, {}
    header_size = len(REQUEST_ENVELOPE_MAGIC) + 4
    if len(data) < header_size or not data.startswith(REQUEST_ENVELOPE_MAGIC):
        raise ValueError("invalid PPTX request envelope")
    meta_size = int.from_bytes(data[len(REQUEST_ENVELOPE_MAGIC):header_size], "big")
    if meta_size <= 0 or meta_size > MAX_METADATA_BYTES or header_size + meta_size > len(data):
        raise ValueError("invalid PPTX request metadata length")
    metadata = json.loads(data[header_size:header_size + meta_size].decode("utf-8"))
    if not isinstance(metadata, dict):
        raise ValueError("PPTX request metadata must be an object")
    return data[header_size + meta_size:], metadata


def _generate_core(
    data: bytes,
    qs,
    metadata: dict | None = None,
    progress_callback=None,
) -> Response | JSONResponse:
    if len(data) > MAX_UPLOAD_BYTES:
        return JSONResponse({"error": {"message": "文件过大（>25MB）。"}}, status_code=413)
    metadata = metadata or {}
    raw_segments = metadata.get("segments")
    if isinstance(raw_segments, list):
        segs = [str(item) for item in raw_segments]
    else:
        segs = _read_segments(qs.get("segments"))
    title = metadata.get("title") or qs.get("title") or "调研分析报告"
    dimension = metadata.get("dimension") or qs.get("dimension") or None
    page_config = metadata.get("page_config")
    theme_key = metadata.get("theme") or qs.get("theme") or "blue"
    pc = qs.get("page_config") if page_config is None else None
    if pc:
        try:
            page_config = json.loads(pc)
        except Exception:
            page_config = None
    tmp_in = _write_temp(data, ".xlsx")
    tmp_out = tempfile.NamedTemporaryFile(delete=False, suffix=".pptx")
    tmp_out.close()
    try:
        run_wizard(
            tmp_in,
            tmp_out.name,
            title=title,
            client="调研项目",
            segments=segs,
            dimension=dimension,
            max_per_page=3,
            page_config=page_config,
            theme_key=theme_key,
            progress_callback=progress_callback,
        )
        with open(tmp_out.name, "rb") as f:
            content = f.read()
        # RFC 6266：HTTP 头值必须是 latin-1，中文文件名需用 filename* (UTF-8 百分号编码)，
        # 同时给一个 ASCII 回退名，避免 Starlette 编码中文头值时报错。
        ts = time.strftime("%Y%m%d_%H%M%S")
        ascii_name = f"report_{ts}.pptx"
        utf8_name = quote((_safe_title(title) + ".pptx").encode("utf-8"))
        return Response(
            content,
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            headers={
                "Content-Disposition": f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{utf8_name}',
                "Cache-Control": "no-store",
            },
        )
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": {"message": f"生成失败：{exc}"}}, status_code=500)
    finally:
        for p in (tmp_in, tmp_out.name):
            try:
                os.unlink(p)
            except OSError:
                pass


@app.post("/api/pptx-report")
async def generate(request: Request):
    body = await request.body()
    try:
        data, metadata = _unpack_generate_request(body, request.headers.get("content-type", ""))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        return JSONResponse({"error": {"message": f"请求格式错误：{exc}"}}, status_code=400)
    return _generate_core(data, request.query_params, metadata)


@app.post("/api/pptx-report/")
async def generate_slash(request: Request):
    body = await request.body()
    try:
        data, metadata = _unpack_generate_request(body, request.headers.get("content-type", ""))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        return JSONResponse({"error": {"message": f"请求格式错误：{exc}"}}, status_code=400)
    return _generate_core(data, request.query_params, metadata)


def _job_state_path(job_id: str) -> Path:
    return JOB_DIR / f"{job_id}.json"


def _job_output_path(job_id: str) -> Path:
    return JOB_DIR / f"{job_id}.pptx"


def _valid_job_id(job_id: str) -> bool:
    return bool(re.fullmatch(r"[0-9a-f]{32}", job_id or ""))


def _write_job_state(job_id: str, payload: dict) -> None:
    payload = {**payload, "job_id": job_id, "updated_at": time.time()}
    target = _job_state_path(job_id)
    temporary = target.with_name(f"{job_id}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    try:
        for attempt in range(20):
            try:
                os.replace(temporary, target)
                return
            except PermissionError:
                if attempt == 19:
                    raise
                time.sleep(0.02)
    finally:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass


def _read_job_state(job_id: str) -> dict | None:
    if not _valid_job_id(job_id):
        return None
    for _ in range(4):
        try:
            return json.loads(_job_state_path(job_id).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            time.sleep(0.01)
    return None


def _cleanup_jobs() -> None:
    cutoff = time.time() - JOB_TTL_SECONDS
    for state_path in JOB_DIR.glob("*.json"):
        try:
            if state_path.stat().st_mtime >= cutoff:
                continue
            job_id = state_path.stem
            state_path.unlink(missing_ok=True)
            _job_output_path(job_id).unlink(missing_ok=True)
        except OSError:
            pass


def _run_generate_job(job_id: str, data: bytes, qs: dict, metadata: dict) -> None:
    def progress(percent, message):
        try:
            _write_job_state(
                job_id,
                {
                    "status": "running",
                    "progress": max(1, min(97, int(percent))),
                    "message": str(message or "正在生成报告"),
                },
            )
        except OSError:
            # 进度展示属于旁路能力，状态文件被短暂占用时不能中断 PPT 生成。
            pass

    try:
        progress(8, "文件上传完成")
        response = _generate_core(data, qs, metadata, progress_callback=progress)
        if response.status_code >= 400:
            try:
                error_payload = json.loads(response.body.decode("utf-8"))
                message = error_payload.get("error", {}).get("message") or "生成失败"
            except Exception:  # noqa: BLE001
                message = "生成失败"
            raise RuntimeError(message)
        _job_output_path(job_id).write_bytes(response.body)
        _write_job_state(
            job_id,
            {
                "status": "ready",
                "progress": 96,
                "message": "报告已生成，正在准备下载",
                "filename": _safe_title(metadata.get("title") or qs.get("title") or "调研分析报告") + ".pptx",
                "size": len(response.body),
            },
        )
    except Exception as exc:  # noqa: BLE001
        _write_job_state(
            job_id,
            {"status": "failed", "progress": 0, "message": str(exc)},
        )


@app.post("/api/pptx-report/jobs")
async def create_generate_job(request: Request):
    _cleanup_jobs()
    body = await request.body()
    try:
        data, metadata = _unpack_generate_request(body, request.headers.get("content-type", ""))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        return JSONResponse({"error": {"message": f"请求格式错误：{exc}"}}, status_code=400)
    if len(data) > MAX_UPLOAD_BYTES:
        return JSONResponse({"error": {"message": "文件过大（>25MB）。"}}, status_code=413)
    job_id = uuid.uuid4().hex
    _write_job_state(
        job_id,
        {"status": "queued", "progress": 3, "message": "任务已创建"},
    )
    worker = threading.Thread(
        target=_run_generate_job,
        args=(job_id, data, dict(request.query_params), metadata),
        daemon=True,
        name=f"pptx-job-{job_id[:8]}",
    )
    worker.start()
    return JSONResponse(
        {"job_id": job_id, "status": "queued", "progress": 3, "message": "任务已创建"},
        status_code=202,
    )


@app.get("/api/pptx-report/jobs/{job_id}")
def get_generate_job(job_id: str):
    state = _read_job_state(job_id)
    if state is None:
        return JSONResponse(
            {"error": {"message": "生成任务不存在或已过期。"}},
            status_code=404,
            headers={"Cache-Control": "no-store"},
        )
    return JSONResponse(state, headers={"Cache-Control": "no-store"})


@app.get("/api/pptx-report/jobs/{job_id}/download")
def download_generate_job(job_id: str):
    state = _read_job_state(job_id)
    output = _job_output_path(job_id)
    if state is None or state.get("status") != "ready" or not output.exists():
        return JSONResponse({"error": {"message": "报告尚未生成完成或已过期。"}}, status_code=404)
    filename = state.get("filename") or "report.pptx"
    utf8_name = quote(str(filename).encode("utf-8"))
    return Response(
        output.read_bytes(),
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={
            "Content-Disposition": f'attachment; filename="report.pptx"; filename*=UTF-8\'\'{utf8_name}',
            "Cache-Control": "no-store",
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
