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
import time
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


def _generate_core(data: bytes, qs) -> Response | JSONResponse:
    if len(data) > MAX_UPLOAD_BYTES:
        return JSONResponse({"error": {"message": "文件过大（>25MB）。"}}, status_code=413)
    segs = _read_segments(qs.get("segments"))
    title = qs.get("title") or "调研分析报告"
    dimension = qs.get("dimension") or None
    page_config = None
    pc = qs.get("page_config")
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
    data = await request.body()
    return _generate_core(data, request.query_params)


@app.post("/api/pptx-report/")
async def generate_slash(request: Request):
    data = await request.body()
    return _generate_core(data, request.query_params)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
