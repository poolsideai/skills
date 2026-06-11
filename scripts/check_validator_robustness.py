#!/usr/bin/env python3
"""Repo check: malformed-but-parseable model output must GRADE, never crash.

Regression guard for the null-entry crash class found in review (2026-06-10):
a JSON artifact whose arrays contain null/primitive entries (or whose root is
not an object) used to throw a TypeError inside the skill validators, which
the catch-all converted to status "error" with empty checks and no
repair_feedback. Per the harness contract, "error" means *the validator*
broke (it is excluded from the grading denominator and counted as a harness
failure), so junk model output was being misclassified as harness breakage
and the model got zero repair feedback.

This check replays each skill validator against synthetic workspaces holding
exactly that junk and asserts the result is a graded "fail":

- validator exits 0 (a result file was written -- crashes exit nonzero),
- the --out file conforms to validator-result.v1,
- status == "fail" (NOT "error"),
- checks[] is non-empty and repair_feedback[] is non-empty (the model must
  receive something actionable).

The malformed artifacts live inline here (not as eval cases) on purpose:
evals/ case dirs all follow the eval-case.v1 layout and are picked up by
check_eval_cases.py and the suites; these inputs are validator unit fixtures,
not with/without-skill eval cases.

Run from the repo root (requires bun, like the validators themselves):

    uv run scripts/check_validator_robustness.py

Exits 0 when green, 1 with a per-violation report otherwise.
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from checklib import REPO_ROOT, Report, rel

from harness.validators.command_result import base_env, run_command
from harness.validators.validator_result import load_validator_result

VALIDATOR_TIMEOUT_S = 120.0


@dataclass
class Scenario:
    """One malformed workspace -> expected graded-fail verdict."""

    name: str
    validator: Path  # repo-relative validate_*.ts
    artifact_rel: str  # workspace-relative artifact path
    artifact: object  # JSON value written to artifact_rel
    extra_files: dict[str, str] | None = None  # workspace-relative -> content


SCENARIOS: tuple[Scenario, ...] = (
    Scenario(
        name="ci-log-reducer-null-entries",
        validator=Path("skills/ci-log-reducer/scripts/validate_log_summary.ts"),
        artifact_rel=".laguna/ci-log-summary.json",
        artifact={
            "schema_version": "ci-log-summary.v1",
            "log_file": "ci.log",
            "error_lines": [None, 42, "x", {"line": "not-a-number"}],
            "failing_command": None,
            "suggested_next_commands": [None, 7],
        },
        extra_files={"ci.log": "line one\nERROR boom\nline three\n"},
    ),
    Scenario(
        name="ci-log-reducer-null-root",
        validator=Path("skills/ci-log-reducer/scripts/validate_log_summary.ts"),
        artifact_rel=".laguna/ci-log-summary.json",
        artifact=None,
    ),
    Scenario(
        name="repo-map-null-entries",
        validator=Path("skills/repo-map/scripts/validate_repo_map.ts"),
        artifact_rel=".laguna/repo-map.json",
        artifact={
            "schema_version": "repo-map.v1",
            "languages": [None, 3],
            "frameworks": [None, "flask"],
            "entrypoints": [None, {"path": 1}],
            "key_directories": [None, "src"],
            "test_commands": [None, {"cmd": "pytest"}],
        },
        extra_files={"src/main.py": "print('hi')\n"},
    ),
    Scenario(
        name="repo-map-null-root",
        validator=Path("skills/repo-map/scripts/validate_repo_map.ts"),
        artifact_rel=".laguna/repo-map.json",
        artifact=None,
    ),
    Scenario(
        name="task-contract-null-fields",
        validator=Path("skills/laguna-task-contract/scripts/validate_contract.ts"),
        artifact_rel=".laguna/task-contract.json",
        artifact={
            "goal": None,
            "scope": None,
            "acceptance": {"checks": [None, 5]},
        },
    ),
    Scenario(
        name="task-contract-null-root",
        validator=Path("skills/laguna-task-contract/scripts/validate_contract.ts"),
        artifact_rel=".laguna/task-contract.json",
        artifact=None,
    ),
)


def run_scenario(report: Report, scenario: Scenario) -> None:
    report.count("scenario(s)")
    validator_path = REPO_ROOT / scenario.validator
    if not validator_path.is_file():
        report.fail(scenario.validator, "validator-missing", f"[{scenario.name}] validator script not found")
        return

    workspace = Path(tempfile.mkdtemp(prefix=f"laguna-robust-{scenario.name}-"))
    out_dir = Path(tempfile.mkdtemp(prefix=f"laguna-robust-out-{scenario.name}-"))
    out_path = out_dir / "validator.json"
    try:
        artifact_path = workspace / scenario.artifact_rel
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(json.dumps(scenario.artifact, indent=2) + "\n", encoding="utf-8")
        for rel_path, content in (scenario.extra_files or {}).items():
            file_path = workspace / rel_path
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_text(content, encoding="utf-8")

        # No --case: these are live-repair-loop-shaped invocations (the argv
        # contract makes --case optional), which is also the path with no
        # harness around to absorb a crash.
        argv = ["bun", str(validator_path), "--workspace", str(workspace), "--out", str(out_path)]
        result = run_command(argv, cwd=REPO_ROOT, env=base_env(), timeout_s=VALIDATOR_TIMEOUT_S)

        if result.exit_code != 0:
            report.fail(
                scenario.validator, "validator-crashed",
                f"[{scenario.name}] exit {result.exit_code} on malformed-but-parseable input "
                f"(must grade fail, not crash): {result.stderr_tail(400)}",
            )
            return
        instance, errors = load_validator_result(out_path)
        if instance is None:
            report.fail(
                scenario.validator, "result-invalid",
                f"[{scenario.name}] --out is not a conforming validator-result.v1: {'; '.join(errors)}",
            )
            return
        if instance["status"] != "fail":
            report.fail(
                scenario.validator, "status-not-fail",
                f"[{scenario.name}] status {instance['status']!r} for junk model output -- must be a graded "
                "'fail' (status 'error' means the validator itself broke and is excluded from grading)",
            )
            return
        if not instance["checks"]:
            report.fail(scenario.validator, "checks-empty",
                        f"[{scenario.name}] graded fail must carry at least one check")
        if not instance["repair_feedback"]:
            report.fail(scenario.validator, "repair-feedback-empty",
                        f"[{scenario.name}] graded fail must give the model actionable repair_feedback")
    finally:
        shutil.rmtree(workspace, ignore_errors=True)
        shutil.rmtree(out_dir, ignore_errors=True)


def main() -> int:
    report = Report("check_validator_robustness")
    if shutil.which("bun") is None:
        report.fail(rel(REPO_ROOT), "bun-missing", "bun is required to run the skill validators")
        return report.finish()
    for scenario in SCENARIOS:
        run_scenario(report, scenario)
    return report.finish()


if __name__ == "__main__":
    sys.exit(main())
