#!/usr/bin/env python3
"""Skill-fitness wrapper around the eval harness (skill-optimization track).

Runs harness/runner/run_eval.py for one skill's eval suite against a CANDIDATE
skills root, then folds the per-(case, arm) validator results into one fitness
JSON object on stdout:

    {"schema_version": "skill-fitness.v1", "score": <mean 0..1>, "per_case": {...}}

This is the `evaluator` half of the GEPA loop (harness/optimize/gepa_skill.py)
and is also usable standalone. Design rules:

- THE GRADER STAYS FROZEN. Cases, gold artifacts, and validator scripts always
  resolve against the canonical repo checkout (harness/runner/matrix.py);
  --skills-root only swaps the skill payload that fixtures.py installs into
  with-skill workspaces. Pair with harness/optimize/frozen_paths_gate.py
  before trusting a candidate payload.
- Harness failures never silently shrink the mean: a missing run dir, a
  validator status of "error", a CLI-rejected pool run, or an invalid manifest
  scores 0.0 and is flagged in per_case[...]["harness_failure"].
- Good-failure cases (validator.expected_status == "fail") score 1.0 when the
  validator correctly returns "fail" and 0.0 otherwise; raw validator scores
  are anti-correlated with quality on those cases.
- All numbers are internal/directional only (docs/eval-methodology.md §7).

Usage (from the repo root):

    uv run harness/optimize/fitness.py --skill ci-log-reducer \
        --skills-root /tmp/candidate/skills --arm xs_with_skill

    # plumbing smoke without pool (validates fixtures + gold replay):
    uv run harness/optimize/fitness.py --skill ci-log-reducer --dry-run --replay

Exit codes: 0 fitness computed cleanly; 1 fitness computed but with >=1
harness failure folded in as 0.0; 2 configuration/infrastructure error — no
fitness number was produced, callers must treat this as an exception, never
as a zero score.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
RUN_EVAL = REPO_ROOT / "harness" / "runner" / "run_eval.py"
ARM_NAMES = ("xs_without_skill", "xs_with_skill", "m_without_skill", "m_with_skill")
# Search default: with-skill, smallest model class. Baseline arms are constant
# w.r.t. the candidate payload, so spending pool runs on them per-candidate
# would be pure waste during optimization.
DEFAULT_ARMS = ["xs_with_skill"]
FEEDBACK_ITEM_CHARS = 500
FEEDBACK_ITEMS_MAX = 24


def load_json(path: Path) -> tuple[object | None, str | None]:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        return None, f"unreadable: {exc}"
    try:
        return json.loads(raw), None
    except json.JSONDecodeError as exc:
        return None, f"invalid JSON: {exc}"


def tail(text: str, chars: int = 2000) -> str:
    return text[-chars:] if len(text) > chars else text


def fatal(message: str, detail: str = "") -> None:
    print(
        json.dumps(
            {"schema_version": "skill-fitness.v1", "fatal": message, "detail": tail(detail)}
        ),
        file=sys.stderr,
    )
    raise SystemExit(2)


def clamp01(value: object) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return 0.0
    return max(0.0, min(1.0, float(value)))


def collect_feedback(validator_result: dict) -> list[str]:
    """repair_feedback + failed check details — the reflection fuel."""
    feedback: list[str] = []
    for item in validator_result.get("repair_feedback") or []:
        if isinstance(item, str) and item.strip():
            feedback.append(item.strip()[:FEEDBACK_ITEM_CHARS])
    for check in validator_result.get("checks") or []:
        if isinstance(check, dict) and check.get("status") == "fail":
            feedback.append(
                f"check {check.get('id')}: {str(check.get('detail'))[:FEEDBACK_ITEM_CHARS]}"
            )
    return feedback[:FEEDBACK_ITEMS_MAX]


def grade_run(run_dir: Path, expected_status: str) -> dict:
    """Fold one runs/<suite>/<case>/<arm>/ directory into a fitness row."""
    row: dict = {
        "score": 0.0,
        "validator_status": None,
        "expected_status": expected_status,
        "graded_pass": None,
        "harness_failure": None,
        "feedback": [],
    }
    if not run_dir.is_dir():
        row["harness_failure"] = "missing-run-dir (run_eval never wrote this case/arm)"
        return row

    manifest, err = load_json(run_dir / "manifest.json")
    if err is not None or not isinstance(manifest, dict):
        if (run_dir / "manifest.invalid.json").is_file():
            row["harness_failure"] = "manifest failed run-manifest.v0 validation (manifest.invalid.json)"
        else:
            row["harness_failure"] = f"manifest.json {err or 'is not an object'}"
        return row

    validator_result = manifest.get("validator_result")
    if not isinstance(validator_result, dict):
        row["harness_failure"] = "manifest has no validator_result"
        return row
    status = validator_result.get("status")
    row["validator_status"] = status
    row["feedback"] = collect_feedback(validator_result)

    facts, _facts_err = load_json(run_dir / "run-facts.json")
    if isinstance(facts, dict):
        row["graded_pass"] = facts.get("graded_pass")
        pool = facts.get("pool")
        if isinstance(pool, dict) and pool.get("cli_rejection"):
            row["harness_failure"] = f"pool CLI rejection: {str(pool.get('cli_rejection'))[:200]}"
            return row

    if status == "error":
        row["harness_failure"] = "validator crashed (status: error)"
        return row
    if status not in ("pass", "fail"):
        row["harness_failure"] = f"unexpected validator status {status!r}"
        return row

    if expected_status == "fail":
        # Good-failure case: the only correct outcome is a graded "fail".
        row["score"] = 1.0 if status == "fail" else 0.0
    else:
        row["score"] = clamp01(validator_result.get("score"))
    return row


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Mean-validator-score fitness over one skill's eval suite.",
    )
    parser.add_argument("--skill", help="skill name; default suite becomes evals/suites/skill-<skill>.json")
    parser.add_argument("--suite", help="suite JSON path (overrides the --skill default)")
    parser.add_argument("--skills-root", help="candidate skills root handed to run_eval.py (default: canonical skills/)")
    parser.add_argument("--case", action="append", default=[], dest="cases", help="case id filter (repeatable)")
    parser.add_argument("--arm", action="append", default=[], dest="arms", choices=ARM_NAMES, help=f"arm filter (repeatable; default {DEFAULT_ARMS})")
    parser.add_argument("--runs-root", help="where run_eval writes runs (default: private temp dir, deleted afterwards)")
    parser.add_argument("--keep-runs", action="store_true", help="keep a temp runs root for debugging")
    parser.add_argument("--timeout", type=float, help="per-pool-run timeout seconds (run_eval --timeout)")
    parser.add_argument("--validator-timeout", type=float, help="validator timeout seconds")
    parser.add_argument("--pool-bin", help="pool binary (run_eval --pool-bin)")
    parser.add_argument("--api-url", help="tenant backend (run_eval --api-url)")
    parser.add_argument("--sandbox", choices=("auto", "required", "disabled"), help="run_eval --sandbox")
    parser.add_argument("--dry-run", action="store_true", help="run_eval --dry-run (no pool, no scores; plumbing check)")
    parser.add_argument("--replay", action="store_true", help="with --dry-run: gold-replay validators against expected/")
    parser.add_argument("--json-out", help="also write the fitness JSON to this path")
    args = parser.parse_args()

    if args.suite:
        suite_path = Path(args.suite)
        if not suite_path.is_absolute():
            suite_path = (REPO_ROOT / args.suite).resolve()
    elif args.skill:
        suite_path = REPO_ROOT / "evals" / "suites" / f"skill-{args.skill}.json"
    else:
        fatal("provide --suite or --skill")
    if not suite_path.is_file():
        fatal(f"suite not found: {suite_path}")
    if args.replay and not args.dry_run:
        fatal("--replay requires --dry-run")

    suite, err = load_json(suite_path)
    if err is not None:
        fatal(f"suite {suite_path}: {err}")
    if isinstance(suite, dict):
        suite_name = suite.get("name") or suite_path.stem
        case_entries = suite.get("cases") or []
    elif isinstance(suite, list):
        suite_name, case_entries = suite_path.stem, suite
    else:
        fatal(f"suite {suite_path}: unsupported shape")

    all_case_ids = [Path(str(entry)).name for entry in case_entries]
    case_dirs = {Path(str(entry)).name: REPO_ROOT / str(entry) for entry in case_entries}
    if args.cases:
        unknown = sorted(set(args.cases) - set(all_case_ids))
        if unknown:
            fatal(f"--case id(s) not in suite {suite_name}: {unknown}")
        case_ids = [c for c in all_case_ids if c in set(args.cases)]
    else:
        case_ids = all_case_ids
    arms = args.arms or list(DEFAULT_ARMS)

    expected_status: dict[str, str] = {}
    for case_id in case_ids:
        meta, meta_err = load_json(case_dirs[case_id] / "metadata.json")
        validator = meta.get("validator") if isinstance(meta, dict) else None
        expected_status[case_id] = (
            validator.get("expected_status", "pass") if isinstance(validator, dict) else "pass"
        )
        if meta_err is not None:
            fatal(f"case {case_id}: metadata.json {meta_err}")

    if args.runs_root:
        # Unique child dir per invocation: a reused root must never let stale
        # manifests from a previous run masquerade as current scores.
        base = Path(args.runs_root).resolve()
        base.mkdir(parents=True, exist_ok=True)
        runs_root = Path(tempfile.mkdtemp(prefix="fitness-", dir=base))
        cleanup = False
    else:
        runs_root = Path(tempfile.mkdtemp(prefix=f"skill-fitness-{suite_name}-"))
        cleanup = not args.keep_runs

    cmd = [sys.executable, str(RUN_EVAL), "--suite", str(suite_path), "--runs-root", str(runs_root)]
    if args.skills_root:
        cmd += ["--skills-root", str(Path(args.skills_root).resolve())]
    for case_id in args.cases:
        cmd += ["--case", case_id]
    for arm in arms:
        cmd += ["--arm", arm]
    if args.timeout is not None:
        cmd += ["--timeout", str(args.timeout)]
    if args.validator_timeout is not None:
        cmd += ["--validator-timeout", str(args.validator_timeout)]
    if args.pool_bin:
        cmd += ["--pool-bin", args.pool_bin]
    if args.api_url:
        cmd += ["--api-url", args.api_url]
    if args.sandbox:
        cmd += ["--sandbox", args.sandbox]
    if args.dry_run:
        cmd.append("--dry-run")
    if args.replay:
        cmd.append("--replay")

    try:
        proc = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True)

        if args.dry_run:
            result = {
                "schema_version": "skill-fitness.v1",
                "dry_run": True,
                "ok": proc.returncode == 0,
                "suite": suite_name,
                "exit_code": proc.returncode,
                "stdout_tail": tail(proc.stdout),
                "stderr_tail": tail(proc.stderr),
            }
            out = json.dumps(result, indent=2)
            print(out)
            if args.json_out:
                Path(args.json_out).write_text(out + "\n", encoding="utf-8")
            return 0 if proc.returncode == 0 else 2

        if proc.returncode == 2:
            fatal(
                "run_eval.py exited 2 (configuration error: suite/matrix/credentials/pool probe)",
                proc.stderr + "\n" + proc.stdout,
            )

        per_case: dict[str, dict] = {}
        scores: list[float] = []
        n_failures = 0
        for case_id in case_ids:
            for arm in arms:
                run_dir = runs_root / suite_name / case_id / arm
                row = grade_run(run_dir, expected_status[case_id])
                per_case[f"{case_id}/{arm}"] = row
                scores.append(row["score"])
                if row["harness_failure"]:
                    n_failures += 1

        n_missing = sum(
            1
            for row in per_case.values()
            if str(row.get("harness_failure") or "").startswith("missing-run-dir")
        )
        if proc.returncode == 1 and per_case and n_missing == len(per_case):
            # run_eval exited 1 without writing a single run dir: that is a
            # runner crash (e.g. traceback), not a gradeable all-zero result.
            fatal(
                "run_eval.py exited 1 and produced no run dirs — runner crash, not a zero score",
                proc.stderr + "\n" + proc.stdout,
            )

        result = {
            "schema_version": "skill-fitness.v1",
            "suite": suite_name,
            "skills_root": args.skills_root or "skills (canonical)",
            "arms": arms,
            "score": round(sum(scores) / len(scores), 6) if scores else 0.0,
            "n_runs_expected": len(scores),
            "n_harness_failures": n_failures,
            "run_eval_exit_code": proc.returncode,
            "runs_root": str(runs_root) if not cleanup else None,
            "per_case": per_case,
        }
        out = json.dumps(result, indent=2)
        print(out)
        if args.json_out:
            Path(args.json_out).write_text(out + "\n", encoding="utf-8")
        return 0 if n_failures == 0 else 1
    finally:
        if cleanup:
            shutil.rmtree(runs_root, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
