from __future__ import annotations

import os
from pathlib import Path
import sys
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deploy import aliyun_api as api


with patch.dict(
    os.environ,
    {
        "SURVEYKIT_RELEASE": "backend-1",
        "SURVEYKIT_COMMIT": "abc123",
        "SURVEYKIT_DEPLOYED_AT": "2026-08-23T10:00:00Z",
    },
):
    response = TestClient(api.app).get("/healthz")

assert response.status_code == 200
assert response.headers["cache-control"] == "no-store"
assert response.headers["x-surveykit-service"] == "pptx-report"
payload = response.json()
assert payload["ok"] is True
assert payload["service"] == "pptx-report"
assert payload["release"] == {
    "version": "backend-1",
    "revision": "abc123",
    "deployed_at": "2026-08-23T10:00:00Z",
}
assert payload["capabilities"]["pptx_jobs"] is True
assert payload["capabilities"]["ai_jobs"] is True
assert payload["limits"]["max_upload_bytes"] > 0
assert payload["instance_id"]

print("backend health contract smoke: ok")
