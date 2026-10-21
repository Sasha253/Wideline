"""Fail if any installed package in the worker environment is AGPL or GPL, or is
on the explicit deny list. Run in CI (PRD: Models and licences)."""

from __future__ import annotations

import json
import subprocess
import sys

DENY_PACKAGES = {"ultralytics", "ultralytics-thop", "yolov5", "yolov8"}
DENY_LICENCE_MARKERS = ("AGPL", "Affero", "GNU General Public License", "GPL-3", "GPLv3")


def is_copyleft(licence: str) -> bool:
    if "LGPL" in licence or "Lesser" in licence:
        return False
    return any(m.lower() in licence.lower() for m in DENY_LICENCE_MARKERS)


def main() -> int:
    out = subprocess.run(
        [sys.executable, "-m", "piplicenses", "--format=json", "--with-system"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    bad: list[str] = []
    for pkg in json.loads(out):
        name, licence = pkg["Name"].lower(), pkg["License"]
        if name in DENY_PACKAGES:
            bad.append(f"{name} (deny list)")
        elif is_copyleft(licence):
            bad.append(f"{name}: {licence}")
    for line in bad:
        print(f"licence check: {line}", file=sys.stderr)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
