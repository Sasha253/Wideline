"""The synthetic scene's ground truth as Lab tags (C09).

`truth_csv()` writes the CSV the Lab imports (`type,time,teamSide,onTarget`,
time as video mm:ss.s), so the Lab can measure recall on a synthetic run
(`python -m wideline_cv synthetic-truth`). Sides are the scene's: home is the
side in the first kit.
"""

from __future__ import annotations

from .scene import Scene, TruthEvent

HEADER = "type,time,teamSide,onTarget"


def format_time(ms: int) -> str:
    """Video time as m:ss.s (minutes unpadded, as the Lab prints it)."""
    tenths = round(ms / 100)
    minutes, rest = divmod(tenths, 600)
    return f"{minutes}:{rest // 10:02d}.{rest % 10}"


def truth_rows(scene: Scene) -> list[TruthEvent]:
    return list(scene.truth)


def truth_csv(scene: Scene) -> str:
    lines = [HEADER]
    for e in truth_rows(scene):
        on_target = "" if e.on_target is None else ("true" if e.on_target else "false")
        lines.append(f"{e.type},{format_time(e.t_ms)},{e.side or ''},{on_target}")
    return "\n".join(lines) + "\n"
