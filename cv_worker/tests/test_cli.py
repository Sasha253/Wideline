import json
from pathlib import Path

import pytest

from wideline_cv.__main__ import build_parser, main


def test_run_requires_video() -> None:
    with pytest.raises(SystemExit):
        build_parser().parse_args(["run"])


def test_run_parses_arguments() -> None:
    args = build_parser().parse_args(["run", "--video", "m.mp4", "--calibration", "c.json"])
    assert args.video == "m.mp4"
    assert args.calibration == "c.json"
    assert str(args.out) == "out"


def test_run_writes_a_result_and_a_still(tmp_path: Path) -> None:
    code = main(
        [
            "run",
            "--video",
            "missing.mp4",
            "--duration",
            "12",
            "--mode",
            "synthetic",
            "--out",
            str(tmp_path),
        ]
    )
    assert code == 0
    result = json.loads((tmp_path / "result.json").read_text(encoding="utf-8"))
    assert result["schemaVersion"] == "1.0"
    assert (tmp_path / "still.png").read_bytes()[:4] == b"\x89PNG"


def test_synthetic_truth_prints_lab_csv(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["synthetic-truth", "--duration", "60", "--seed", "7"]) == 0
    out = capsys.readouterr().out.splitlines()
    assert out[0] == "type,time,teamSide,onTarget"
    assert all(line.split(",")[0] in {"goal", "shot", "touch"} for line in out[1:])
