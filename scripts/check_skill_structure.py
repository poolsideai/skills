#!/usr/bin/env python3
"""Repo structure check: skill directories and SKILL.md frontmatter (plan item 13).

Checks, per skill directory under skills/ (skipping _shared and hidden dirs):

- SKILL.md exists and opens with parseable YAML frontmatter.
- Frontmatter `name`: matches ^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$ and equals
  the directory name (docs/authoring-guide.md §3).
- Frontmatter `description`: non-empty string, ≤1024 chars.
- Frontmatter `metadata.version`: semver string.
- Frontmatter `compatibility` (optional): string ≤500 chars.
- Frontmatter has no `allowed-tools` key (unsupported by pool; tool and runtime
  expectations are documented as prose per skill).
- SKILL.md body has a non-goals section: a heading containing
  "Do not use when" or "Non-goals" (hard authoring gate 2).
- The skill ships schemas/ with at least one *.schema.json (hard gate 1:
  output schema before prose).
- The skill ships scripts/ with at least one validate_*.ts executable
  validator (hard gate 1: validator before prose).

Run from the repo root:

    uv run scripts/check_skill_structure.py

Exits 0 when green, 1 with a per-violation report otherwise.
"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml

from checklib import (
    COMPATIBILITY_MAX_CHARS,
    DESCRIPTION_MAX_CHARS,
    SEMVER_RE,
    SKILL_NAME_RE,
    SKILLS_DIR,
    Report,
    iter_skill_dirs,
    split_frontmatter,
)

NON_GOALS_MARKERS = ("do not use when", "non-goals", "non goals")


def check_frontmatter(report: Report, skill_dir: Path, skill_md: Path) -> None:
    try:
        text = skill_md.read_text(encoding="utf-8")
    except OSError as exc:
        report.fail(skill_md, "skill-md-readable", f"unreadable: {exc}")
        return

    parts = split_frontmatter(text)
    if parts is None:
        report.fail(
            skill_md,
            "frontmatter-fenced",
            "SKILL.md must open with a `---` YAML frontmatter block closed by `---`",
        )
        return
    yaml_text, body = parts

    try:
        fm = yaml.safe_load(yaml_text)
    except yaml.YAMLError as exc:
        report.fail(skill_md, "frontmatter-parse", f"frontmatter is not valid YAML: {exc}")
        return
    if not isinstance(fm, dict):
        report.fail(
            skill_md,
            "frontmatter-parse",
            f"frontmatter must be a YAML mapping, got {type(fm).__name__}",
        )
        return

    # name
    name = fm.get("name")
    if not isinstance(name, str) or not name:
        report.fail(skill_md, "frontmatter-name", "frontmatter `name` is required and must be a string")
    else:
        if not SKILL_NAME_RE.fullmatch(name):
            report.fail(
                skill_md,
                "frontmatter-name-regex",
                f"name {name!r} does not match {SKILL_NAME_RE.pattern}",
            )
        if name != skill_dir.name:
            report.fail(
                skill_md,
                "frontmatter-name-matches-dir",
                f"name {name!r} must equal the skill directory name {skill_dir.name!r}",
            )

    # description
    description = fm.get("description")
    if not isinstance(description, str) or not description.strip():
        report.fail(
            skill_md,
            "frontmatter-description",
            "frontmatter `description` is required and must be a non-empty string",
        )
    elif len(description) > DESCRIPTION_MAX_CHARS:
        report.fail(
            skill_md,
            "frontmatter-description-length",
            f"description is {len(description)} chars; max {DESCRIPTION_MAX_CHARS}",
        )

    # metadata.version
    metadata = fm.get("metadata")
    version = metadata.get("version") if isinstance(metadata, dict) else None
    if not isinstance(version, str) or not version:
        report.fail(
            skill_md,
            "frontmatter-version",
            "frontmatter `metadata.version` is required and must be a quoted semver string",
        )
    elif not SEMVER_RE.fullmatch(version):
        report.fail(
            skill_md,
            "frontmatter-version-semver",
            f"metadata.version {version!r} is not a valid semver string",
        )

    # allowed-tools is unsupported by pool — must not appear.
    if "allowed-tools" in fm:
        report.fail(
            skill_md,
            "frontmatter-allowed-tools",
            "`allowed-tools` is unsupported (pool does not enforce it); document tool "
            "and runtime expectations as prose in the SKILL.md body instead",
        )

    # compatibility (optional) is length-checked by pool.
    compatibility = fm.get("compatibility")
    if compatibility is not None:
        if not isinstance(compatibility, str):
            report.fail(skill_md, "frontmatter-compatibility", "`compatibility` must be a string")
        elif len(compatibility) > COMPATIBILITY_MAX_CHARS:
            report.fail(
                skill_md,
                "frontmatter-compatibility-length",
                f"compatibility is {len(compatibility)} chars; max {COMPATIBILITY_MAX_CHARS}",
            )

    # Non-goals section in the body.
    if not has_non_goals_heading(body):
        report.fail(
            skill_md,
            "skill-non-goals-section",
            'SKILL.md must have a non-goals heading (e.g. "## Do not use when")',
        )


def has_non_goals_heading(body: str) -> bool:
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped.startswith("#"):
            continue
        heading = stripped.lstrip("#").strip().lower()
        if any(marker in heading for marker in NON_GOALS_MARKERS):
            return True
    return False


def check_skill(report: Report, skill_dir: Path) -> None:
    report.count("skill(s)")

    skill_md = skill_dir / "SKILL.md"
    if skill_md.is_file():
        check_frontmatter(report, skill_dir, skill_md)
    else:
        report.fail(skill_dir, "skill-md-exists", "missing SKILL.md")

    # Hard gate 1: output schema exists.
    schemas_dir = skill_dir / "schemas"
    if not schemas_dir.is_dir():
        report.fail(skill_dir, "skill-schemas-dir", "missing schemas/ directory")
    elif not sorted(schemas_dir.glob("*.schema.json")):
        report.fail(
            schemas_dir,
            "skill-output-schema",
            "schemas/ must contain at least one *.schema.json output schema",
        )

    # Hard gate 1: executable validator exists.
    scripts_dir = skill_dir / "scripts"
    if not scripts_dir.is_dir():
        report.fail(skill_dir, "skill-scripts-dir", "missing scripts/ directory")
    elif not sorted(scripts_dir.glob("validate_*.ts")):
        report.fail(
            scripts_dir,
            "skill-validator-script",
            "scripts/ must contain at least one validate_*.ts executable validator",
        )


def main() -> int:
    report = Report("check_skill_structure")
    if not SKILLS_DIR.is_dir():
        report.fail(SKILLS_DIR, "skills-dir", "missing skills/ directory at the repo root")
        return report.finish()

    skill_dirs = iter_skill_dirs()
    if not skill_dirs:
        report.fail(SKILLS_DIR, "skills-present", "no skill directories found under skills/")
    for skill_dir in skill_dirs:
        check_skill(report, skill_dir)
    return report.finish()


if __name__ == "__main__":
    sys.exit(main())
