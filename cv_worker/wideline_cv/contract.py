"""The result contract (PRD page 19): the one JSON file the worker writes per job.

The schema is a copy of web/src/server/cv/contract/cv-result-1.0.schema.json;
tests/test_contract_sync.py keeps the two identical. The web app checks every
result against it again, plus the rules a schema cannot state.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

SCHEMA_VERSION = "1.0"
SCHEMA_PATH = Path(__file__).parent / "schemas" / f"cv-result-{SCHEMA_VERSION}.schema.json"


@cache
def _validator() -> Draft202012Validator:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


class ResultInvalid(ValueError):
    """The result breaks the contract. The message holds JSON paths, not values."""


def validate(result: dict[str, Any]) -> None:
    errors = sorted(_validator().iter_errors(result), key=lambda e: list(e.absolute_path))
    if errors:
        paths = ["/" + "/".join(str(p) for p in e.absolute_path) for e in errors[:5]]
        raise ResultInvalid("result breaks the contract at " + ", ".join(paths))
