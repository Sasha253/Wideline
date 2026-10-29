"""C09: the licence allow-list in scripts/check_licences.py."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "check_licences.py"


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_licences", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


cl = _load()


def test_permissive_licences_pass() -> None:
    for licence in ["MIT", "MIT License", "BSD License", "BSD-3-Clause", "Apache-2.0", "ISC"]:
        assert cl.verdict("somepkg", licence, {}) is None, licence
    assert cl.verdict("packaging", "Apache-2.0 OR BSD-2-Clause", {}) is None
    assert cl.verdict("structlog", "MIT OR Apache-2.0", {}) is None


def test_copyleft_and_weak_copyleft_fail_unless_excepted() -> None:
    assert cl.verdict("gplpkg", "GPL-3.0-only", {}) is not None
    assert cl.verdict("mplpkg", "Mozilla Public License 2.0 (MPL 2.0)", {}) is not None
    assert cl.verdict("mplpkg", "Mozilla Public License 2.0 (MPL 2.0)", {"mplpkg": "why"}) is None
    assert cl.verdict("gplpkg", "GPL-3.0-only", {"gplpkg": "why"}) is None


def test_agpl_fails_even_with_an_exception() -> None:
    assert cl.verdict("aggie", "AGPL-3.0", {}) is not None
    assert cl.verdict("aggie", "GNU Affero General Public License v3", {"aggie": "no"}) is not None


def test_ultralytics_is_denied() -> None:
    assert cl.verdict("ultralytics", "MIT", {"ultralytics": "no"}) is not None


def test_an_and_expression_needs_every_part() -> None:
    assert cl.verdict("mixed", "MIT AND GPL-2.0", {}) is not None
    assert cl.verdict("numpy", "BSD-3-Clause AND 0BSD AND Zlib", cl.LICENCE_EXCEPTIONS) is None


def test_every_exception_has_a_reason_and_the_model_list_is_empty() -> None:
    assert all(reason.strip() for reason in cl.LICENCE_EXCEPTIONS.values())
    assert cl.MODEL_LICENCE_EXCEPTIONS == {}
