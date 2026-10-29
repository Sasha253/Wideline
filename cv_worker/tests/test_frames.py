"""C09: ffmpeg frame sampling (skipped without ffmpeg)."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from wideline_cv.pipeline.frames import FrameError, extract_still, sample_frames

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


@pytest.fixture(scope="module")
def clip(tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = tmp_path_factory.mktemp("frames") / "clip.mp4"
    source = "testsrc2=size=320x180:rate=25:duration=3"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            source,
            "-pix_fmt",
            "yuv420p",
            str(out),
        ],
        check=True,
    )
    return out


def test_samples_at_5_fps_with_index_times(clip: Path) -> None:
    frames = list(sample_frames(str(clip), fps=5))
    assert [f.t_ms for f in frames] == [k * 200 for k in range(15)]
    assert frames[0].rgb.shape == (180, 320, 3)


def test_should_stop_is_honoured(clip: Path) -> None:
    seen = 0

    def stop() -> bool:
        return seen >= 3

    for _ in sample_frames(str(clip), fps=5, should_stop=stop):
        seen += 1
    assert seen == 3


def test_errors_carry_no_url_query() -> None:
    url = "http://127.0.0.1:9/raw.mp4?X-Amz-Signature=secret"
    with pytest.raises(FrameError) as err:
        list(sample_frames(url, fps=5, size=(32, 18)))
    assert "secret" not in str(err.value)


def test_extract_still(clip: Path, tmp_path: Path) -> None:
    out = tmp_path / "still.png"
    extract_still(str(clip), 1000, str(out))
    assert out.stat().st_size > 0
