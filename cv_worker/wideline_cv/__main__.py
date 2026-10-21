"""CLI entry point.

    python -m wideline_cv run --video match.mp4 --calibration cal.json --out ./out/

The pipeline itself arrives in Phase 4; `run` is a stub until then.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import structlog

from . import __version__
from .log import configure


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="wideline_cv", description=__doc__)
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="Run the pipeline on a video file or URL")
    run.add_argument("--video", required=True, help="Path or presigned URL of the input video")
    run.add_argument("--calibration", required=True, help="Path or URL of calibration JSON")
    run.add_argument("--out", type=Path, default=Path("./out"), help="Output directory")
    return parser


def main(argv: list[str] | None = None) -> int:
    configure()
    args = build_parser().parse_args(argv)
    log = structlog.get_logger()
    if args.command == "run":
        log.error("pipeline_not_implemented", phase=4)
        return 2
    return 1


if __name__ == "__main__":
    sys.exit(main())
