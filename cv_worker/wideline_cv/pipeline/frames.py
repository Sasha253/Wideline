"""Frame sampling with ffmpeg (C09; CV02).

`sample_frames()` pipes raw RGB frames at 5 fps from a file or a signed URL.
ffmpeg gets a protocol whitelist and a fixed demuxer (the C06 lessons: no
autodetected formats, no other protocols), and its stderr is redacted before
it reaches an error message. A frame's time is its index / fps.
"""

from __future__ import annotations

import json
import subprocess
from collections.abc import Callable, Iterator

import numpy as np

from ..redact import clean as _clean
from .types import Frame

PROTOCOLS = "https,http,tcp,tls,file"
STDERR_TAIL = 4000


class FrameError(RuntimeError):
    """ffmpeg could not read the video. The message holds no URL query."""


def _input_args(url: str) -> list[str]:
    return ["-protocol_whitelist", PROTOCOLS, "-f", "mov", "-i", url]


def probe_size(url: str) -> tuple[int, int]:
    """The display width and height of the first video stream."""
    out = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-protocol_whitelist",
            PROTOCOLS,
            "-f",
            "mov",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "json",
            url,
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if out.returncode != 0:
        raise FrameError(_clean(f"ffprobe failed: {out.stderr[-STDERR_TAIL:]}"))
    stream = json.loads(out.stdout)["streams"][0]
    return int(stream["width"]), int(stream["height"])


def sample_frames(
    url: str,
    fps: float = 5,
    width: int | None = None,
    should_stop: Callable[[], bool] = lambda: False,
    size: tuple[int, int] | None = None,
) -> Iterator[Frame]:
    """Frames at `fps`, optionally scaled to `width` (height kept in proportion)."""
    w, h = size or probe_size(url)
    vf = f"fps={fps}"
    if width and width < w:
        h = round(h * width / w / 2) * 2
        w = width
        vf += f",scale={w}:{h}"
    cmd = [
        "ffmpeg",
        "-nostdin",
        "-v",
        "error",
        *_input_args(url),
        "-an",
        "-vf",
        vf,
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert proc.stdout is not None and proc.stderr is not None
    frame_bytes = w * h * 3
    index = 0
    try:
        while True:
            if should_stop():
                return
            buf = proc.stdout.read(frame_bytes)
            if len(buf) < frame_bytes:
                break
            rgb = np.frombuffer(buf, dtype=np.uint8).reshape(h, w, 3)
            yield Frame(round(index * 1000 / fps), rgb)
            index += 1
        code = proc.wait(timeout=60)
        if code != 0:
            err = proc.stderr.read().decode("utf8", "replace")[-STDERR_TAIL:]
            raise FrameError(_clean(f"ffmpeg failed (exit {code}): {err}"))
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()


def extract_still(url: str, t_ms: int, out_path: str) -> None:
    """Writes one frame at `t_ms` to `out_path` (JPEG or PNG by its extension)."""
    cmd = [
        "ffmpeg",
        "-nostdin",
        "-v",
        "error",
        "-y",
        "-ss",
        f"{t_ms / 1000:.3f}",
        *_input_args(url),
        "-frames:v",
        "1",
        out_path,
    ]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        raise FrameError(_clean(f"ffmpeg failed: {out.stderr[-STDERR_TAIL:]}"))
