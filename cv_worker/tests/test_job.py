"""C08, C09: the dispatched job runner against a local fake of the app and the bucket.
The default pipeline is the synthetic one (C09)."""

from __future__ import annotations

import hashlib
import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import pytest

from wideline_cv.contract import ResultInvalid, validate
from wideline_cv.job import run_job
from wideline_cv.pipeline import run as pipeline_run


class Fake:
    """Records PUTs and callbacks; answers callbacks with `callback_status`."""

    def __init__(self) -> None:
        self.puts: list[tuple[str, bytes, str | None]] = []
        self.callbacks: list[tuple[dict[str, Any], str | None]] = []
        self.callback_status = 202
        self.heartbeat_status = 202


@pytest.fixture
def fake() -> Iterator[tuple[Fake, str]]:
    state = Fake()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args: object) -> None:
            pass

        def _body(self) -> bytes:
            return self.rfile.read(int(self.headers.get("Content-Length", 0)))

        def do_PUT(self) -> None:
            state.puts.append((self.path, self._body(), self.headers.get("Content-Type")))
            self.send_response(200)
            self.end_headers()

        def do_POST(self) -> None:
            body = json.loads(self._body())
            state.callbacks.append((body, self.headers.get("Authorization")))
            status = (
                state.heartbeat_status if body["kind"] == "heartbeat" else state.callback_status
            )
            self.send_response(status)
            self.end_headers()

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield state, f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


def spec(base: str, **extra: Any) -> str:
    return json.dumps(
        {
            "jobId": "job_1",
            "matchId": "match_1",
            "instanceId": "inst_1",
            "attempt": 1,
            "videoUrl": f"{base}/raw.mp4?X-Amz-Signature=secret",
            "resultUrl": f"{base}/result.json?X-Amz-Signature=secret",
            "callbackUrl": f"{base}/api/jobs/job_1/callback",
            "callbackToken": "tok",
            "sampledFps": 5,
            "durationSec": 20.0,
            "fps": 25.0,
            "width": 1920,
            "height": 1080,
            "calibration": None,
            **extra,
        }
    )


def test_synthetic_result_is_valid_and_delivered(fake: tuple[Fake, str]) -> None:
    state, base = fake
    assert run_job(spec(base), heartbeat_seconds=60) == 0
    [(path, body, ctype)] = state.puts
    assert path.startswith("/result.json")
    assert ctype == "application/json"
    result = json.loads(body)
    validate(result)
    assert result["jobId"] == "job_1" and result["matchId"] == "match_1"
    assert result["video"]["durationSec"] == 20.0
    assert result["modelVersions"]["detector"] == "synthetic-1"
    assert result["tracks"]
    [(cb, auth)] = state.callbacks
    assert auth == "Bearer tok"
    assert cb == {
        "instanceId": "inst_1",
        "kind": "succeeded",
        "resultSha256": hashlib.sha256(body).hexdigest(),
    }


def test_pipeline_error_reports_failed_without_urls(fake: tuple[Fake, str]) -> None:
    state, base = fake

    def broken(s: dict[str, Any], _stop: object) -> dict[str, Any]:
        raise RuntimeError(f"could not open {s['videoUrl']}")

    assert run_job(spec(base), pipeline=broken, heartbeat_seconds=60) == 1
    assert state.puts == []
    [(cb, _auth)] = state.callbacks
    assert cb["kind"] == "failed"
    assert "secret" not in cb["error"]
    assert "RuntimeError" in cb["error"]


def test_invalid_result_is_not_uploaded(fake: tuple[Fake, str]) -> None:
    state, base = fake

    def bad(s: dict[str, Any], stop: object) -> dict[str, Any]:
        result = pipeline_run({**s, "stillUrl": None}, lambda: False)
        del result["warnings"]
        return result

    assert run_job(spec(base), pipeline=bad, heartbeat_seconds=60) == 1
    assert state.puts == []
    assert state.callbacks[-1][0]["kind"] == "failed"


def test_heartbeat_410_stops_the_job(fake: tuple[Fake, str]) -> None:
    state, base = fake
    state.heartbeat_status = 410
    seen = threading.Event()

    def slow(s: dict[str, Any], should_stop: Any) -> dict[str, Any]:
        for _ in range(200):
            if should_stop():
                seen.set()
                break
            threading.Event().wait(0.01)
        return {"never": "validated"}

    assert run_job(spec(base), pipeline=slow, heartbeat_seconds=0.05) == 1
    assert seen.is_set()
    assert state.puts == []
    assert all(cb["kind"] == "heartbeat" for cb, _ in state.callbacks)


def test_the_still_is_uploaded(fake: tuple[Fake, str]) -> None:
    state, base = fake
    url = f"{base}/still.png?X-Amz-Signature=secret"
    assert run_job(spec(base, stillUrl=url), heartbeat_seconds=60) == 0
    still = next(p for p in state.puts if p[0].startswith("/still.png"))
    assert still[2] == "image/png"
    assert still[1][:4] == bytes([0x89]) + b"PNG"
    result = json.loads(next(p for p in state.puts if p[0].startswith("/result.json"))[1])
    assert "calibration still not saved" not in result["warnings"]


def test_a_failed_still_upload_is_a_warning(fake: tuple[Fake, str]) -> None:
    state, base = fake
    # Nothing listens on port 9: the PUT fails, the job still succeeds.
    url = "http://127.0.0.1:9/still.png?sig=secret"
    assert run_job(spec(base, stillUrl=url), heartbeat_seconds=60) == 0
    result = json.loads(next(p for p in state.puts if p[0].startswith("/result.json"))[1])
    assert "calibration still not saved" in result["warnings"]
    assert state.callbacks[-1][0]["kind"] == "succeeded"


def test_validate_rejects_a_missing_field() -> None:
    result = pipeline_run(
        {"jobId": "j", "matchId": "m", "durationSec": 10, "fps": 25}, lambda: False
    )
    validate(result)
    del result["calibration"]
    with pytest.raises(ResultInvalid):
        validate(result)
