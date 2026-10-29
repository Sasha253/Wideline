"""One CV job inside a dispatched instance (C08; CV01).

The dispatcher starts the container with WIDELINE_JOB, a JSON object of ids
and signed URLs: jobId, matchId, instanceId, attempt, videoUrl, resultUrl,
callbackUrl, callbackToken, sampledFps, durationSec and fps; C09 adds width
and height (the probed video size), calibration (the stored homography for
the venue and camera, or null) and stillUrl. The worker:

1. sends a heartbeat to the callback every minute (a 410 means the job is no
   longer live, so it stops);
2. runs the pipeline (C09: wideline_cv.pipeline, synthetic or model mode),
   which also PUTs a calibration still to stillUrl when the spec has one;
3. checks the result against the contract;
4. PUTs it to resultUrl and reports kind=succeeded with its sha256;
5. on any error, reports kind=failed with a short message instead.

Nothing else passes between the worker and the app. URLs and the token are
never logged.
"""

from __future__ import annotations

import hashlib
import json
import threading
import urllib.error
import urllib.request
from collections.abc import Callable
from typing import Any

import structlog

from . import pipeline
from .contract import validate
from .redact import clean as _clean

HEARTBEAT_SECONDS = 60.0
HTTP_TIMEOUT = 30.0

Pipeline = Callable[[dict[str, Any], Callable[[], bool]], dict[str, Any]]

log = structlog.get_logger()


class JobGone(Exception):
    """The app answered 410: the instance or the job is no longer live."""


def _post(spec: dict[str, Any], body: dict[str, Any]) -> int:
    data = json.dumps({"instanceId": spec["instanceId"], **body}).encode()
    req = urllib.request.Request(
        spec["callbackUrl"],
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {spec['callbackToken']}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as res:
            return int(res.status)
    except urllib.error.HTTPError as err:
        if err.code == 410:
            raise JobGone from None
        raise RuntimeError(f"callback answered {err.code}") from None


def _put_result(url: str, payload: bytes) -> None:
    req = urllib.request.Request(
        url, data=payload, method="PUT", headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT * 10):
            pass
    except urllib.error.HTTPError as err:
        raise RuntimeError(f"result upload answered {err.code}") from None


class Heartbeat:
    """Posts kind=heartbeat every interval until stopped, or until the app says 410."""

    def __init__(self, spec: dict[str, Any], interval: float) -> None:
        self._spec = spec
        self._interval = interval
        self._stop = threading.Event()
        self.gone = threading.Event()
        self._thread = threading.Thread(target=self._run, name="heartbeat", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._thread.join(timeout=HTTP_TIMEOUT + 1)

    def _run(self) -> None:
        while not self._stop.wait(self._interval):
            try:
                _post(self._spec, {"kind": "heartbeat"})
            except JobGone:
                log.warning("job_gone", jobId=self._spec["jobId"])
                self.gone.set()
                return
            except Exception as err:  # a missed heartbeat is not fatal
                log.warning("heartbeat_failed", error=_clean(str(err)))


def run_job(
    raw_spec: str,
    pipeline: Pipeline = pipeline.run,
    heartbeat_seconds: float = HEARTBEAT_SECONDS,
) -> int:
    """Runs one job. Returns 0 when the result was delivered, 1 otherwise."""
    spec: dict[str, Any] = json.loads(raw_spec)
    ids = {"jobId": spec["jobId"], "instanceId": spec["instanceId"], "attempt": spec.get("attempt")}
    log.info("job_started", **ids)
    beat = Heartbeat(spec, heartbeat_seconds)
    beat.start()
    try:
        result = pipeline(spec, beat.gone.is_set)
        if beat.gone.is_set():
            log.warning("job_abandoned", **ids)
            return 1
        validate(result)
        payload = json.dumps(result, separators=(",", ":")).encode()
        _put_result(spec["resultUrl"], payload)
        sha = hashlib.sha256(payload).hexdigest()
        _post(spec, {"kind": "succeeded", "resultSha256": sha})
        log.info(
            "job_succeeded",
            **ids,
            tracks=len(result["tracks"]),
            events=len(result["events"]),
            bytes=len(payload),
        )
        return 0
    except JobGone:
        log.warning("job_gone", **ids)
        return 1
    except Exception as err:
        message = _clean(f"{type(err).__name__}: {err}")
        log.error("job_failed", **ids, error=message)
        try:
            _post(spec, {"kind": "failed", "error": message})
        except Exception as cb_err:
            log.error("failed_callback_failed", **ids, error=_clean(str(cb_err)))
        return 1
    finally:
        beat.stop()
