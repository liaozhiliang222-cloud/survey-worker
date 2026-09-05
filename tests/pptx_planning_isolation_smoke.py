"""Contract parity and real process isolation from a blocked rendering worker."""
from pathlib import Path
import concurrent.futures
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

if len(sys.argv) > 1 and sys.argv[1] == "serve-blocked":
    import uvicorn
    from fastapi import FastAPI
    app = FastAPI()

    @app.get("/block")
    async def block():
        Path(sys.argv[3]).write_text("blocked")
        time.sleep(8)  # same event-loop blockage as synchronous render/lock wait
        return {"ok": True}

    uvicorn.run(app, host="127.0.0.1", port=int(sys.argv[2]), log_level="error")
    sys.exit()

from fastapi.testclient import TestClient
from deploy import aliyun_api, pptx_planning_api

data = (ROOT / "tests/fixtures/imports/standard-crosstab.xlsx").read_bytes()
original, isolated = TestClient(aliyun_api.app), TestClient(pptx_planning_api.app)
for path in ["/api/pptx-report/parse", "/api/pptx-report/preview?title=Parity", "/api/pptx-report/preview?dimension=missing"]:
    before, after = original.post(path, content=data), isolated.post(path, content=data)
    assert before.status_code == after.status_code == 200
    assert before.json() == after.json(), path
assert isolated.post("/api/pptx-report/jobs", json={}).status_code == 404
assert not pptx_planning_api.app.router.on_startup, "must not recover render/AI jobs"
assert isolated.post("/api/pptx-report/parse", content=b"invalid").status_code == 500

def port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]

with tempfile.TemporaryDirectory() as tmp:
    marker = Path(tmp) / "blocked"
    main_port, plan_port = port(), port()
    env = {**os.environ, "PYTHONPATH": str(ROOT), "OPENBLAS_NUM_THREADS": "1"}
    processes = []
    try:
        for args in [[__file__, "serve-blocked", str(main_port), str(marker)], ["-m", "uvicorn", "deploy.pptx_planning_api:app", "--host", "127.0.0.1", "--port", str(plan_port), "--log-level", "error"]]:
            processes.append(subprocess.Popen([sys.executable, *args], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        for target in [main_port, plan_port]:
            deadline = time.monotonic() + 30
            while True:
                try:
                    with socket.create_connection(("127.0.0.1", target), timeout=.2):
                        break
                except OSError:
                    assert time.monotonic() < deadline, "service startup timeout"
                    time.sleep(.1)
        with concurrent.futures.ThreadPoolExecutor() as executor:
            blocked = executor.submit(urllib.request.urlopen, f"http://127.0.0.1:{main_port}/block")
            deadline = time.monotonic() + 5
            while not marker.exists():
                assert time.monotonic() < deadline
                time.sleep(.02)
            started = time.monotonic()
            for route in ["parse", "preview"]:
                request = urllib.request.Request(f"http://127.0.0.1:{plan_port}/api/pptx-report/{route}", data=data)
                with urllib.request.urlopen(request, timeout=5) as response:
                    assert response.status == 200
            assert not blocked.done(), "planning waited for the blocked render process"
            print(json.dumps({"parity": True, "blocked_renderer_isolated": True, "parse_and_preview_seconds": round(time.monotonic()-started, 3)}))
            blocked.result(timeout=10).close()
    finally:
        for process in processes:
            process.terminate()
            process.wait(timeout=10)
