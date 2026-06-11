"""Render the per-case x arm eval report from run manifests (plan item 12).

Usage (from the repo root):

    uv run harness/runner/report.py [--runs-root runs] [--suite smoke] [--out report.md]

Reads runs/<suite>/<case>/<arm>/{manifest.json, run-facts.json, stdout.nljson}
and renders the Plan A benchmark-table shape, watermarked INTERNAL /
DIRECTIONAL (docs/eval-methodology.md section 7 -- never a publishable lift
claim).

Columns per case x arm:

- **validator** -- validator-result.v1 status, graded against the case's
  expected_status (from run-facts.json): pass/fail is "did status match
  expected", error is never a graded outcome.
- **schema** -- output-schema validity, derived from the validator's checks[]
  by convention: the first check whose id contains "schema". Skill validators
  are expected to include such a check; "n/a" means none did.
- **activation** -- NLJSON stream contains a toolCall event with
  name == "skill" (and args.name matching the skill under test when present).
  Brittle stringified-NLJSON parse; logged as harness debt per run (HD/PR5).
- **exit / duration** -- pool subprocess exit code and wall-clock ms.
- **debt** -- distinct harness_debt[] kinds accumulated by the run.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from harness.runner.matrix import ARM_ORDER

WATERMARK = ("**INTERNAL / DIRECTIONAL** -- produced under docs/eval-methodology.md (v0); "
             "not a publishable lift claim. No statistical acceptance policy applies yet.")

_ARM_RANK = {arm.name: i for i, arm in enumerate(ARM_ORDER)}


@dataclass
class Row:
    suite: str
    case_id: str
    arm: str
    skill: str
    validator_status: str
    graded: str          # "pass" | "fail" | "error" | "?"
    schema_valid: str    # "pass" | "fail" | "n/a"
    activation: str      # "yes (n)" | "no" | "n/a"
    exit_code: str
    duration_ms: int
    debt_kinds: list[str]


def collect_rows(runs_root: Path, suite_filter: str | None) -> list[Row]:
    rows: list[Row] = []
    if not runs_root.is_dir():
        return rows
    for manifest_path in sorted(runs_root.glob("*/*/*/manifest.json")):
        run_dir = manifest_path.parent
        suite, case_id, arm = run_dir.parts[-3], run_dir.parts[-2], run_dir.parts[-1]
        if suite_filter and suite != suite_filter:
            continue
        manifest = _read_json(manifest_path)
        if not isinstance(manifest, dict):
            continue
        facts = _read_json(run_dir / "run-facts.json") or {}
        result = manifest.get("validator_result", {})
        status = result.get("status", "?")

        expected = facts.get("expected_status")
        if status == "error":
            graded = "error"
        elif expected is None:
            graded = "?"
        else:
            graded = "pass" if status == expected else "fail"

        rows.append(Row(
            suite=suite,
            case_id=case_id,
            arm=arm,
            skill=manifest.get("skill", {}).get("name", "?"),
            validator_status=status,
            graded=graded,
            schema_valid=_schema_validity(result),
            activation=_activation(run_dir, manifest.get("skill", {}).get("name")),
            exit_code=str(manifest.get("exit_code", "?")),
            duration_ms=int(manifest.get("timing", {}).get("duration_ms", 0)),
            debt_kinds=sorted({d.get("kind", "?") for d in manifest.get("harness_debt", [])}),
        ))
    rows.sort(key=lambda r: (r.suite, r.case_id, _ARM_RANK.get(r.arm, 99)))
    return rows


def _schema_validity(validator_result: dict) -> str:
    """Convention: schema validity is the first checks[] entry whose id
    mentions "schema" (e.g. output-schema-valid). See module docstring."""
    for check in validator_result.get("checks", []):
        if "schema" in str(check.get("id", "")):
            return check.get("status", "n/a")
    return "n/a"


def _activation(run_dir: Path, skill_name: str | None) -> str:
    """Parse stdout.nljson for toolCall name=="skill" events
    (docs/eval-methodology.md section 5; brittle by design, debt-logged)."""
    nljson = run_dir / "stdout.nljson"
    if not nljson.is_file():
        return "n/a"
    skill_calls = 0
    matched = 0
    try:
        with open(nljson, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(event, dict) or event.get("type") != "toolCall" or event.get("name") != "skill":
                    continue
                skill_calls += 1
                args = event.get("args")
                invoked = args.get("name") if isinstance(args, dict) else None
                if invoked is None or invoked == skill_name:
                    matched += 1
    except OSError:
        return "n/a"
    if matched:
        return f"yes ({matched})"
    if skill_calls:
        return f"other-skill ({skill_calls})"
    return "no"


def render(rows: list[Row], runs_root: Path) -> str:
    lines: list[str] = []
    lines.append("# Eval report (v0)")
    lines.append("")
    lines.append(WATERMARK)
    lines.append("")
    if not rows:
        lines.append(f"_No run manifests found under {runs_root}/<suite>/<case>/<arm>/._")
        lines.append("")
        return "\n".join(lines)

    for suite in sorted({r.suite for r in rows}):
        suite_rows = [r for r in rows if r.suite == suite]
        lines.append(f"## Suite `{suite}` -- {len(suite_rows)} run(s)")
        lines.append("")
        lines.append("| case | arm | validator | graded | schema | activation | exit | duration (ms) | debt |")
        lines.append("|---|---|---|---|---|---|---|---|---|")
        for r in suite_rows:
            lines.append(
                f"| {r.case_id} | {r.arm} | {r.validator_status} | {r.graded} | {r.schema_valid} "
                f"| {r.activation} | {r.exit_code} | {r.duration_ms} | {', '.join(r.debt_kinds) or '-'} |"
            )
        lines.append("")

        graded_rows = [r for r in suite_rows if r.graded in ("pass", "fail")]
        errors = [r for r in suite_rows if r.graded == "error"]
        lines.append("Per-arm graded pass rate (errors excluded from the denominator, reported separately):")
        lines.append("")
        for arm in [a.name for a in ARM_ORDER]:
            arm_rows = [r for r in graded_rows if r.arm == arm]
            if not arm_rows:
                continue
            passed = sum(1 for r in arm_rows if r.graded == "pass")
            lines.append(f"- `{arm}`: {passed}/{len(arm_rows)} graded pass")
        if errors:
            lines.append(f"- validator errors (ungraded): {len(errors)}")
        debt_kinds = sorted({k for r in suite_rows for k in r.debt_kinds})
        lines.append(f"- accumulated harness-debt kinds: {', '.join(debt_kinds) or 'none'}")
        lines.append("")

    lines.append("---")
    lines.append(WATERMARK.replace("**", ""))
    lines.append("")
    return "\n".join(lines)


def _read_json(path: Path) -> object | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Render the internal/directional eval report from run manifests.")
    parser.add_argument("--runs-root", type=Path, default=REPO_ROOT / "runs",
                        help="Root holding runs/<suite>/<case>/<arm>/ (default: <repo>/runs).")
    parser.add_argument("--suite", default=None, help="Only report this suite (default: all suites found).")
    parser.add_argument("--out", type=Path, default=None, help="Also write the markdown report to this path.")
    args = parser.parse_args(argv)

    rows = collect_rows(args.runs_root, args.suite)
    report = render(rows, args.runs_root)
    print(report)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(report, encoding="utf-8")
        print(f"(written to {args.out})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
