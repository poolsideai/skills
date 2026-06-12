"""Shared helpers for the repo structure checks (plan work item 13).

Used by check_skill_structure.py, check_eval_cases.py, and check_schemas.py.
Run the checks from the repo root via:

    uv run scripts/check_skill_structure.py
    uv run scripts/check_eval_cases.py
    uv run scripts/check_schemas.py

Each script exits 0 when checks pass, 1 with a per-violation report, and 2 for
argument or usage errors. Use --json for a machine-readable repo-check-result.v1
payload on stdout; JSON parse errors use the same payload shape.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

# Repo layout anchors. These scripts live at <repo>/scripts/, so the repo root
# is one level up — independent of the caller's cwd.
REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "skills"
SUITES_DIR = REPO_ROOT / "evals" / "suites"
COMMON_SCHEMAS_DIR = REPO_ROOT / "schemas" / "common"
EVAL_CASE_SCHEMA_PATH = COMMON_SCHEMAS_DIR / "eval-case.v1.schema.json"

# Frontmatter constraints (docs/authoring-guide.md §3, verified against pool 0.2.172).
SKILL_NAME_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$")
DESCRIPTION_MAX_CHARS = 1024
COMPATIBILITY_MAX_CHARS = 500

# Official semver 2.0.0 regex (https://semver.org/), anchored.
SEMVER_RE = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)"
    r"(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?"
    r"(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$"
)


@dataclass
class Violation:
    path: str  # repo-relative path of the offending file or directory
    check: str  # short stable check id, e.g. "frontmatter-name-regex"
    message: str


@dataclass
class CheckCliOptions:
    json: bool = False


class Report:
    """Collects violations and renders a readable per-violation report."""

    def __init__(self, tool: str) -> None:
        self.tool = tool
        self.violations: list[Violation] = []
        self._counts: dict[str, int] = {}

    def fail(self, path: Path | str, check: str, message: str) -> None:
        self.violations.append(Violation(rel(path), check, message))

    def count(self, what: str, n: int = 1) -> None:
        self._counts[what] = self._counts.get(what, 0) + n

    def to_dict(self) -> dict[str, object]:
        return {
            "schema_version": "repo-check-result.v1",
            "tool": self.tool,
            "status": "fail" if self.violations else "ok",
            "counts": dict(self._counts),
            "violation_count": len(self.violations),
            "violations": [
                {
                    "path": violation.path,
                    "check": violation.check,
                    "message": violation.message,
                }
                for violation in self.violations
            ],
        }

    def finish(self, json_output: bool = False) -> int:
        """Print the report and return the process exit code (0 pass, 1 fail)."""
        if json_output:
            print(json.dumps(self.to_dict(), indent=2))
            return 1 if self.violations else 0

        counted = ", ".join(f"{n} {what}" for what, n in self._counts.items())
        print(f"{self.tool}: checked {counted or 'nothing'}")
        for v in self.violations:
            print(f"FAIL {v.path} [{v.check}] {v.message}")
        if self.violations:
            print(f"{self.tool}: FAIL — {len(self.violations)} violation(s)")
            return 1
        print(f"{self.tool}: OK — 0 violations")
        return 0


class CheckArgumentParser(argparse.ArgumentParser):
    def __init__(self, *args: object, json_requested: bool, tool: str, **kwargs: object) -> None:
        super().__init__(*args, **kwargs)
        self.json_requested = json_requested
        self.tool = tool

    def error(self, message: str) -> None:
        if self.json_requested:
            report = Report(self.tool)
            report.fail("argv", "invalid-arguments", message)
            print(json.dumps(report.to_dict(), indent=2))
            raise SystemExit(2)
        super().error(message)


def parse_check_args(argv: list[str] | None, description: str) -> CheckCliOptions:
    args = sys.argv[1:] if argv is None else argv
    parser = CheckArgumentParser(
        description=description,
        json_requested="--json" in args,
        tool=Path(sys.argv[0]).stem,
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="emit repo-check-result.v1 JSON on stdout",
    )
    ns = parser.parse_args(args)
    return CheckCliOptions(json=ns.json)


def rel(path: Path | str) -> str:
    """Repo-relative string form of a path (falls back to str())."""
    p = Path(path)
    try:
        return str(p.resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(p)


def iter_skill_dirs() -> list[Path]:
    """Skill source directories under skills/.

    Excludes hidden entries and underscore-prefixed shared-code dirs
    (e.g. skills/_shared/, which holds TS helpers, not a skill).
    """
    if not SKILLS_DIR.is_dir():
        return []
    return sorted(
        p
        for p in SKILLS_DIR.iterdir()
        if p.is_dir() and not p.name.startswith((".", "_"))
    )


def iter_case_dirs(skill_dir: Path) -> list[Path]:
    """Eval case directories under skills/<skill>/evals/."""
    evals_dir = skill_dir / "evals"
    if not evals_dir.is_dir():
        return []
    return sorted(
        p for p in evals_dir.iterdir() if p.is_dir() and not p.name.startswith(".")
    )


def split_frontmatter(text: str) -> tuple[str, str] | None:
    """Split a SKILL.md into (yaml_frontmatter, body).

    Returns None when the file does not open with a `---` fence followed by a
    closing `---` line.
    """
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        return None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return "".join(lines[1:i]), "".join(lines[i + 1 :])
    return None


def load_json(path: Path) -> tuple[object | None, str | None]:
    """Load a JSON file; returns (value, None) or (None, error_message)."""
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        return None, f"unreadable: {exc}"
    try:
        return json.loads(raw), None
    except json.JSONDecodeError as exc:
        return None, f"invalid JSON: {exc}"
