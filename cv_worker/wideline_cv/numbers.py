"""Shirt numbers (C09; CV06).

A `NumberReader` reads a number from one person box. v0 ships no production
reader (Q-039): `NullReader` reads nothing, so CV links no tracks and linking
is the reviewer's job (C11). Synthetic mode has its own reader.

Per track, the reads are put to a vote: the most-read number wins, with
confidence = vote share x mean confidence of its reads. Ingest links a track
only at 0.5 or more (TRACK_LINK_MIN_CONFIDENCE) and only through the consent
gate (NFR08).
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence

from .pipeline.types import Detection, Frame

NULL_VERSION = "none"


class NullReader:
    version = NULL_VERSION

    def read(self, frame: Frame, det: Detection) -> tuple[int, float] | None:
        del frame, det
        return None


def vote(reads: Sequence[tuple[int, float]]) -> tuple[int | None, float | None]:
    """The track's number and its confidence, or (None, None) with no reads."""
    if not reads:
        return None, None
    by_number: dict[int, list[float]] = defaultdict(list)
    for number, conf in reads:
        if 0 <= number <= 99:
            by_number[number].append(conf)
    if not by_number:
        return None, None
    number, confs = max(by_number.items(), key=lambda kv: (len(kv[1]), sum(kv[1]), -kv[0]))
    share = len(confs) / sum(len(v) for v in by_number.values())
    confidence = round(share * (sum(confs) / len(confs)), 4)
    return number, min(max(confidence, 0.0), 1.0)
