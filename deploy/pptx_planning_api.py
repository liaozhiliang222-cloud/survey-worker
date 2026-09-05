"""Isolated HTTP process for the existing PPT parse and structure preview routes.

Reuse the exact handlers without mounting the rendering app or its job recovery
lifespan. Heavy rendering and its cross-process lock cannot block this worker.
"""
from fastapi import FastAPI

try:
    from .aliyun_api import parse, preview, _release_info
except ImportError:  # uvicorn launched from deploy/ in production
    from aliyun_api import parse, preview, _release_info

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.add_api_route("/api/pptx-report/parse", parse, methods=["POST"])
app.add_api_route("/api/pptx-report/preview", preview, methods=["POST"])


@app.get("/healthz")
def healthz():
    return {"ok": True, "service": "pptx-planning", "release": _release_info()}
