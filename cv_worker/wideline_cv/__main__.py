"""CLI entry point.

    python -m wideline_cv run --video match.mp4 [--calibration cal.json] --out ./out/
    python -m wideline_cv job      # inside a dispatched instance; reads WIDELINE_JOB
    python -m wideline_cv synthetic-truth --duration 90 --seed 7   # Lab CSV of the scene's events
    python -m wideline_cv golden --out ../web/tests/fixtures/cv   # make cv-golden
    python -m wideline_cv bench --video match.mp4 [--mode synthetic]   # stage timings (NFR01)

`run` takes --mode synthetic|model (default WIDELINE_CV_MODE) and writes
result.json (contract 1.0) and still.png to --out. The calibration file is
{"homography": [[...], [...], [...]], "confidence": 0.9}, pixel to pitch
metres in the video's own pixels.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import structlog

from . import __version__
from .log import configure


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="wideline_cv", description=__doc__)
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="Run the pipeline on a video file or URL")
    run.add_argument("--video", required=True, help="Path or presigned URL of the input video")
    run.add_argument("--calibration", help="Path of a calibration JSON (optional)")
    run.add_argument("--out", type=Path, default=Path("./out"), help="Output directory")
    run.add_argument("--mode", choices=["synthetic", "model"], help="Default: WIDELINE_CV_MODE")
    run.add_argument("--duration", type=float, help="Seconds, when ffprobe cannot tell")

    sub.add_parser("job", help="Run one dispatched job from the WIDELINE_JOB environment")

    truth = sub.add_parser("synthetic-truth", help="Print a synthetic scene's events as Lab CSV")
    truth.add_argument("--duration", type=float, required=True, help="Seconds")
    truth.add_argument("--seed", type=int, default=7)

    golden = sub.add_parser("golden", help="Write the golden synthetic result and truth (C09)")
    golden.add_argument("--out", type=Path, required=True, help="web/tests/fixtures/cv")

    bench = sub.add_parser("bench", help="Time each pipeline stage on a video (NFR01)")
    bench.add_argument("--video", required=True)
    bench.add_argument("--mode", choices=["synthetic", "model"])
    bench.add_argument("--duration", type=float, help="Seconds, when ffprobe cannot tell")
    return parser


def _probe(video: str) -> dict[str, Any]:
    """Duration, fps and size from ffprobe, or {} when it is not available."""
    try:
        out = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height,r_frame_rate:format=duration",
                "-of",
                "json",
                video,
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired):
        return {}
    if out.returncode != 0:
        return {}
    data = json.loads(out.stdout)
    stream = data.get("streams", [{}])[0]
    num, _, den = str(stream.get("r_frame_rate", "25/1")).partition("/")
    return {
        "durationSec": float(data.get("format", {}).get("duration", 0)) or None,
        "fps": float(num) / float(den or 1),
        "width": stream.get("width"),
        "height": stream.get("height"),
    }


def _local_spec(args: argparse.Namespace) -> dict[str, Any]:
    probed = _probe(args.video)
    spec: dict[str, Any] = {
        "jobId": "local",
        "matchId": "local",
        "videoUrl": args.video,
        "sampledFps": 5,
        "durationSec": args.duration or probed.get("durationSec") or 600.0,
        "fps": probed.get("fps") or 25.0,
        "width": probed.get("width") or 1920,
        "height": probed.get("height") or 1080,
    }
    if args.mode:
        spec["mode"] = args.mode
    if getattr(args, "calibration", None):
        cal = json.loads(Path(args.calibration).read_text(encoding="utf-8"))
        spec["calibration"] = {
            "id": None,
            "homography": cal["homography"],
            "confidence": cal.get("confidence", 1.0),
        }
    return spec


def main(argv: list[str] | None = None) -> int:
    configure()
    args = build_parser().parse_args(argv)
    log = structlog.get_logger()
    if args.command == "run":
        from .contract import validate
        from .pipeline import run
        from .pipeline.core import encode_png

        spec = _local_spec(args)
        args.out.mkdir(parents=True, exist_ok=True)
        still = args.out / "still.png"
        result = run(spec, lambda: False, lambda rgb: still.write_bytes(encode_png(rgb)))
        validate(result)
        (args.out / "result.json").write_text(
            json.dumps(result, separators=(",", ":")), encoding="utf-8"
        )
        log.info("run_done", out=str(args.out), events=len(result["events"]))
        return 0
    if args.command == "job":
        from .job import run_job

        raw = os.environ.get("WIDELINE_JOB")
        if not raw:
            log.error("job_spec_missing")
            return 2
        return run_job(raw)
    if args.command == "synthetic-truth":
        from .synthetic.scene import Scene
        from .synthetic.truth import truth_csv

        sys.stdout.write(truth_csv(Scene(args.seed, args.duration)))
        return 0
    if args.command == "golden":
        from .synthetic.golden import write

        write(args.out)
        return 0
    if args.command == "bench":
        from .pipeline import run

        spec = _local_spec(args)
        started = time.monotonic()
        result = run(spec, lambda: False)
        took = time.monotonic() - started
        duration = float(spec["durationSec"])
        report = {
            "mode": spec.get("mode") or os.environ.get("WIDELINE_CV_MODE") or "default",
            "videoSec": duration,
            "seconds": round(took, 1),
            "realtimeFactor": round(took / duration, 4) if duration else None,
            "tracks": len(result["tracks"]),
            "events": len(result["events"]),
        }
        sys.stdout.write(json.dumps(report) + "\n")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
