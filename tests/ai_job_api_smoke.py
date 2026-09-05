from __future__ import annotations

import json
from pathlib import Path
import tempfile
import threading
import time
import sys
from contextlib import ExitStack

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deploy import aliyun_api as api


def wait_for(client: TestClient, job_id: str, statuses: set[str], timeout: float = 5) -> dict:
    deadline = time.time() + timeout
    state = {}
    while time.time() < deadline:
        state = client.get(f"/api/pptx-report/ai-jobs/{job_id}").json()
        if state.get("status") in statuses:
            return state
        time.sleep(0.02)
    raise AssertionError(f"AI job {job_id} did not reach {statuses}; last={state}")


def request_payload(message: str = "hello") -> dict:
    return {
        "operation": "report_narrative_framework",
        "payload": {
            "provider": "deepseek",
            "url": "https://example.com/chat/completions",
            "taskTier": "storyline",
            "body": {
                "model": "deepseek-v4-flash",
                "messages": [{"role": "user", "content": message}],
                "response_format": {"type": "json_object"},
            },
        },
    }


def main() -> None:
    original_dir = api.AI_JOB_DIR
    original_call = api._call_ai_proxy
    original_semaphore = api.AI_JOB_SEMAPHORE
    original_attempts = api.AI_JOB_MAX_ATTEMPTS
    with tempfile.TemporaryDirectory(prefix="surveykit-ai-jobs-") as temp_dir, ExitStack() as cleanup:
        duplicate_release = threading.Event()
        release = threading.Event()
        existing_threads = set(threading.enumerate())

        def restore_test_state():
            duplicate_release.set()
            release.set()
            for worker in threading.enumerate():
                if worker not in existing_threads and worker.name.startswith("ai-job-"):
                    worker.join(timeout=10)
                    assert not worker.is_alive(), "Test job must stop before removing its files"
            api.AI_JOB_DIR = original_dir
            api._call_ai_proxy = original_call
            api.AI_JOB_SEMAPHORE = original_semaphore
            api.AI_JOB_MAX_ATTEMPTS = original_attempts

        cleanup.callback(restore_test_state)
        api.AI_JOB_DIR = Path(temp_dir)
        api.AI_JOB_SEMAPHORE = threading.BoundedSemaphore(1)
        api.AI_JOB_MAX_ATTEMPTS = 3
        client = TestClient(api.app)
        headers = {"X-SurveyKit-Client-ID": "client-ai-smoke-001"}
        health = client.get("/healthz").json()
        assert health["capabilities"]["ai_jobs"] is True

        calls = []

        def flaky_call(payload, request_id, timeout_seconds):
            assert duplicate_release.wait(10), "Duplicate request was not checked"
            calls.append((payload, request_id, timeout_seconds))
            if len(calls) == 1:
                error = RuntimeError("upstream 502")
                error.status = 502
                raise error
            return (
                {"choices": [{"message": {"content": '{"ok":true}'}}]},
                {
                    "request_id": request_id,
                    "source": "builtin-sensenova",
                    "model": "deepseek-v4-flash",
                    "task_tier": "storyline",
                    "duration_ms": 123,
                    "fallback_used": True,
                    "attempt_sources": "SurveyKit,SenseNova",
                },
            )

        api._call_ai_proxy = flaky_call
        created = client.post("/api/pptx-report/ai-jobs", json=request_payload(), headers=headers)
        assert created.status_code == 202
        job_id = created.json()["job_id"]
        duplicate = client.post("/api/pptx-report/ai-jobs", json=request_payload(), headers=headers)
        assert duplicate.status_code == 202
        assert duplicate.json()["job_id"] == job_id
        assert duplicate.json()["deduplicated"] is True
        duplicate_release.set()
        ready = wait_for(client, job_id, {"ready"})
        assert ready["result"]["choices"][0]["message"]["content"] == '{"ok":true}'
        assert ready["diagnostics"]["source"] == "builtin-sensenova"
        assert len(ready["attempts"]) == 2
        assert ready["attempts"][0]["ok"] is False
        assert ready["attempts"][1]["ok"] is True
        assert json.loads(api._ai_job_request_path(job_id).read_text(encoding="utf-8"))["body"]["model"]

        forbidden = request_payload("secret")
        forbidden["payload"]["apiKey"] = "do-not-store"
        rejected = client.post("/api/pptx-report/ai-jobs", json=forbidden, headers=headers)
        assert rejected.status_code == 400
        assert not any("do-not-store" in path.read_text(encoding="utf-8") for path in api.AI_JOB_DIR.glob("*"))

        def blocking_call(payload, request_id, timeout_seconds):
            assert release.wait(10), "Cancellation request was not checked"
            return ({"choices": [{"message": {"content": "late"}}]}, {})

        api._call_ai_proxy = blocking_call
        cancel_created = client.post(
            "/api/pptx-report/ai-jobs", json=request_payload("cancel"), headers=headers
        )
        cancel_id = cancel_created.json()["job_id"]
        cancel = client.post(f"/api/pptx-report/ai-jobs/{cancel_id}/cancel")
        assert cancel.status_code == 202
        release.set()
        cancelled = wait_for(client, cancel_id, {"cancelled"})
        assert cancelled["finished_at"]
        assert not api._ai_job_result_path(cancel_id).exists()

    print("AI durable job lifecycle smoke: ok")


if __name__ == "__main__":
    main()
