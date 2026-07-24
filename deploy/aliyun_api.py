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

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import quote, unquote

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
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

HERE = Path(__file__).resolve().parent
PARENT = HERE.parent
for p in (str(HERE), str(PARENT)):
    if p not in sys.path:
        sys.path.insert(0, p)

from pptx_report.cli import _collect_segments
from pptx_report.common.qa import inspect_presentation
from pptx_report.common.visual_qa import run_visual_qa
from pptx_report.build_jd_report import parse_crosstab
from pptx_report.wizard import build_insight_context, build_page_plan, run_wizard
from pptx import Presentation
from pptx_report.template import analyze_template, build_template_mapping
from pptx_report.proposal_deck import DeckValidationError, audit_deck, render_proposal_deck

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
REQUEST_ENVELOPE_MAGIC = b"SKPPTX1\n"
MAX_METADATA_BYTES = 1024 * 1024
JOB_TTL_SECONDS = 2 * 60 * 60
FAILED_JOB_TTL_SECONDS = 30 * 60
MAX_CONCURRENT_JOBS = max(1, int(os.environ.get("PPTX_MAX_CONCURRENT_JOBS", "2")))
SERVICE_INSTANCE_ID = uuid.uuid4().hex
JOB_STATE_LOCK = threading.RLock()
JOB_SEMAPHORE = threading.BoundedSemaphore(MAX_CONCURRENT_JOBS)
JOB_DIR = Path(tempfile.gettempdir()) / "surveykit-ppt-jobs"
JOB_DIR.mkdir(parents=True, exist_ok=True)
TEMPLATE_DIR = Path(tempfile.gettempdir()) / "surveykit-ppt-templates"
TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)
TEMPLATE_TTL_SECONDS = 24 * 60 * 60


def _job_request_data_path(job_id: str) -> Path:
    """Path to the persisted xlsx upload for a job."""
    return JOB_DIR / f"{job_id}.xlsx"


def _job_request_meta_path(job_id: str) -> Path:
    """Path to the persisted request metadata (qs + metadata) for a job."""
    return JOB_DIR / f"{job_id}.meta.json"


def _persist_job_request(job_id: str, data: bytes, qs: dict, metadata: dict) -> None:
    """Save the raw request payload to disk so the job can be recovered after restart."""
    _job_request_data_path(job_id).write_bytes(data)
    _job_request_meta_path(job_id).write_text(
        json.dumps({"qs": qs, "metadata": metadata}, ensure_ascii=False),
        encoding="utf-8",
    )


def _load_job_request(job_id: str) -> tuple[bytes, dict, dict] | None:
    """Load persisted request data for job recovery. Returns (data, qs, metadata) or None."""
    data_path = _job_request_data_path(job_id)
    meta_path = _job_request_meta_path(job_id)
    if not data_path.exists() or not meta_path.exists():
        return None
    try:
        data = data_path.read_bytes()
        meta_payload = json.loads(meta_path.read_text(encoding="utf-8"))
        return data, meta_payload.get("qs", {}), meta_payload.get("metadata", {})
    except (OSError, json.JSONDecodeError):
        return None


def _remove_job_files(job_id: str) -> None:
    _job_state_path(job_id).unlink(missing_ok=True)
    _job_output_path(job_id).unlink(missing_ok=True)
    _job_request_data_path(job_id).unlink(missing_ok=True)
    _job_request_meta_path(job_id).unlink(missing_ok=True)


def _recover_incomplete_jobs() -> None:
    """On startup, re-launch threads for jobs that were queued/running when the service died.

    With multiple uvicorn workers, each worker calls this on boot.  To avoid
    duplicate recovery we skip jobs whose state was updated within the last 15 s
    (meaning another worker already claimed them).
    """
    recovered = 0
    now = time.time()
    for state_path in JOB_DIR.glob("*.json"):
        job_id = state_path.stem
        if not _valid_job_id(job_id):
            continue
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if state.get("status") not in {"queued", "running", "cancel_requested"}:
            continue
        # Skip if another worker already recovered this job moments ago
        if (now - (state.get("updated_at") or 0)) < 15:
            continue
        request_payload = _load_job_request(job_id)
        if request_payload is None:
            _write_job_state(job_id, {
                "status": "lost",
                "progress": 0,
                "message": "服务已重启且无法恢复任务数据，请重新生成。",
                "finished_at": time.time(),
            })
            continue
        data, qs, metadata = request_payload
        if state.get("status") == "cancel_requested":
            _write_job_state(job_id, {
                "status": "cancelled",
                "progress": 0,
                "message": "任务已取消",
                "finished_at": time.time(),
            })
            continue
        _write_job_state(job_id, {
            "status": "queued",
            "progress": 3,
            "message": "服务重启后自动恢复任务，等待执行",
        })
        threading.Thread(
            target=_run_generate_job,
            args=(job_id, data, qs, metadata),
            daemon=True,
            name=f"pptx-job-recover-{job_id[:8]}",
        ).start()
        recovered += 1
    if recovered:
        print(f"[startup] recovered {recovered} incomplete job(s)")
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


def _template_path(template_id: str) -> Path | None:
    if not re.fullmatch(r"[0-9a-f]{32}", str(template_id or "")):
        return None
    path = TEMPLATE_DIR / f"{template_id}.pptx"
    return path if path.exists() else None


def _template_profile_path(template_id: str) -> Path:
    return TEMPLATE_DIR / f"{template_id}.json"


def _read_template_profile(template_id: str) -> dict | None:
    if not re.fullmatch(r"[0-9a-f]{32}", str(template_id or "")):
        return None
    try:
        payload = json.loads(_template_profile_path(template_id).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _write_template_profile(template_id: str, profile: dict) -> None:
    _template_profile_path(template_id).write_text(
        json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8"
    )
def _cleanup_templates() -> None:
    cutoff = time.time() - TEMPLATE_TTL_SECONDS
    for path in TEMPLATE_DIR.glob("*.pptx"):
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
                _template_profile_path(path.stem).unlink(missing_ok=True)
        except OSError:
            pass


@app.post("/api/pptx-report/templates")
async def upload_template(request: Request):
    """上传并分析公司 PPTX 模板，返回 24 小时有效的模板 ID。"""
    _cleanup_templates()
    data = await request.body()
    if not data:
        return JSONResponse({"error": {"message": "模板文件为空。"}}, status_code=400)
    if len(data) > MAX_UPLOAD_BYTES:
        return JSONResponse({"error": {"message": "模板文件过大（>25MB）。"}}, status_code=413)
    template_id = uuid.uuid4().hex
    path = TEMPLATE_DIR / f"{template_id}.pptx"
    path.write_bytes(data)
    filename = unquote(request.headers.get("X-Template-Name") or "company-template.pptx")
    try:
        analysis = analyze_template(str(path), filename=filename[:120])
        roles = analysis.get("mapping", {}).get("roles", {})
        profile = {
            "template_id": template_id,
            "name": filename[:120],
            "version": 1,
            "roles": roles,
            "theme_tokens": {
                "colors": analysis.get("theme_colors", []),
                "fonts": analysis.get("fonts", []),
            },
            "font_mapping": {},
            "safe_zones": {
                role: (item.get("zones") or {}) for role, item in roles.items()
            },
            "created_at": time.time(),
        }
        _write_template_profile(template_id, profile)
        return JSONResponse({
            "template_id": template_id,
            "expires_in": TEMPLATE_TTL_SECONDS,
            "profile": profile,
            "recommended_roles": {
                role: int(item.get("slide_index", 0)) + 1
                for role, item in roles.items()
            },
            "role_confidence": {
                role: item.get("confidence", 0) for role, item in roles.items()
            },
            **analysis,
        }, headers={"Cache-Control": "no-store"})
    except Exception as exc:  # noqa: BLE001
        try:
            path.unlink()
        except OSError:
            pass
        return JSONResponse({"error": {"message": f"模板解析失败：{exc}"}}, status_code=400)


@app.delete("/api/pptx-report/templates/{template_id}")
def delete_template(template_id: str):
    """提前删除用户上传的临时模板；找不到时也按删除成功处理。"""
    path = _template_path(template_id)
    if path is not None:
        try:
            path.unlink()
            _template_profile_path(template_id).unlink(missing_ok=True)
        except OSError as exc:
            return JSONResponse({"error": {"message": f"模板删除失败：{exc}"}}, status_code=500)
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@app.get("/api/pptx-report/templates/{template_id}/profile")
def get_template_profile(template_id: str):
    if _template_path(template_id) is None:
        return JSONResponse({"error": {"message": "模板不存在或已过期。"}}, status_code=404)
    profile = _read_template_profile(template_id)
    if profile is None:
        return JSONResponse({"error": {"message": "模板 Profile 不存在。"}}, status_code=404)
    return JSONResponse(profile, headers={"Cache-Control": "no-store"})


@app.put("/api/pptx-report/templates/{template_id}/profile")
async def update_template_profile(template_id: str, request: Request):
    path = _template_path(template_id)
    if path is None:
        return JSONResponse({"error": {"message": "模板不存在或已过期。"}}, status_code=404)
    raw = await request.body()
    if len(raw) > MAX_METADATA_BYTES:
        return JSONResponse({"error": {"message": "Profile JSON 不能超过 1MB。"}}, status_code=413)
    try:
        incoming = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return JSONResponse({"error": {"message": "Profile JSON 无效。"}}, status_code=400)
    raw_overrides = incoming.get("roles") if isinstance(incoming, dict) else None
    if not isinstance(raw_overrides, dict):
        return JSONResponse({"error": {"message": "Profile 必须包含 roles 对象。"}}, status_code=400)
    allowed = {"cover", "toc", "summary", "section", "chart", "matrix", "appendix", "content"}
    overrides = {}
    for role, value in raw_overrides.items():
        if role not in allowed:
            continue
        try:
            if isinstance(value, dict):
                if value.get("slide_index") is None:
                    continue
                page_number = int(value["slide_index"]) + 1
            else:
                page_number = int(value)
        except (TypeError, ValueError):
            continue
        if page_number > 0:
            overrides[role] = page_number
    mapping = build_template_mapping(Presentation(str(path)), role_overrides=overrides)
    confirmed = {
        role: item for role, item in mapping.get("roles", {}).items()
        if role in overrides and item.get("user_confirmed")
    }
    if not confirmed:
        return JSONResponse({"error": {"message": "未找到有效的页面角色覆盖。"}}, status_code=400)
    base = _read_template_profile(template_id) or {}
    profile = {
        **base,
        "template_id": template_id,
        "name": str(incoming.get("name") or base.get("name") or "template.pptx")[:120],
        "version": int(base.get("version") or 1) + 1,
        "roles": {**(base.get("roles") or {}), **confirmed},
        "theme_tokens": dict(incoming.get("theme_tokens"))
        if isinstance(incoming.get("theme_tokens"), dict)
        else dict(base.get("theme_tokens") or {}),
        "font_mapping": dict(incoming.get("font_mapping"))
        if isinstance(incoming.get("font_mapping"), dict)
        else dict(base.get("font_mapping") or {}),
        "updated_at": time.time(),
    }
    profile["safe_zones"] = {
        role: (item.get("zones") or {}) for role, item in profile["roles"].items()
    }
    _write_template_profile(template_id, profile)
    return JSONResponse(profile, headers={"Cache-Control": "no-store"})

@app.get("/healthz")
def healthz():
    return {"ok": True, "service": "pptx-report"}


def _proposal_project_guard(request: Request, deck: dict) -> JSONResponse | None:
    """Project-scoped guard used until SurveyKit adds a real login backend."""
    header_project = str(request.headers.get("X-Project-Id") or "").strip()
    deck_project = str(deck.get("project_id") or "").strip()
    if not header_project or not deck_project or header_project != deck_project:
        return JSONResponse(
            {"error": {"message": "无权访问该项目的 PPT 方案。"}},
            status_code=403,
            headers={"Cache-Control": "no-store"},
        )
    return None


@app.post("/api/pptx-report/proposal-deck/validate")
async def validate_proposal_deck(request: Request):
    try:
        deck = await request.json()
    except Exception:  # noqa: BLE001
        return JSONResponse({"error": {"message": "Deck JSON 格式无效。"}}, status_code=400)
    guard = _proposal_project_guard(request, deck if isinstance(deck, dict) else {})
    if guard:
        return guard
    try:
        return JSONResponse(audit_deck(deck), headers={"Cache-Control": "no-store"})
    except DeckValidationError as exc:
        return JSONResponse({"error": {"message": str(exc)}}, status_code=400)


@app.post("/api/pptx-report/proposal-deck")
async def generate_proposal_deck(request: Request):
    try:
        deck = await request.json()
    except Exception:  # noqa: BLE001
        return JSONResponse({"error": {"message": "Deck JSON 格式无效。"}}, status_code=400)
    guard = _proposal_project_guard(request, deck if isinstance(deck, dict) else {})
    if guard:
        return guard
    tmp_out = tempfile.NamedTemporaryFile(delete=False, suffix=".pptx")
    tmp_out.close()
    try:
        audit = render_proposal_deck(deck, tmp_out.name)
        if not audit.get("ok"):
            return JSONResponse(
                {"error": {"message": "Deck JSON 未通过质量检查。", "issues": audit.get("issues", [])}},
                status_code=400,
            )
        content = Path(tmp_out.name).read_bytes()
        filename = _safe_title(audit["deck"].get("title") or "AI调研方案") + ".pptx"
        utf8_name = quote(filename.encode("utf-8"))
        return Response(
            content,
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            headers={
                "Content-Disposition": f'attachment; filename="proposal.pptx"; filename*=UTF-8\'\'{utf8_name}',
                "Cache-Control": "no-store",
                "X-Deck-Issue-Count": str(len(audit.get("issues", []))),
            },
        )
    except DeckValidationError as exc:
        return JSONResponse({"error": {"message": str(exc)}}, status_code=400)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": {"message": f"PPT 导出失败：{exc}"}}, status_code=500)
    finally:
        try:
            os.unlink(tmp_out.name)
        except OSError:
            pass


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


def _office_converter() -> str | None:
    return shutil.which("libreoffice") or shutil.which("soffice")


@app.post("/api/pptx-report/preview-render")
async def preview_render(request: Request):
    body = await request.body()
    try:
        data, metadata = _unpack_generate_request(body, request.headers.get("content-type", ""))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        return JSONResponse({"error": {"message": f"请求格式错误：{exc}"}}, status_code=400)
    raw_pages = metadata.get("pages") or [1]
    try:
        pages = sorted({int(page) for page in raw_pages if 0 < int(page) <= 200})[:3]
    except (TypeError, ValueError):
        return JSONResponse({"error": {"message": "pages 必须是 1-200 的页码数组。"}}, status_code=400)
    if not pages:
        return JSONResponse({"error": {"message": "请至少选择一页进行预览。"}}, status_code=400)
    converter = _office_converter()
    if not converter:
        return JSONResponse(
            {"error": {"message": "服务器未安装 LibreOffice，暂时无法生成真实页面预览。"}},
            status_code=503,
        )
    response = _generate_core(
        data, request.query_params, metadata, preview_page_numbers=pages
    )
    if response.status_code >= 400:
        return response
    with tempfile.TemporaryDirectory(prefix="surveykit-ppt-preview-") as temp_dir:
        pptx_path = Path(temp_dir) / "preview.pptx"
        pptx_path.write_bytes(response.body)
        completed = subprocess.run(
            [converter, "--headless", "--convert-to", "pdf", "--outdir", temp_dir, str(pptx_path)],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        pdf_path = Path(temp_dir) / "preview.pdf"
        if completed.returncode != 0 or not pdf_path.exists():
            detail = (completed.stderr or completed.stdout or "转换失败").strip()[-500:]
            return JSONResponse({"error": {"message": f"页面预览转换失败：{detail}"}}, status_code=500)
        content = pdf_path.read_bytes()
    return Response(
        content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'inline; filename="surveykit-preview.pdf"',
            "Cache-Control": "no-store",
            "X-Preview-Pages": ",".join(str(page) for page in pages),
        },
    )

@app.post("/api/pptx-report/insight-context")
async def insight_context(request: Request):
    """返回 AI 写报告所需的逐页聚合证据，不传输原始答卷。"""
    body = await request.body()
    try:
        data, metadata = _unpack_generate_request(
            body, request.headers.get("content-type", "")
        )
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        return JSONResponse(
            {"error": {"message": f"请求格式错误：{exc}"}}, status_code=400
        )
    if len(data) > MAX_UPLOAD_BYTES:
        return JSONResponse({"error": {"message": "文件过大（>25MB）。"}}, status_code=413)
    page_config = metadata.get("page_config")
    if not isinstance(page_config, dict) or not page_config.get("pages"):
        return JSONResponse(
            {"error": {"message": "请先生成并确认报告页面结构。"}}, status_code=400
        )
    tmp = _write_temp(data, ".xlsx")
    try:
        questions = parse_crosstab(tmp)
        context = build_insight_context(
            questions,
            page_config,
            source=str(metadata.get("source") or ""),
        )
        return JSONResponse(context, headers={"Cache-Control": "no-store"})
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(
            {"error": {"message": f"AI 数据证据生成失败：{exc}"}}, status_code=500
        )
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def _generate_core(
    data: bytes,
    qs,
    metadata: dict | None = None,
    progress_callback=None,
    preview_page_numbers: list[int] | None = None,
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
    template_id = metadata.get("template_id") or qs.get("template_id") or ""
    template_path = _template_path(str(template_id)) if template_id else None
    template_profile = _read_template_profile(str(template_id)) if template_id else None
    if template_id and template_path is None:
        return JSONResponse(
            {"error": {"message": "上传模板不存在或已过期，请重新上传模板。"}},
            status_code=400,
        )
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
            date=time.strftime("%Y-%m-%d"),
            segments=segs,
            dimension=dimension,
            max_per_page=3,
            page_config=page_config,
            theme_key=theme_key,
            template_path=str(template_path) if template_path else None,
            template_mapping={
                "version": 2,
                "mode": "confirmed-layout-zones",
                "roles": template_profile.get("roles", {}),
            } if template_profile and template_profile.get("roles") else None,
            preview_page_numbers=preview_page_numbers,
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


def _read_job_state(job_id: str) -> dict | None:
    if not _valid_job_id(job_id):
        return None
    for _ in range(4):
        try:
            return json.loads(_job_state_path(job_id).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            time.sleep(0.01)
    return None


def _write_job_state(job_id: str, payload: dict) -> dict:
    target = _job_state_path(job_id)
    with JOB_STATE_LOCK:
        current = {}
        try:
            current = json.loads(target.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            pass
        protected_cancel = (
            current.get("status") in {"cancel_requested", "cancelled"}
            and payload.get("status") in {"queued", "running", "ready"}
        )
        if protected_cancel:
            payload = {**payload, "status": current.get("status"), "message": current.get("message", "正在取消任务")}
        merged = {
            **current,
            **payload,
            "job_id": job_id,
            "updated_at": time.time(),
            "service_instance_id": SERVICE_INSTANCE_ID,
        }
        temporary = target.with_name(f"{job_id}.{uuid.uuid4().hex}.tmp")
        temporary.write_text(json.dumps(merged, ensure_ascii=False), encoding="utf-8")
        try:
            for attempt in range(20):
                try:
                    os.replace(temporary, target)
                    return merged
                except PermissionError:
                    if attempt == 19:
                        raise
                    time.sleep(0.02)
        finally:
            temporary.unlink(missing_ok=True)
    return merged


def _cleanup_jobs() -> None:
    now = time.time()
    for state_path in JOB_DIR.glob("*.json"):
        if not _valid_job_id(state_path.stem):
            # Skip .meta.json and other non-state files; remove orphans
            if state_path.suffix == ".json" and state_path.stem.endswith(".meta"):
                job_id = state_path.stem[: -len(".meta")]
                if not _job_state_path(job_id).exists():
                    state_path.unlink(missing_ok=True)
                    _job_request_data_path(job_id).unlink(missing_ok=True)
            continue
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
            ttl = FAILED_JOB_TTL_SECONDS if state.get("status") in {"failed", "cancelled", "lost"} else JOB_TTL_SECONDS
            if state_path.stat().st_mtime >= now - ttl:
                continue
            _remove_job_files(state_path.stem)
        except (OSError, json.JSONDecodeError):
            pass


def _request_fingerprint(data: bytes, qs: dict, metadata: dict, client_id: str) -> str:
    digest = hashlib.sha256()
    digest.update(client_id.encode("utf-8"))
    digest.update(data)
    digest.update(json.dumps(qs, sort_keys=True, ensure_ascii=False).encode("utf-8"))
    digest.update(json.dumps(metadata, sort_keys=True, ensure_ascii=False).encode("utf-8"))
    return digest.hexdigest()


def _find_active_duplicate(client_id: str, fingerprint: str) -> dict | None:
    if not client_id:
        return None
    for state_path in JOB_DIR.glob("*.json"):
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if (
            state.get("client_id") == client_id
            and state.get("request_fingerprint") == fingerprint
            and state.get("status") in {"queued", "running"}
            and state.get("service_instance_id") == SERVICE_INSTANCE_ID
        ):
            return state
    return None


class JobCancelled(RuntimeError):
    pass


def _raise_if_cancelled(job_id: str) -> None:
    state = _read_job_state(job_id) or {}
    if state.get("status") in {"cancel_requested", "cancelled"}:
        raise JobCancelled("任务已取消")


def _run_generate_job(job_id: str, data: bytes, qs: dict, metadata: dict) -> None:
    def progress(percent, message):
        _raise_if_cancelled(job_id)
        _write_job_state(job_id, {
            "status": "running",
            "progress": max(1, min(97, int(percent))),
            "message": str(message or "正在生成报告"),
        })
        _raise_if_cancelled(job_id)

    try:
        with JOB_SEMAPHORE:
            _raise_if_cancelled(job_id)
            _write_job_state(job_id, {
                "status": "running",
                "started_at": time.time(),
                "progress": 6,
                "message": "任务开始执行",
            })
            progress(8, "文件上传完成")
            response = _generate_core(data, qs, metadata, progress_callback=progress)
            if response.status_code >= 400:
                try:
                    error_payload = json.loads(response.body.decode("utf-8"))
                    message = error_payload.get("error", {}).get("message") or "生成失败"
                except Exception:  # noqa: BLE001
                    message = "生成失败"
                raise RuntimeError(message)
            _raise_if_cancelled(job_id)
            output = _job_output_path(job_id)
            output.write_bytes(response.body)
            try:
                qa = inspect_presentation(output).to_dict()
            except Exception as qa_exc:  # noqa: BLE001
                qa = {
                    "slide_count": 0,
                    "checked_shapes": 0,
                    "issues": [{"level": "warning", "code": "qa_inspection_failed", "message": str(qa_exc)}],
                    "score": 0,
                    "ok": False,
                }
            visual_qa = {
                "status": "skipped",
                "checked_slides": 0,
                "issues": [],
                "score": 100,
                "reason": "visual QA disabled",
                "ok": True,
                "error_count": 0,
                "warning_count": 0,
            }
            if os.environ.get("PPTX_VISUAL_QA_MODE", "auto").lower() != "disabled":
                progress(98, "正在进行页面视觉质检")
                visual_qa = run_visual_qa(output).to_dict()
            overall_score = int(qa.get("score", 0))
            if visual_qa.get("status") == "completed":
                overall_score = round(overall_score * 0.75 + int(visual_qa.get("score", 0)) * 0.25)
            _write_job_state(job_id, {
                "status": "ready",
                "progress": 100,
                "message": "报告已生成，可下载",
                "filename": _safe_title(metadata.get("title") or qs.get("title") or "调研分析报告") + ".pptx",
                "size": len(response.body),
                "finished_at": time.time(),
                "qa": qa,
                "visual_qa": visual_qa,
                "overall_score": overall_score,
            })
            _raise_if_cancelled(job_id)
    except JobCancelled:
        _job_output_path(job_id).unlink(missing_ok=True)
        _write_job_state(job_id, {
            "status": "cancelled",
            "progress": 0,
            "message": "任务已取消",
            "finished_at": time.time(),
        })
    except Exception as exc:  # noqa: BLE001
        _write_job_state(job_id, {
            "status": "failed",
            "progress": 0,
            "message": str(exc),
            "finished_at": time.time(),
        })


@app.post("/api/pptx-report/jobs")
async def create_generate_job(request: Request):
    _cleanup_jobs()
    body = await request.body()
    try:
        data, metadata = _unpack_generate_request(body, request.headers.get("content-type", ""))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        return JSONResponse({"error": {"message": f"请求格式错误：{exc}"}}, status_code=400)
    if len(data) > MAX_UPLOAD_BYTES:
        return JSONResponse({"error": {"message": "文件过大（最大25MB）。"}}, status_code=413)
    client_id = str(request.headers.get("x-surveykit-client-id") or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.-]{8,128}", client_id):
        client_id = ""
    qs = dict(request.query_params)
    fingerprint = _request_fingerprint(data, qs, metadata, client_id) if client_id else ""
    job_id = uuid.uuid4().hex
    _persist_job_request(job_id, data, qs, metadata)
    with JOB_STATE_LOCK:
        duplicate = _find_active_duplicate(client_id, fingerprint)
        if duplicate:
            _remove_job_files(job_id)
            return JSONResponse({**duplicate, "deduplicated": True}, status_code=202)
        state = _write_job_state(job_id, {
            "status": "queued",
            "progress": 3,
            "message": "任务已创建，等待执行",
            "created_at": time.time(),
            "started_at": None,
            "finished_at": None,
            "client_id": client_id,
            "request_fingerprint": fingerprint,
        })
    threading.Thread(
        target=_run_generate_job,
        args=(job_id, data, qs, metadata),
        daemon=True,
        name=f"pptx-job-{job_id[:8]}",
    ).start()
    return JSONResponse(state, status_code=202)


JOB_STALE_TIMEOUT_SECONDS = 5 * 60


@app.get("/api/pptx-report/jobs/{job_id}")
def get_generate_job(job_id: str):
    state = _read_job_state(job_id)
    if state is None:
        return JSONResponse({"error": {"message": "生成任务不存在或已过期。"}}, status_code=404, headers={"Cache-Control": "no-store"})
    # Detect stuck jobs: if queued/running but not updated for a long time, the
    # executing thread likely died (OOM / crash).  Attempt recovery from persisted data.
    if state.get("status") in {"queued", "running"}:
        updated_at = state.get("updated_at") or 0
        stale = (time.time() - updated_at) > JOB_STALE_TIMEOUT_SECONDS
        if stale:
            request_payload = _load_job_request(job_id)
            if request_payload is not None:
                data, qs, metadata = request_payload
                _write_job_state(job_id, {
                    "status": "queued",
                    "progress": 3,
                    "message": "检测到任务停滞，自动恢复执行",
                })
                threading.Thread(
                    target=_run_generate_job,
                    args=(job_id, data, qs, metadata),
                    daemon=True,
                    name=f"pptx-job-recover-{job_id[:8]}",
                ).start()
                state = _read_job_state(job_id)
            else:
                state = _write_job_state(job_id, {
                    "status": "lost",
                    "progress": 0,
                    "message": "任务执行超时且无法恢复，请重新生成。",
                    "finished_at": time.time(),
                })
    elif state.get("status") == "cancel_requested":
        updated_at = state.get("updated_at") or 0
        if (time.time() - updated_at) > 60:
            state = _write_job_state(job_id, {
                "status": "cancelled",
                "progress": 0,
                "message": "任务已取消",
                "finished_at": time.time(),
            })
    return JSONResponse(state, headers={"Cache-Control": "no-store"})


@app.post("/api/pptx-report/jobs/{job_id}/cancel")
def cancel_generate_job(job_id: str):
    state = _read_job_state(job_id)
    if state is None:
        return JSONResponse({"error": {"message": "生成任务不存在或已过期。"}}, status_code=404)
    if state.get("status") in {"ready", "failed", "cancelled", "lost"}:
        return JSONResponse(state, headers={"Cache-Control": "no-store"})
    state = _write_job_state(job_id, {
        "status": "cancel_requested",
        "message": "正在取消任务",
    })
    return JSONResponse(state, status_code=202, headers={"Cache-Control": "no-store"})


@app.get("/api/pptx-report/jobs/{job_id}/download")
def download_generate_job(job_id: str, delete_after: bool = False):
    state = _read_job_state(job_id)
    output = _job_output_path(job_id)
    if state is None or state.get("status") != "ready" or not output.exists():
        return JSONResponse({"error": {"message": "报告尚未生成完成或已过期。"}}, status_code=404)
    filename = state.get("filename") or "report.pptx"
    utf8_name = quote(str(filename).encode("utf-8"))
    background = BackgroundTask(_remove_job_files, job_id) if delete_after else None
    return FileResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        filename="report.pptx",
        background=background,
        headers={
            "Content-Disposition": f'attachment; filename="report.pptx"; filename*=UTF-8\'\'{utf8_name}',
            "Cache-Control": "no-store",
        },
    )

@app.on_event("startup")
def _startup_recover_jobs():
    """Recover incomplete jobs after service restart."""
    _recover_incomplete_jobs()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
