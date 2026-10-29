"""RF-DETR people and ball detector (C09; CV02, model mode).

RF-DETR is Apache-2.0, and so are the COCO checkpoints of the sizes in
ALLOWED_CHECKPOINTS. The larger sizes (XL, 2XL) are under Roboflow's platform
licence and are refused. The `model` extra (torch, torchvision, rfdetr) is
imported lazily: without it, ModelUnavailable says how to get it.

Weights are baked into the GPU image at build time (cv_worker/Dockerfile,
target gpu) and named by WIDELINE_CV_WEIGHTS; they are checked against the
pinned sha256 before loading and never downloaded at run time (A-3). Only the
COCO classes person and sports ball are kept; goalkeepers and referees are
told apart downstream by kit colour and position (A-2).

Inference is batched (WIDELINE_CV_BATCH, default 8). For frames 1920 px wide
or more, the ball is also looked for in a 2 x 2 tiling
(WIDELINE_CV_BALL_TILES, on by default), with NMS across the tiles. The GPU
is used when torch sees one; otherwise the CPU, which is slow and for
development only.
"""

from __future__ import annotations

import hashlib
import importlib
import importlib.util
import os
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt

from ..pipeline.types import Detection, Frame


@dataclass(frozen=True)
class Checkpoint:
    size: str
    cls: str  # the rfdetr class
    url: str
    sha256: str
    licence: str


# Pinned by sha256 (verified against the md5 rfdetr 1.11.2 publishes). The
# medium COCO checkpoint is the default: Apache-2.0, real-time on one GPU.
ALLOWED_CHECKPOINTS: dict[str, Checkpoint] = {
    "medium": Checkpoint(
        size="medium",
        cls="RFDETRMedium",
        url="https://storage.googleapis.com/rfdetr/medium_coco/checkpoint_best_regular.pth",
        sha256="749ff6071828aaffac63e204c4f4135ed3d6cdae4d702e086c360edc3b5768c8",
        licence="Apache-2.0",
    ),
}
DENIED_SIZES = {"xlarge", "xl", "2xlarge", "2xl", "xxlarge"}
RFDETR_VERSION = "1.11.2"
CONFIDENCE = 0.3
PERSON, BALL = "person", "sports ball"


class ModelUnavailable(RuntimeError):
    """The model extra or its weights are missing, or the weights are refused."""


def checkpoint_for(size: str) -> Checkpoint:
    key = size.strip().lower()
    if key in DENIED_SIZES:
        raise ModelUnavailable(
            f"RF-DETR size {size!r} is under Roboflow's platform licence, not Apache-2.0"
        )
    if key not in ALLOWED_CHECKPOINTS:
        raise ModelUnavailable(
            f"RF-DETR size {size!r} is not in ALLOWED_CHECKPOINTS "
            f"({', '.join(sorted(ALLOWED_CHECKPOINTS))})"
        )
    return ALLOWED_CHECKPOINTS[key]


def verify_weights(path: Path, expected_sha256: str) -> None:
    if not path.is_file():
        raise ModelUnavailable(f"weights not found at {path}: set WIDELINE_CV_WEIGHTS")
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    if h.hexdigest() != expected_sha256:
        raise ModelUnavailable(f"weights at {path} do not match the pinned sha256; refusing them")


def _import(name: str) -> Any:
    try:
        return importlib.import_module(name)
    except ImportError as err:
        raise ModelUnavailable(
            f"model mode needs the 'model' extra ({name} is missing): "
            "install it with `uv sync --extra model` or use the GPU image "
            "(make cv-image-gpu); otherwise run with WIDELINE_CV_MODE=synthetic"
        ) from err


def model_available() -> bool:
    try:
        return importlib.util.find_spec("rfdetr") is not None
    except (ImportError, ValueError):
        return False


def nms(
    boxes: npt.NDArray[np.float64], scores: npt.NDArray[np.float64], iou: float = 0.5
) -> list[int]:
    order = list(np.argsort(-scores))
    keep: list[int] = []
    while order:
        i = int(order.pop(0))
        keep.append(i)
        rest = []
        for j in order:
            a, b = boxes[i], boxes[int(j)]
            ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
            iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
            inter = ix * iy
            union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
            if union <= 0 or inter / union < iou:
                rest.append(j)
        order = rest
    return keep


class RFDetrDetector:
    def __init__(self, size: str | None = None, weights: str | None = None) -> None:
        self.checkpoint = checkpoint_for(size or os.environ.get("WIDELINE_CV_MODEL_SIZE", "medium"))
        rfdetr = _import("rfdetr")
        torch = _import("torch")
        path = Path(weights or os.environ.get("WIDELINE_CV_WEIGHTS", "/opt/weights/rfdetr.pth"))
        verify_weights(path, self.checkpoint.sha256)
        self.version = f"rfdetr-{self.checkpoint.size}-{RFDETR_VERSION}"
        self.batch = max(1, int(os.environ.get("WIDELINE_CV_BATCH", "8")))
        tiles = os.environ.get("WIDELINE_CV_BALL_TILES", "1")
        self.ball_tiles = tiles not in ("0", "false", "no")
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        model_cls = getattr(rfdetr, self.checkpoint.cls)
        self.model = model_cls(pretrain_weights=str(path), device=self.device)
        names = importlib.import_module("rfdetr.assets.coco_classes").COCO_CLASSES
        self.person_ids = {k for k, v in names.items() if v == PERSON}
        self.ball_ids = {k for k, v in names.items() if v == BALL}

    def _predict(self, images: list[npt.NDArray[np.uint8]]) -> list[Any]:
        out = self.model.predict(images, threshold=CONFIDENCE)
        return out if isinstance(out, list) else [out]

    def detect(self, frames: Sequence[Frame]) -> list[list[Detection]]:
        results: list[list[Detection]] = []
        for start in range(0, len(frames), self.batch):
            chunk = frames[start : start + self.batch]
            for frame, det in zip(chunk, self._predict([f.rgb for f in chunk]), strict=True):
                results.append(self._convert(frame, det))
        return results

    def _convert(self, frame: Frame, det: Any) -> list[Detection]:
        out: list[Detection] = []
        balls: list[tuple[npt.NDArray[np.float64], float]] = []
        for box, score, cls in zip(det.xyxy, det.confidence, det.class_id, strict=True):
            b = np.asarray(box, dtype=np.float64)
            if int(cls) in self.person_ids:
                out.append(Detection((b[0], b[1], b[2], b[3]), float(score), "person"))
            elif int(cls) in self.ball_ids:
                balls.append((b, float(score)))
        h, w = frame.rgb.shape[:2]
        if self.ball_tiles and w >= 1920:
            th, tw = h // 2, w // 2
            tiles = [frame.rgb[y : y + th, x : x + tw] for y in (0, th) for x in (0, tw)]
            offsets = [(x, y) for y in (0, th) for x in (0, tw)]
            for (ox, oy), tdet in zip(offsets, self._predict(tiles), strict=True):
                for box, score, cls in zip(tdet.xyxy, tdet.confidence, tdet.class_id, strict=True):
                    if int(cls) in self.ball_ids:
                        b = np.asarray(box, dtype=np.float64) + np.array([ox, oy, ox, oy])
                        balls.append((b, float(score)))
        if balls:
            boxes = np.array([b for b, _ in balls])
            scores = np.array([s for _, s in balls])
            for i in nms(boxes, scores):
                b = boxes[i]
                out.append(Detection((b[0], b[1], b[2], b[3]), float(scores[i]), "ball"))
        return out
