#!/usr/bin/env python3
"""Repo structure check: eval cases and suites (plan item 13).

Checks, per eval case directory under skills/<skill>/evals/<case-id>/:

- The case folder has exactly the canonical entries (evals/README.md):
  prompt.md, input/, expected/, metadata.json, plus an optional validators/
  directory for bespoke case-local checks.
- metadata.json parses and conforms to schemas/common/eval-case.v1.schema.json.
- `id` equals the case folder name and is prefixed with the skill name.
- `skill` equals the owning skills/<skill>/ directory name.
- `validator.command` references an existing validator script: the canonical
  skill-level scripts/validate_*.ts, or a file under the case's validators/
  directory (the documented bespoke exception). Every path-like argv element
  must exist when resolved from the repo root.

Per skill: ≥3 cases including ≥1 with bucket == "adversarial" (hard gate 2).

Per suite file under evals/suites/*.json: parses, carries a `cases` array of
repo-root-relative paths, and every entry references an existing case
directory containing a metadata.json.

Run from the repo root:

    uv run scripts/check_eval_cases.py

Exits 0 when green, 1 with a per-violation report otherwise.
"""

from __future__ import annotations

import sys
from pathlib import Path

import jsonschema

from checklib import (
    EVAL_CASE_SCHEMA_PATH,
    REPO_ROOT,
    SKILLS_DIR,
    SUITES_DIR,
    Report,
    iter_case_dirs,
    iter_skill_dirs,
    load_json,
)

ALLOWED_CASE_ENTRIES = {"prompt.md", "metadata.json", "input", "expected", "validators"}
MIN_CASES_PER_SKILL = 3


def load_case_schema(report: Report) -> jsonschema.protocols.Validator | None:
    schema, err = load_json(EVAL_CASE_SCHEMA_PATH)
    if err is not None:
        report.fail(EVAL_CASE_SCHEMA_PATH, "eval-case-schema", err)
        return None
    try:
        cls = jsonschema.validators.validator_for(schema)
        cls.check_schema(schema)
        return cls(schema)
    except Exception as exc:  # noqa: BLE001 — any schema breakage is a violation
        report.fail(EVAL_CASE_SCHEMA_PATH, "eval-case-schema", f"not a valid JSON Schema: {exc}")
        return None


def check_case_entries(report: Report, case_dir: Path) -> None:
    """The case folder holds exactly the canonical entries (plus dotfiles)."""
    if not (case_dir / "prompt.md").is_file():
        report.fail(case_dir, "case-prompt", "missing prompt.md")
    if not (case_dir / "input").is_dir():
        report.fail(case_dir, "case-input-dir", "missing input/ directory")
    if not (case_dir / "expected").is_dir():
        report.fail(case_dir, "case-expected-dir", "missing expected/ directory")
    if not (case_dir / "metadata.json").is_file():
        report.fail(case_dir, "case-metadata", "missing metadata.json")
    for entry in sorted(case_dir.iterdir()):
        if entry.name.startswith("."):
            continue
        if entry.name not in ALLOWED_CASE_ENTRIES:
            report.fail(
                entry,
                "case-extra-entry",
                "unexpected entry in case folder; allowed: "
                + ", ".join(sorted(ALLOWED_CASE_ENTRIES)),
            )


def check_validator_command(
    report: Report, skill_dir: Path, case_dir: Path, meta_path: Path, command: object
) -> None:
    if not isinstance(command, list) or not all(isinstance(el, str) for el in command):
        return  # shape violations are already reported by schema validation

    # Every path-like argv element (contains a slash, not a flag) must exist
    # when resolved from the repo root — catches stale gold/script paths.
    for el in command:
        if el.startswith("-") or "/" not in el:
            continue
        if not (REPO_ROOT / el).exists():
            report.fail(
                meta_path,
                "case-validator-path",
                f"validator.command element {el!r} does not exist (resolved from the repo root)",
            )

    # The command must reference an existing validator script: the skill's
    # scripts/validate_*.ts (canonical) or a file under the case's validators/
    # directory (documented bespoke exception).
    skill_scripts = (skill_dir / "scripts").resolve()
    case_validators = (case_dir / "validators").resolve()
    for el in command:
        if el.startswith("-") or "/" not in el:
            continue
        target = (REPO_ROOT / el).resolve()
        if not target.is_file():
            continue
        if target.parent == skill_scripts and target.name.startswith("validate_") and target.suffix == ".ts":
            return
        if case_validators in target.parents:
            return
    report.fail(
        meta_path,
        "case-validator-script",
        "validator.command must reference an existing validator script — the skill's "
        f"scripts/validate_*.ts under {skill_dir.name}/scripts/ or a file under the "
        "case's validators/ directory",
    )


def check_case(
    report: Report,
    skill_dir: Path,
    case_dir: Path,
    validator: jsonschema.protocols.Validator | None,
) -> str | None:
    """Check one case; returns its bucket when metadata is readable."""
    report.count("case(s)")
    check_case_entries(report, case_dir)

    meta_path = case_dir / "metadata.json"
    if not meta_path.is_file():
        return None  # already reported by check_case_entries
    meta, err = load_json(meta_path)
    if err is not None:
        report.fail(meta_path, "case-metadata-json", err)
        return None

    if validator is not None:
        for error in sorted(validator.iter_errors(meta), key=lambda e: e.json_path):
            report.fail(
                meta_path,
                "case-metadata-schema",
                f"{error.json_path}: {error.message}",
            )

    if not isinstance(meta, dict):
        return None

    case_id = meta.get("id")
    if isinstance(case_id, str):
        if case_id != case_dir.name:
            report.fail(
                meta_path,
                "case-id-matches-dirname",
                f"id {case_id!r} must equal the case folder name {case_dir.name!r}",
            )
        if not case_id.startswith(skill_dir.name + "-"):
            report.fail(
                meta_path,
                "case-id-skill-prefix",
                f"id {case_id!r} must be prefixed with the skill name ({skill_dir.name!r}-...)",
            )

    skill_field = meta.get("skill")
    if isinstance(skill_field, str) and skill_field != skill_dir.name:
        report.fail(
            meta_path,
            "case-skill-matches-dir",
            f"skill {skill_field!r} must equal the owning skill directory {skill_dir.name!r}",
        )

    validator_field = meta.get("validator")
    if isinstance(validator_field, dict):
        check_validator_command(
            report, skill_dir, case_dir, meta_path, validator_field.get("command")
        )

    bucket = meta.get("bucket")
    return bucket if isinstance(bucket, str) else None


def check_skill_cases(
    report: Report, skill_dir: Path, validator: jsonschema.protocols.Validator | None
) -> None:
    report.count("skill(s)")
    case_dirs = iter_case_dirs(skill_dir)
    buckets = [check_case(report, skill_dir, case_dir, validator) for case_dir in case_dirs]

    if len(case_dirs) < MIN_CASES_PER_SKILL:
        report.fail(
            skill_dir / "evals",
            "skill-min-cases",
            f"skill has {len(case_dirs)} eval case(s); ≥{MIN_CASES_PER_SKILL} required",
        )
    if not any(bucket == "adversarial" for bucket in buckets):
        report.fail(
            skill_dir / "evals",
            "skill-adversarial-case",
            'skill has no case with bucket == "adversarial"; every skill ships ≥1',
        )


def check_suites(report: Report) -> None:
    if not SUITES_DIR.is_dir():
        report.fail(SUITES_DIR, "suites-dir", "missing evals/suites/ directory")
        return
    suite_paths = sorted(SUITES_DIR.glob("*.json"))
    if not suite_paths:
        report.fail(SUITES_DIR, "suites-present", "no suite *.json files under evals/suites/")
        return

    for suite_path in suite_paths:
        report.count("suite(s)")
        suite, err = load_json(suite_path)
        if err is not None:
            report.fail(suite_path, "suite-json", err)
            continue
        if not isinstance(suite, dict) or not isinstance(suite.get("cases"), list):
            report.fail(suite_path, "suite-shape", "suite must be an object with a `cases` array")
            continue
        for i, entry in enumerate(suite["cases"]):
            if not isinstance(entry, str) or not entry:
                report.fail(
                    suite_path, "suite-entry-type", f"cases[{i}] must be a non-empty string path"
                )
                continue
            if entry.startswith(("/", "..")) or "/../" in entry:
                report.fail(
                    suite_path,
                    "suite-entry-relative",
                    f"cases[{i}] {entry!r} must be a repo-root-relative path",
                )
                continue
            case_dir = REPO_ROOT / entry
            if not case_dir.is_dir():
                report.fail(
                    suite_path,
                    "suite-entry-exists",
                    f"cases[{i}] {entry!r} does not reference an existing case directory",
                )
            elif not (case_dir / "metadata.json").is_file():
                report.fail(
                    suite_path,
                    "suite-entry-case",
                    f"cases[{i}] {entry!r} exists but has no metadata.json (not a case)",
                )


def main() -> int:
    report = Report("check_eval_cases")
    if not SKILLS_DIR.is_dir():
        report.fail(SKILLS_DIR, "skills-dir", "missing skills/ directory at the repo root")
        return report.finish()

    validator = load_case_schema(report)
    for skill_dir in iter_skill_dirs():
        check_skill_cases(report, skill_dir, validator)
    check_suites(report)
    return report.finish()


if __name__ == "__main__":
    sys.exit(main())
