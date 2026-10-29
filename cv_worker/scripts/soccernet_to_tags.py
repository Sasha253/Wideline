"""Optional, benchmarking only (C09): SoccerNet action-spotting labels to the
Lab's tag CSV.

    uv run python scripts/soccernet_to_tags.py /path/to/Labels-v2.json --half 1 > tags.csv

SoccerNet data is research-only: read it from a local path you downloaded
yourself, never commit it, and never ship anything derived from it
(LICENSES.md). Goals become a goal and a shot tag (a goal is also a shot);
"Shots on target" and "Shots off target" become shot tags. Times are the
label's game time within the chosen half, so they line up with a video of
that half only. Team sides come from the label's "team" field.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HEADER = "type,time,teamSide,onTarget"


def _ms(game_time: str) -> int:
    # "1 - 13:10": half, then mm:ss.
    _, clock = game_time.split(" - ")
    minutes, seconds = clock.split(":")
    return (int(minutes) * 60 + int(seconds)) * 1000


def _time(ms: int) -> str:
    tenths = ms // 100
    return f"{tenths // 600}:{(tenths % 600) // 10:02d}.{tenths % 10}"


def convert(labels: dict[str, object], half: int) -> str:
    rows = [HEADER]
    annotations = labels.get("annotations", [])
    assert isinstance(annotations, list)
    for a in annotations:
        if not isinstance(a, dict) or not str(a.get("gameTime", "")).startswith(f"{half} - "):
            continue
        label = a.get("label")
        side = a.get("team") if a.get("team") in ("home", "away") else ""
        t = _time(_ms(str(a["gameTime"])))
        if label == "Goal":
            rows.append(f"goal,{t},{side},")
            rows.append(f"shot,{t},{side},true")
        elif label == "Shots on target":
            rows.append(f"shot,{t},{side},true")
        elif label == "Shots off target":
            rows.append(f"shot,{t},{side},false")
    return "\n".join(rows) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("labels", type=Path, help="A local SoccerNet Labels-v2.json")
    parser.add_argument("--half", type=int, choices=[1, 2], default=1)
    args = parser.parse_args(argv)
    labels = json.loads(args.labels.read_text(encoding="utf-8"))
    sys.stdout.write(convert(labels, args.half))
    return 0


if __name__ == "__main__":
    sys.exit(main())
