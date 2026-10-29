"""People tracking (C09; CV03): ByteTrack over the person boxes of each sample.

A lost track is kept for 2 s (10 samples at 5 fps) so a short occlusion
re-associates; tracks shorter than 5 samples are dropped as noise. A track's
position is its foot point, the bottom centre of the box.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence

import numpy as np

from ..pipeline.types import Detection, Frame, PersonTrack
from .byte_tracker import ByteTrack

TRACK_BUFFER_SAMPLES = 10  # 2 s at 5 fps
MIN_TRACK_SAMPLES = 5
MATCH_THRESHOLD = 0.9

PerDetection = Callable[[Frame, Detection, PersonTrack], None]


class PeopleTracker:
    def __init__(self, scale: tuple[float, float] = (1.0, 1.0)) -> None:
        # frame_rate=30 makes upstream's buffer a sample count.
        self._bt = ByteTrack(
            track_activation_threshold=0.25,
            lost_track_buffer=TRACK_BUFFER_SAMPLES,
            minimum_matching_threshold=MATCH_THRESHOLD,
            frame_rate=30,
        )
        self._scale = scale
        self.tracks: dict[int, PersonTrack] = {}

    def update(
        self, frame: Frame, detections: Sequence[Detection], each: PerDetection | None = None
    ) -> None:
        people = [d for d in detections if d.cls == "person"]
        if not people:
            self._bt.update(np.zeros((0, 4)), np.zeros(0))
            return
        boxes = np.array([d.xyxy for d in people], dtype=np.float64)
        scores = np.array([d.score for d in people], dtype=np.float64)
        sx, sy = self._scale
        for det_index, track_id in self._bt.update(boxes, scores):
            det = people[det_index]
            x0, _, x1, y1 = det.xyxy
            track = self.tracks.setdefault(track_id, PersonTrack(track_id))
            track.samples.append((frame.t_ms, (x0 + x1) / 2 * sx, y1 * sy))
            if each is not None:
                each(frame, det, track)

    def finished(self) -> list[PersonTrack]:
        """Tracks long enough to keep, in order of first appearance."""
        kept = [t for t in self.tracks.values() if len(t.samples) >= MIN_TRACK_SAMPLES]
        return sorted(kept, key=lambda t: (t.samples[0][0], t.track_id))
