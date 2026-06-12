#!/usr/bin/env python3
"""Repo structure check: every *.schema.json is a valid JSON Schema (plan item 13).

Checks:

- Required shared common contracts exist under schemas/common/.
- Every *.schema.json in the repo (skill output schemas under
  skills/<skill>/schemas/ and shared contracts under schemas/common/) parses
  as JSON, is a JSON object, and validates against its declared metaschema
  ($schema; defaults to draft 2020-12 when absent).

Excluded trees: VCS/venv/tooling dirs and .resources/ (read-only investigation
archive, not shipped contracts).

Run from the repo root:

    uv run scripts/check_schemas.py

Exits 0 when checks pass, 1 with a per-violation report, and 2 for argument or
usage errors. Use --json for a repo-check-result.v1 payload on stdout.
"""

from __future__ import annotations

import sys
from pathlib import Path

import jsonschema

from checklib import COMMON_SCHEMAS_DIR, REPO_ROOT, Report, load_json, parse_check_args

EXCLUDED_DIRS = {
    ".git",
    ".venv",
    ".claude",
    "node_modules",
    "__pycache__",
    ".resources",
    "runs",
}

REQUIRED_COMMON_SCHEMAS = (
    "validator-result.v1.schema.json",
    "eval-case.v1.schema.json",
    "run-manifest.v0.schema.json",
    "case-generation-result.v1.schema.json",
    "eval-error.v1.schema.json",
    "eval-dry-run-summary.v1.schema.json",
)


def find_schema_files() -> list[Path]:
    found: list[Path] = []
    for path in REPO_ROOT.rglob("*.schema.json"):
        rel_parts = path.relative_to(REPO_ROOT).parts
        if any(part in EXCLUDED_DIRS for part in rel_parts[:-1]):
            continue
        found.append(path)
    return sorted(found)


def check_schema_file(report: Report, path: Path) -> None:
    report.count("schema file(s)")
    schema, err = load_json(path)
    if err is not None:
        report.fail(path, "schema-json", err)
        return
    if not isinstance(schema, dict):
        report.fail(
            path,
            "schema-object",
            f"top-level value must be a JSON object, got {type(schema).__name__}",
        )
        return
    try:
        cls = jsonschema.validators.validator_for(
            schema, default=jsonschema.Draft202012Validator
        )
        cls.check_schema(schema)
    except jsonschema.SchemaError as exc:
        report.fail(path, "schema-valid", f"not a valid JSON Schema: {exc.message}")
    except Exception as exc:  # noqa: BLE001 — e.g. unresolvable $schema dialect
        report.fail(path, "schema-valid", f"not a valid JSON Schema: {exc}")


def main(argv: list[str] | None = None) -> int:
    opts = parse_check_args(argv, __doc__ or "Check JSON schemas.")
    report = Report("check_schemas")

    for name in REQUIRED_COMMON_SCHEMAS:
        if not (COMMON_SCHEMAS_DIR / name).is_file():
            report.fail(
                COMMON_SCHEMAS_DIR / name,
                "common-contract-exists",
                "missing required common contract schema",
            )

    schema_files = find_schema_files()
    if not schema_files:
        report.fail(REPO_ROOT, "schemas-present", "no *.schema.json files found in the repo")
    for path in schema_files:
        check_schema_file(report, path)
    return report.finish(json_output=opts.json)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
