import pytest

from wideline_cv.__main__ import build_parser, main


def test_run_requires_video_and_calibration() -> None:
    with pytest.raises(SystemExit):
        build_parser().parse_args(["run"])


def test_run_parses_arguments() -> None:
    args = build_parser().parse_args(["run", "--video", "m.mp4", "--calibration", "c.json"])
    assert args.video == "m.mp4"
    assert str(args.out) == "out"


def test_run_is_a_stub_until_phase_4() -> None:
    assert main(["run", "--video", "m.mp4", "--calibration", "c.json"]) == 2
