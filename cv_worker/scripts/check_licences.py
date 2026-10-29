"""Licence allow-list for the worker environment (PRD: Models and licences; C09).

Every installed package must be under Apache-2.0, MIT, BSD-2-Clause,
BSD-3-Clause or ISC, or be named in LICENCE_EXCEPTIONS with a reason. AGPL
code and the packages on DENY_PACKAGES are refused whatever the exceptions
say. Run in CI on the base environment (core plus dev tools):

    uv run python scripts/check_licences.py

The model profile is run by hand in an environment with the model extra
(`uv sync --extra model`):

    uv run python scripts/check_licences.py --extra model

Its own exceptions (MODEL_LICENCE_EXCEPTIONS) stay empty until B-001 is
answered, so it fails today on the CUDA runtime wheels and the MPL, PSF and
HPND packages that torch and rfdetr bring.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys

ALLOWED = {"Apache-2.0", "MIT", "BSD-2-Clause", "BSD-3-Clause", "ISC"}
DENY_PACKAGES = {"ultralytics", "ultralytics-thop", "yolov5", "yolov8"}
SELF = {"wideline-cv"}

# Each exception: package name (lower case) -> why it is acceptable.
LICENCE_EXCEPTIONS: dict[str, str] = {
    "numpy": "BSD-3-Clause; bundles small 0BSD, MIT, Zlib and CC0-1.0 parts, all permissive",
    "typing-extensions": "PSF-2.0, permissive; a runtime dependency of jsonschema (referencing)",
    "pathspec": "MPL-2.0, dev only (mypy), used unmodified and never shipped",
}
# Cleared for the GPU model image only. Empty until B-001 is answered.
MODEL_LICENCE_EXCEPTIONS: dict[str, str] = {}

# Trove classifier and free-text names to SPDX ids.
ALIASES = {
    "mit license": "MIT",
    "mit": "MIT",
    "bsd license": "BSD-3-Clause",
    "bsd": "BSD-3-Clause",
    "new bsd license": "BSD-3-Clause",
    "bsd 3-clause": "BSD-3-Clause",
    "bsd-3-clause": "BSD-3-Clause",
    "bsd 2-clause": "BSD-2-Clause",
    "bsd-2-clause": "BSD-2-Clause",
    "apache software license": "Apache-2.0",
    "apache license 2.0": "Apache-2.0",
    "apache license, version 2.0": "Apache-2.0",
    "apache 2.0": "Apache-2.0",
    "apache-2.0": "Apache-2.0",
    "isc license (iscl)": "ISC",
    "isc license": "ISC",
    "isc": "ISC",
}
AGPL = re.compile(r"\bAGPL|Affero", re.IGNORECASE)


def _spdx(term: str) -> str:
    t = term.strip().strip("()").strip()
    return ALIASES.get(t.lower(), t)


def licence_ok(licence: str) -> bool:
    """True when the licence text resolves to allowed licences only. An OR
    expression needs one allowed side; AND (or ';' between classifiers) needs
    every part allowed."""
    for part in re.split(r"\s+AND\s+|;", licence):
        options = [_spdx(o) for o in re.split(r"\s+OR\s+", part) if o.strip()]
        if not options or not any(o in ALLOWED for o in options):
            return False
    return True


def verdict(name: str, licence: str, exceptions: dict[str, str]) -> str | None:
    """None when the package passes, else the reason it fails."""
    key = name.lower().replace("_", "-")
    if key in DENY_PACKAGES:
        return f"{key}: on the deny list"
    if AGPL.search(licence):
        return f"{key}: AGPL is never allowed ({licence})"
    if key in SELF or licence_ok(licence) or key in exceptions:
        return None
    return f"{key}: {licence} is not on the allow-list and has no exception"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--extra", choices=["model"], help="Check the model profile")
    args = parser.parse_args(argv)
    exceptions = dict(LICENCE_EXCEPTIONS)
    if args.extra == "model":
        exceptions.update(MODEL_LICENCE_EXCEPTIONS)
    out = subprocess.run(
        [sys.executable, "-m", "piplicenses", "--format=json", "--with-system"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    bad = [
        v
        for pkg in json.loads(out)
        if (v := verdict(pkg["Name"], pkg["License"], exceptions)) is not None
    ]
    for line in bad:
        print(f"licence check: {line}", file=sys.stderr)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
