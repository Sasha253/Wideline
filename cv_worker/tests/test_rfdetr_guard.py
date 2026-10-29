"""C09: the model path refuses to run without its extra, with wrong weights,
or with a checkpoint outside the Apache-2.0 sizes."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from wideline_cv.detect import rfdetr_detector as rd


def test_without_the_extra_the_message_is_clear(monkeypatch: pytest.MonkeyPatch) -> None:
    def missing(name: str) -> object:
        raise ImportError(f"No module named {name!r}")

    monkeypatch.setattr(rd.importlib, "import_module", missing)
    with pytest.raises(rd.ModelUnavailable, match="'model' extra"):
        rd.RFDetrDetector(size="medium", weights="unused.pth")


def test_wrong_weights_are_refused(tmp_path: Path) -> None:
    weights = tmp_path / "rfdetr.pth"
    weights.write_bytes(b"not the pinned checkpoint")
    with pytest.raises(rd.ModelUnavailable, match="do not match the pinned sha256"):
        rd.verify_weights(weights, rd.ALLOWED_CHECKPOINTS["medium"].sha256)


def test_matching_weights_pass(tmp_path: Path) -> None:
    weights = tmp_path / "rfdetr.pth"
    weights.write_bytes(b"pinned")
    rd.verify_weights(weights, hashlib.sha256(b"pinned").hexdigest())


def test_missing_weights_are_refused(tmp_path: Path) -> None:
    with pytest.raises(rd.ModelUnavailable, match="WIDELINE_CV_WEIGHTS"):
        rd.verify_weights(tmp_path / "none.pth", "0" * 64)


@pytest.mark.parametrize("size", ["xlarge", "2XL", "base", "nano-but-unknown"])
def test_sizes_outside_the_allow_list_are_refused(size: str) -> None:
    with pytest.raises(rd.ModelUnavailable):
        rd.checkpoint_for(size)


def test_the_allowed_checkpoints_are_apache_and_pinned() -> None:
    for cp in rd.ALLOWED_CHECKPOINTS.values():
        assert cp.licence == "Apache-2.0"
        assert len(cp.sha256) == 64 and cp.url.startswith("https://")


def test_nms_keeps_the_best_of_overlapping_boxes() -> None:
    import numpy as np

    boxes = np.array([[0, 0, 10, 10], [1, 1, 11, 11], [50, 50, 60, 60]], dtype=np.float64)
    assert rd.nms(boxes, np.array([0.5, 0.9, 0.7])) == [1, 2]
