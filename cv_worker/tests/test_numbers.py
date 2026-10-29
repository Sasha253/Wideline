"""C09: the shirt-number vote and the null reader."""

from __future__ import annotations

import numpy as np

from wideline_cv.numbers import NullReader, vote
from wideline_cv.pipeline.types import Detection, Frame


def test_majority_vote() -> None:
    number, conf = vote([(7, 0.8), (7, 0.9), (1, 0.4), (7, 0.7)])
    assert number == 7
    assert conf == round(0.75 * 0.8, 4)


def test_no_reads_give_nothing() -> None:
    assert vote([]) == (None, None)
    assert vote([(120, 0.9)]) == (None, None)


def test_null_reader_reads_nothing() -> None:
    frame = Frame(0, np.zeros((4, 4, 3), dtype=np.uint8))
    assert NullReader().read(frame, Detection((0, 0, 1, 1), 0.9, "person")) is None
    assert NullReader.version == "none"
