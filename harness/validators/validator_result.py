"""Load + validate validator-result.v1 files; synthesize error results (item 11).

Every per-case validator writes a ``validator-result.v1`` JSON object to its
``--out`` path (argv contract: ``<cmd> --case <case_dir> --workspace
<workspace_dir> --out <result_path>``). The harness loads that file through
this module so a malformed result can never silently flow into a manifest:
when the validator crashed, timed out, or wrote junk, ``make_error_result``
produces a schema-valid ``status: "error"`` result instead (errors are never
counted as graded outcomes -- see ``evals/README.md``).
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

if str(Path(__file__).resolve().parents[2]) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.validators.json_schema import validate_instance

SCHEMA_NAME = "validator-result.v1"
_CASE_ID_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


def load_validator_result(path: Path | str) -> tuple[dict | None, list[str]]:
    """Read ``path`` and validate it against validator-result.v1.

    Returns ``(instance, errors)``: ``errors`` is empty iff the file exists,
    parses, and conforms. On any failure ``instance`` is None.
    """
    path = Path(path)
    if not path.is_file():
        return None, [f"validator result file missing: {path}"]
    try:
        instance = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return None, [f"validator result unreadable/unparseable: {exc}"]
    errors = validate_instance(instance, SCHEMA_NAME)
    if errors:
        return None, [f"validator result does not conform to {SCHEMA_NAME}: {e}" for e in errors]
    return instance, []


def make_error_result(case_id: str, duration_ms: int = 0) -> dict:
    """Schema-valid validator-result.v1 with status "error".

    Used when the validator subprocess itself failed (timeout, crash, missing
    or malformed --out file). ``checks`` stays empty (allowed only for
    "error"); ``repair_feedback`` stays empty -- harness failures are not
    model repair feedback. The schema is closed (additionalProperties: false),
    so the human-readable failure detail does NOT live here: callers persist
    it alongside, in run-facts.json and/or the manifest's harness_debt[].
    """
    return {
        "schema_version": SCHEMA_NAME,
        "case_id": _sanitize_case_id(case_id),
        "status": "error",
        "score": 0.0,
        "checks": [],
        "repair_feedback": [],
        "duration_ms": max(0, int(duration_ms)),
    }


def _sanitize_case_id(case_id: str) -> str:
    if _CASE_ID_RE.match(case_id or ""):
        return case_id
    cleaned = re.sub(r"[^a-z0-9]+", "-", (case_id or "unknown-case").lower()).strip("-")
    return cleaned or "unknown-case"
