"""The CV pipeline (C09; CV02 to CV08): sample, detect, track, assign teams,
calibrate, read shirt numbers, detect events, and write contract 1.0.

    run(spec, should_stop) -> result dict

Two modes, picked by WIDELINE_CV_MODE:

- `model`: ffmpeg samples the footage at 5 fps, RF-DETR finds people and the
  ball (detect/rfdetr_detector.py, the `model` extra and baked-in weights),
  and no shirt numbers are read in v0 (Q-039).
- `synthetic` (the default whenever the model extra is absent): a seeded scene
  is rendered and detected with noise instead of the footage (A-4). No GPU, no
  weights, no network, deterministic. Its scenario is the video's length,
  capped by WIDELINE_CV_SYNTHETIC_MAX_SEC (600 by default), and its
  modelVersions say synthetic-1, so its result never passes as a model's.

The result is checked against the contract by the caller (job.py, the CLI).
The rest is shared: ByteTrack for people and a ball tracker, kit-colour teams,
the stored calibration or a frame-fit fallback, a shirt-number vote, and the
event heuristics. Coordinates are camera-fixed metres (Q-043). Stage timings
and counts go to the log; URLs never do. When the spec has a stillUrl, one
frame is PUT there as PNG for the Lab's calibration tool; a failed upload is a
warning, not a failure.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import numpy.typing as npt


def run(
    spec: dict[str, Any],
    should_stop: Callable[[], bool],
    on_still: Callable[[npt.NDArray[np.uint8]], None] | None = None,
) -> dict[str, Any]:
    """Runs the pipeline for one job spec (see the module docstring). `on_still`
    takes the calibration still instead of the PUT to spec["stillUrl"]."""
    # Imported here: the stages import pipeline.types, so the package itself
    # stays import-light.
    from .core import run as _run

    return _run(spec, should_stop, on_still)
