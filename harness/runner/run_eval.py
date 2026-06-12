"""External eval runner: drives `pool` over the case x arm matrix (plan item 10).

Usage (from the repo root):

    uv run harness/runner/run_eval.py --suite evals/suites/smoke.json --dry-run
    uv run harness/runner/run_eval.py --suite evals/suites/smoke.json \
        [--case <case-id>]... [--arm <arm>]...

Suite file format: see harness/runner/matrix.py (object with "name" +
"cases": list of case directories, repo-root-relative or absolute).

Per live run, strictly serially:

1. materialize a fixture workspace (harness/runner/fixtures.py; with-skill
   arms get skills/<name>/ copied to <workspace>/.poolside/skills/<name>/),
2. invoke pool as a subprocess (never import forge) with isolated HOME +
   private XDG_STATE_HOME, capturing stdout/stderr/exit/timing,
3. recover the trajectory immediately after the run per
   docs/trajectory-recovery-spike.md (session-record primary path; --latest
   only as fallback F-b),
4. run the case's validator via the argv contract
   `<cmd> --case <case_dir> --workspace <ws> --out <result>`,
5. write runs/<suite>/<case>/<arm>/{prompt.md, stdout.nljson, stderr.txt,
   trajectory.ndjson[, trajectory.atif.json], validator.json, run-facts.json,
   manifest.json} -- manifest.json conforms to run-manifest.v0 and logs every
   hidden-flag/--latest/history-scrape reliance in harness_debt[].

--dry-run prints the exact canonical commands, validates fixtures and
materialization, and validates a manifest-shaped preview -- WITHOUT invoking
pool (no probe, no run). --replay additionally gold-replays each case's
validator against its own expected/ artifacts (no pool either).

Live runs need credentials: export POOLSIDE_TOKEN (preferred) or have
~/.config/poolside/credentials.json (copied into the isolated HOME). The
API URL is always passed explicitly (--api-url / POOLSIDE_API_URL) because
the isolated HOME hides ~/.config/poolside/settings.yaml.
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import uuid6

from harness.runner import artifacts as art
from harness.runner import fixtures as fx
from harness.runner import matrix as mx
from harness.runner import pool_exec as px
from harness.validators.command_result import base_env, run_command
from harness.validators.json_schema import validate_instance
from harness.validators.validator_result import load_validator_result, make_error_result

VALIDATOR_OUT_NAME = "validator.json"
ERROR_SCHEMA_VERSION = "eval-error.v1"


class EvalArgumentParser(argparse.ArgumentParser):
    def __init__(self, *args: object, json_errors: bool = False, **kwargs: object) -> None:
        super().__init__(*args, **kwargs)
        self.json_errors = json_errors

    def error(self, message: str) -> None:
        if self.json_errors:
            emit_error("args", message, 2)
            raise SystemExit(2)
        super().error(message)


def wants_json_errors(argv: list[str]) -> bool:
    return "--robot-dry-run" in argv or "--json-summary" in argv


def emit_error(phase: str, message: str, exit_code: int, *, suggested_command: str | None = None) -> None:
    payload = {
        "schema_version": ERROR_SCHEMA_VERSION,
        "ok": False,
        "phase": phase,
        "exit_code": exit_code,
        "error": {"message": message},
        "suggested_command": suggested_command,
    }
    print(json.dumps(payload, indent=2), file=sys.stderr)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    raw_argv = sys.argv[1:] if argv is None else argv
    parser = EvalArgumentParser(description="Laguna skills eval runner (v0).", json_errors=wants_json_errors(raw_argv))
    parser.add_argument("--suite", required=True, help="Path to a suite JSON file (evals/suites/*.json).")
    parser.add_argument("--case", action="append", default=[], dest="cases", metavar="CASE_ID",
                        help="Run only this case id (repeatable).")
    parser.add_argument("--arm", action="append", default=[], dest="arms", metavar="ARM",
                        help=f"Run only this arm (repeatable). One of: {', '.join(mx.ARMS)}.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print exact commands and validate fixtures without invoking pool.")
    parser.add_argument("--replay", action="store_true",
                        help="With --dry-run: gold-replay each case's validator against its expected/ artifacts.")
    parser.add_argument("--print-manifest", action="store_true",
                        help="With --dry-run: dump the validated manifest preview JSON per run.")
    parser.add_argument("--json-summary", action="store_true",
                        help="With --dry-run: emit one machine-readable JSON summary to stdout instead of prose.")
    parser.add_argument("--robot-dry-run", action="store_true",
                        help="Alias for --dry-run --json-summary.")
    parser.add_argument("--runs-root", type=Path, default=REPO_ROOT / "runs",
                        help="Root for runs/<suite>/<case>/<arm>/ output (default: <repo>/runs).")
    parser.add_argument("--skills-root", type=Path, default=fx.DEFAULT_SKILLS_ROOT,
                        help="Root of skill source dirs (default: <repo>/skills). Overridable for harness self-tests.")
    parser.add_argument("--pool-bin", default=px.DEFAULT_POOL_BIN, help="pool binary (default: pool / $POOL_BIN).")
    parser.add_argument("--sandbox", choices=["auto", "required", "disabled"], default="auto",
                        help="Sandbox mode for live runs. auto (default): required when a container "
                             "runtime is reachable, else disabled + a harness_debt entry. "
                             "Verified live: --sandbox required aborts without one (pool 1.0.5, 2026-06-11).")
    parser.add_argument("--api-url", default=px.DEFAULT_API_URL,
                        help="Backend API URL passed explicitly to every run (default: $POOLSIDE_API_URL or https://api.poolsi.de).")
    parser.add_argument("--timeout", type=float, default=600.0, help="Per-run wall cap for pool, seconds (default 600).")
    parser.add_argument("--validator-timeout", type=float, default=120.0,
                        help="Per-validator wall cap, seconds (default 120).")
    parser.add_argument("--keep-workspaces", action="store_true",
                        help="Keep scratch workspaces (printed) instead of deleting them.")
    args = parser.parse_args(raw_argv)
    if args.robot_dry_run:
        args.dry_run = True
        args.json_summary = True
    if args.replay and not args.dry_run:
        parser.error("--replay is a dry-run feature; pass --dry-run as well")
    if args.print_manifest and not args.dry_run:
        parser.error("--print-manifest is a dry-run feature; pass --dry-run as well")
    if args.json_summary and not args.dry_run:
        parser.error("--json-summary requires --dry-run")
    if args.json_summary and args.print_manifest:
        parser.error("--print-manifest cannot be used with --json-summary")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        suite_name, case_dirs = mx.load_suite(Path(args.suite).resolve())
        cases = [mx.load_case(d) for d in case_dirs]
        specs = mx.build_matrix(cases, args.cases or None, args.arms or None)
    except mx.SuiteError as exc:
        if args.json_summary:
            emit_error("suite", str(exc), 2, suggested_command="uv run harness/runner/run_eval.py --suite evals/suites/smoke.json --robot-dry-run")
            return 2
        print(f"error: {exc}", file=sys.stderr)
        return 2
    if not specs:
        if args.json_summary:
            emit_error("matrix", "matrix is empty (case metadata declares no matching arms)", 2)
            return 2
        print("error: matrix is empty (case metadata declares no matching arms)", file=sys.stderr)
        return 2

    if args.dry_run and args.json_summary:
        return run_dry_json(suite_name, Path(args.suite).resolve(), cases, specs, args)

    print(f"suite {suite_name!r}: {len(cases)} case(s), {len(specs)} run(s) [serial]")
    if args.dry_run:
        return run_dry(suite_name, cases, specs, args)
    return run_live(suite_name, specs, args)


# --------------------------------------------------------------------------- dry run

def run_dry_json(suite_name: str, suite_path: Path, cases: list[mx.Case], specs: list[mx.RunSpec], args: argparse.Namespace) -> int:
    surface = px.canonical_surface()  # robot dry-run never probes the installed CLI
    arms_by_case: dict[str, list[mx.Arm]] = {}
    for spec in specs:
        arms_by_case.setdefault(spec.case.id, []).append(spec.arm)

    fixture_problems: dict[tuple[str, str], list[str]] = {}
    fixture_records: list[dict] = []
    for case in cases:
        arms = arms_by_case.get(case.id)
        if arms is None:
            continue
        case_problems: list[str] = []
        for arm in arms:
            problems = fx.validate_fixture(case, [arm], args.skills_root)
            fixture_problems[(case.id, arm.name)] = problems
            for problem in problems:
                if problem not in case_problems:
                    case_problems.append(problem)
        fixture_records.append({
            "case_id": case.id,
            "status": "invalid" if case_problems else "ok",
            "arms": [arm.name for arm in arms],
            "problems": case_problems,
        })

    run_records: list[dict] = []
    for spec in specs:
        record = dry_run_one_record(suite_name, spec, surface, args, fixture_problems.get((spec.case.id, spec.arm.name), []))
        run_records.append(record)
    run_preview_failures = sum(1 for record in run_records if not record["ok"])

    replay_records: list[dict] = []
    replay_failures = 0
    if args.replay:
        for case in cases:
            if case.id not in arms_by_case:
                continue
            if any(fixture_problems.get((case.id, arm.name)) for arm in arms_by_case[case.id]):
                replay_records.append({
                    "case_id": case.id,
                    "status": "skipped",
                    "expected_status": case.expected_status,
                    "reason": "fixture invalid",
                })
                continue
            replay_record = replay_case_record(case, args)
            replay_records.append(replay_record)
            if replay_record["status"] != "pass":
                replay_failures += 1

    fixture_invalid_cases = sum(
        1
        for case_id, arms in arms_by_case.items()
        if any(fixture_problems.get((case_id, arm.name)) for arm in arms)
    )
    failures = run_preview_failures + replay_failures
    summary = {
        "schema_version": "eval-dry-run-summary.v1",
        "ok": failures == 0,
        "suite": {"name": suite_name, "path": display_path(suite_path)},
        "filters": {"cases": args.cases or None, "arms": args.arms or None},
        "counts": {
            "cases_loaded": len(cases),
            "runs_planned": len(specs),
            "fixture_invalid_cases": fixture_invalid_cases,
            "run_preview_failures": run_preview_failures,
            "replay_failures": replay_failures,
            "failures": failures,
        },
        "fixtures": fixture_records,
        "runs": run_records,
        "replays": replay_records,
    }
    errors = validate_instance(summary, "eval-dry-run-summary.v1")
    if errors:
        print("error: dry-run summary failed schema validation:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1
    print(json.dumps(summary, indent=2))
    return 0 if summary["ok"] else 1


def dry_run_one_record(
    suite_name: str,
    spec: mx.RunSpec,
    surface: px.PoolSurface,
    args: argparse.Namespace,
    fixture_problems: list[str],
) -> dict:
    case, arm = spec.case, spec.arm
    base = {
        "label": spec.label,
        "case_id": case.id,
        "case_dir": display_path(case.case_dir),
        "skill": case.skill or None,
        "arm": arm.name,
        "model_class": arm.model_class,
        "agent_name": arm.agent_name,
        "with_skill": arm.with_skill,
    }
    if fixture_problems:
        return {
            "ok": False,
            **base,
            "fixture": dry_run_fixture_record("invalid", fixture_problems, False, args.keep_workspaces, None),
            "pool_command": None,
            "environment": None,
            "validator": None,
            "manifest_preview": None,
        }

    try:
        mat = fx.materialize(case, arm, args.skills_root, include_credentials=False)
    except FileNotFoundError as exc:
        return {
            "ok": False,
            **base,
            "fixture": dry_run_fixture_record("error", [str(exc)], False, args.keep_workspaces, None),
            "pool_command": None,
            "environment": None,
            "validator": None,
            "manifest_preview": None,
        }

    ok = True
    problems: list[str] = []
    try:
        skill_dest = mat.workspace / ".poolside" / "skills" / case.skill
        if arm.with_skill:
            if not (skill_dest / "SKILL.md").is_file():
                problems.append(f"with-skill arm but {skill_dest}/SKILL.md missing")
                ok = False
            if (skill_dest / "evals").exists():
                problems.append("skill evals/ leaked into workspace (gold contamination)")
                ok = False
        elif skill_dest.exists():
            problems.append("baseline arm has a materialized skill")
            ok = False

        run_dir = args.runs_root / suite_name / case.id / arm.name  # not written in dry-run
        run_id = robot_preview_run_id(suite_name, spec)
        prompt_text = case.prompt_path.read_text(encoding="utf-8")
        argv, cmd_debt, _ = px.build_pool_command(
            surface, pool_bin=args.pool_bin, prompt_file=run_dir / "prompt.md", prompt_text=prompt_text,
            workspace=mat.workspace, agent_name=arm.agent_name, run_id=run_id, api_url=args.api_url,
        )
        validator_argv = validator_command_argv(case, mat.workspace, run_dir / VALIDATOR_OUT_NAME)

        skill_version, version_problem = art.read_skill_version(args.skills_root, case.skill)
        now = "1970-01-01T00:00:00Z"
        preview_debt = cmd_debt + [art.debt("hd-3"), art.debt("hd-7"), art.debt("isolation-residue"), art.debt("nljson-activation")]
        if version_problem:
            preview_debt.append({"kind": "skill-version-unresolved", "detail": version_problem})
        preview = art.build_manifest(
            run_id=run_id, skill_name=case.skill, skill_version=skill_version,
            agent_name=arm.agent_name, pool_version="dry-run", command=argv, exit_code=0,
            artifacts=planned_artifacts(), started_at=now, finished_at=now, duration_ms=0,
            validator_result=make_error_result(case.id, 0),
            harness_debt=preview_debt,
        )
        manifest_errors = validate_instance(preview, art.MANIFEST_SCHEMA)
        if manifest_errors:
            ok = False

        normalized_argv = normalize_preview_paths(argv, mat)
        normalized_validator_argv = normalize_preview_paths(validator_argv, mat)
        normalized_preview = normalize_preview_paths(preview, mat)
        return {
            "ok": ok,
            "run_id": run_id,
            **base,
            "fixture": dry_run_fixture_record("ok" if not problems else "invalid", problems, mat.skill_materialized, args.keep_workspaces, mat),
            "pool_command": {"argv": normalized_argv, "shell": shell_join(normalized_argv), "debt": cmd_debt},
            "environment": {
                "home": "<home>" if args.keep_workspaces else None,
                "xdg_state_home": "<xdg_state_home>" if args.keep_workspaces else None,
                "poolside_token": "not-used-in-dry-run",
                "credentials": "not-copied-in-dry-run",
            },
            "validator": {"argv": normalized_validator_argv, "expected_status": case.expected_status},
            "manifest_preview": {"valid": not manifest_errors, "errors": manifest_errors, "manifest": normalized_preview},
        }
    finally:
        if not args.keep_workspaces:
            mat.cleanup()


def replay_case_record(case: mx.Case, args: argparse.Namespace) -> dict:
    workspace = fx.materialize_replay_workspace(case)
    out_dir = Path(tempfile.mkdtemp(prefix=f"laguna-replay-out-{case.id}-"))
    out_path = out_dir / VALIDATOR_OUT_NAME
    try:
        argv = validator_command_argv(case, workspace, out_path)
        result = run_command(argv, cwd=REPO_ROOT, env=base_env(), timeout_s=args.validator_timeout)
        instance, errors = load_validator_result(out_path)
        if instance is None:
            record = {
                "case_id": case.id,
                "status": "fail",
                "expected_status": case.expected_status,
                "actual_status": None,
                "validator_exit_code": result.exit_code,
                "timed_out": result.timed_out,
                "errors": errors,
            }
            if result.stderr.strip():
                record["stderr_tail"] = result.stderr_tail(500)
            return record
        status = "pass" if instance["status"] == case.expected_status else "fail"
        return {
            "case_id": case.id,
            "status": status,
            "expected_status": case.expected_status,
            "actual_status": instance["status"],
            "validator_exit_code": result.exit_code,
            "timed_out": result.timed_out,
            "errors": [],
        }
    finally:
        if not args.keep_workspaces:
            shutil.rmtree(workspace, ignore_errors=True)
            shutil.rmtree(out_dir, ignore_errors=True)


def dry_run_fixture_record(status: str, problems: list[str], skill_materialized: bool, scratch_kept: bool, mat: fx.MaterializedRun | None) -> dict:
    normalized_problems = normalize_preview_paths(problems, mat) if mat is not None else problems
    return {
        "status": status,
        "problems": normalized_problems,
        "skill_materialized": skill_materialized,
        "scratch_kept": scratch_kept,
        "scratch": "<scratch>" if mat is not None and scratch_kept else None,
        "workspace": "<workspace>" if mat is not None and scratch_kept else None,
    }


def display_path(path: Path) -> str:
    resolved = path.resolve()
    try:
        return str(resolved.relative_to(REPO_ROOT))
    except ValueError:
        return str(resolved)


def robot_preview_run_id(suite_name: str, spec: mx.RunSpec) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"poolside-skills:{suite_name}:{spec.case.id}:{spec.arm.name}"))


def normalize_preview_paths(value, mat: fx.MaterializedRun):
    replacements = {
        str(mat.workspace): "<workspace>",
        str(mat.home): "<home>",
        str(mat.state): "<xdg_state_home>",
        str(mat.scratch): "<scratch>",
    }

    def normalize(item):
        if isinstance(item, str):
            for original, replacement in replacements.items():
                item = item.replace(original, replacement)
            return item
        if isinstance(item, list):
            return [normalize(child) for child in item]
        if isinstance(item, dict):
            return {key: normalize(child) for key, child in item.items()}
        return item

    return normalize(value)


def run_dry(suite_name: str, cases: list[mx.Case], specs: list[mx.RunSpec], args: argparse.Namespace) -> int:
    failures = 0
    surface = px.canonical_surface()  # dry-run never probes the installed CLI

    # Per-case fixture validation (consolidated, including metadata errors).
    arms_by_case: dict[str, list[mx.Arm]] = {}
    for spec in specs:
        arms_by_case.setdefault(spec.case.id, []).append(spec.arm)
    for case in cases:
        arms = arms_by_case.get(case.id)
        if arms is None:
            continue
        problems = fx.validate_fixture(case, arms, args.skills_root)
        if problems:
            failures += 1
            print(f"\n[fixture] {case.id}: INVALID")
            for problem in problems:
                print(f"  - {problem}")
        else:
            print(f"\n[fixture] {case.id}: ok")

    for spec in specs:
        if fx.validate_fixture(spec.case, [spec.arm], args.skills_root):
            print(f"\n=== {spec.label}: skipped (fixture invalid above)")
            continue
        failures += 0 if dry_run_one(suite_name, spec, surface, args) else 1

    if args.replay:
        for case in cases:
            if case.id not in arms_by_case or fx.validate_fixture(case, [], args.skills_root):
                continue
            failures += 0 if replay_case(case, args) else 1

    status = "DRY-RUN OK" if failures == 0 else f"DRY-RUN FAILED ({failures} problem(s))"
    print(f"\n{status}")
    return 0 if failures == 0 else 1


def dry_run_one(suite_name: str, spec: mx.RunSpec, surface: px.PoolSurface, args: argparse.Namespace) -> bool:
    case, arm = spec.case, spec.arm
    run_dir = args.runs_root / suite_name / case.id / arm.name  # not written in dry-run
    print(f"\n=== {spec.label} (agent {arm.agent_name})")

    try:
        mat = fx.materialize(case, arm, args.skills_root, include_credentials=False)
    except FileNotFoundError as exc:
        print(f"  materialize: FAILED: {exc}")
        return False

    ok = True
    skill_dest = mat.workspace / ".poolside" / "skills" / case.skill
    if arm.with_skill:
        if not (skill_dest / "SKILL.md").is_file():
            print(f"  materialize: FAILED: with-skill arm but {skill_dest}/SKILL.md missing")
            ok = False
        if (skill_dest / "evals").exists():
            print("  materialize: FAILED: skill evals/ leaked into workspace (gold contamination)")
            ok = False
    elif skill_dest.exists():
        print("  materialize: FAILED: baseline arm has a materialized skill")
        ok = False
    if ok:
        kind = "with skill -> .poolside/skills/" + case.skill if arm.with_skill else "baseline (no skill materialized)"
        print(f"  materialize: ok ({kind})")
        print(f"  workspace:   {mat.workspace}")

    run_id = str(uuid6.uuid7())
    prompt_text = case.prompt_path.read_text(encoding="utf-8")
    argv, cmd_debt, _ = px.build_pool_command(
        surface, pool_bin=args.pool_bin, prompt_file=run_dir / "prompt.md", prompt_text=prompt_text,
        workspace=mat.workspace, agent_name=arm.agent_name, run_id=run_id, api_url=args.api_url,
    )
    print(f"  command:     {shell_join(argv)}")
    print(f"  env:         HOME={mat.home} XDG_STATE_HOME={mat.state} "
          f"POOLSIDE_TOKEN={'(passthrough)' if os.environ.get('POOLSIDE_TOKEN') else '(unset; live run copies credentials.json)'}")
    validator_argv = validator_command_argv(case, mat.workspace, run_dir / VALIDATOR_OUT_NAME)
    print(f"  validator:   {shell_join(validator_argv)} (expected_status={case.expected_status})")

    # Manifest-shaped preview must validate against run-manifest.v0.
    skill_version, version_problem = art.read_skill_version(args.skills_root, case.skill)
    now = px.rfc3339(datetime.now(timezone.utc))
    preview_debt = cmd_debt + [art.debt("hd-3"), art.debt("hd-7"), art.debt("isolation-residue"), art.debt("nljson-activation")]
    if version_problem:
        preview_debt.append({"kind": "skill-version-unresolved", "detail": version_problem})
    preview = art.build_manifest(
        run_id=run_id, skill_name=case.skill, skill_version=skill_version,
        agent_name=arm.agent_name, pool_version="dry-run", command=argv, exit_code=0,
        artifacts=planned_artifacts(), started_at=now, finished_at=now, duration_ms=0,
        validator_result=make_error_result(case.id, 0),  # dry-run: validator not executed
        harness_debt=preview_debt,
    )
    errors = validate_instance(preview, art.MANIFEST_SCHEMA)
    if errors:
        print("  manifest:    preview INVALID against run-manifest.v0:")
        for error in errors:
            print(f"    - {error}")
        ok = False
    else:
        print("  manifest:    preview validates against run-manifest.v0")
    if args.print_manifest:
        print(json.dumps(preview, indent=2))

    if args.keep_workspaces:
        print(f"  scratch kept: {mat.scratch}")
    else:
        mat.cleanup()
    return ok


def replay_case(case: mx.Case, args: argparse.Namespace) -> bool:
    """Gold replay (evals/README.md): validator vs the case's own expected/
    artifacts must return validator.expected_status."""
    workspace = fx.materialize_replay_workspace(case)
    out_dir = Path(tempfile.mkdtemp(prefix=f"laguna-replay-out-{case.id}-"))
    out_path = out_dir / VALIDATOR_OUT_NAME
    try:
        argv = validator_command_argv(case, workspace, out_path)
        result = run_command(argv, cwd=REPO_ROOT, env=base_env(), timeout_s=args.validator_timeout)
        instance, errors = load_validator_result(out_path)
        if instance is None:
            print(f"[replay] {case.id}: FAILED (validator exit {result.exit_code}; {'; '.join(errors)})")
            if result.stderr.strip():
                print(f"  stderr tail: {result.stderr_tail(500)}")
            return False
        if instance["status"] != case.expected_status:
            print(f"[replay] {case.id}: FAILED (validator returned {instance['status']!r}, expected {case.expected_status!r})")
            return False
        print(f"[replay] {case.id}: ok (status {instance['status']!r} == expected)")
        return True
    finally:
        if args.keep_workspaces:
            print(f"  replay workspace kept: {workspace}")
        else:
            shutil.rmtree(workspace, ignore_errors=True)
            shutil.rmtree(out_dir, ignore_errors=True)


# --------------------------------------------------------------------------- live run

def run_live(suite_name: str, specs: list[mx.RunSpec], args: argparse.Namespace) -> int:
    if not os.environ.get("POOLSIDE_TOKEN") and not (Path.home() / ".config" / "poolside" / "credentials.json").is_file():
        print("error: live runs need POOLSIDE_TOKEN or ~/.config/poolside/credentials.json "
              "(isolated HOME hides the developer login)", file=sys.stderr)
        return 2
    try:
        surface = px.probe_surface(args.pool_bin)
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(f"pool surface: version={surface.pool_version} exec_subcommand={surface.has_exec_subcommand} "
          f"flags={ {f: s for f, s in surface.flags.items()} } atif={surface.history_has_atif}")

    if args.sandbox == "auto":
        args.sandbox = "required" if px.sandbox_available() else "disabled"
        print(f"sandbox: resolved auto -> {args.sandbox}"
              + ("" if args.sandbox == "required" else " (no container runtime reachable; recorded as harness debt per run)"))

    failures = 0
    for spec in specs:  # STRICTLY SERIAL -- recovery happens inside run_one, immediately after each run
        if spec.case.errors:
            print(f"\n=== {spec.label}: SKIPPED (case invalid: {'; '.join(spec.case.errors)})")
            failures += 1
            continue
        try:
            ok = run_one(suite_name, spec, surface, args)
        except FileNotFoundError as exc:
            print(f"\n=== {spec.label}: FAILED to materialize: {exc}")
            ok = False
        failures += 0 if ok else 1

    print(f"\ndone: {len(specs) - failures}/{len(specs)} run(s) completed without harness failures")
    print("reminder: numbers are internal / directional (docs/eval-methodology.md section 7)")
    return 0 if failures == 0 else 1


def run_one(suite_name: str, spec: mx.RunSpec, surface: px.PoolSurface, args: argparse.Namespace) -> bool:
    case, arm = spec.case, spec.arm
    run_dir = args.runs_root / suite_name / case.id / arm.name
    if run_dir.exists():
        shutil.rmtree(run_dir)  # reruns are idempotent: a run dir holds exactly one run
    run_dir.mkdir(parents=True)
    print(f"\n=== {spec.label} (agent {arm.agent_name})")

    prompt_path = run_dir / "prompt.md"
    shutil.copyfile(case.prompt_path, prompt_path)
    prompt_text = prompt_path.read_text(encoding="utf-8")

    mat = fx.materialize(
        case, arm, args.skills_root,
        include_credentials=True, poolside_token_present=bool(os.environ.get("POOLSIDE_TOKEN")),
    )
    debt: list[dict] = [art.debt("isolation-residue"), art.debt("nljson-activation")]

    run_id = str(uuid6.uuid7())
    argv, cmd_debt, run_id_flag_used = px.build_pool_command(
        surface, pool_bin=args.pool_bin, prompt_file=prompt_path, prompt_text=prompt_text,
        workspace=mat.workspace, agent_name=arm.agent_name, run_id=run_id, api_url=args.api_url,
        sandbox_mode=args.sandbox,  # resolved to required/disabled in run_live before any run
    )
    debt += cmd_debt
    env = px.build_run_env(mat)

    print(f"  command: {shell_join(argv)}")
    result = px.run_pool(argv, env=env, stdout_path=run_dir / "stdout.nljson",
                         stderr_path=run_dir / "stderr.txt", timeout_s=args.timeout)
    print(f"  pool exit {result.exit_code} in {result.duration_ms} ms" + (" (TIMED OUT)" if result.timed_out else ""))
    if result.timed_out:
        debt.append({"kind": "run-timeout", "detail": f"pool killed after {args.timeout}s wall cap; exit code recorded as -9."})
    if result.cli_rejection:
        # pool 0.2.172 exits 0 on unknown flags/commands WITHOUT executing
        # (verified live; see pool_exec docstring) -- this run did no model
        # work, so it must be a harness failure, never a graded arm.
        print(f"  pool REJECTED the command without executing: {result.cli_rejection}")
        debt.append({
            "kind": "cli-arg-rejected-at-runtime",
            "detail": f"pool exited {result.exit_code} but stderr shows {result.cli_rejection!r}; "
                      "pool 0.2.172 exits 0 on unknown flags/commands without running the model, "
                      "so this run is a silent no-op recorded as a harness failure (probe_surface missed a divergence).",
        })

    # Trajectory recovery, immediately after the run (spike steps 3-7).
    recovery = art.recover_trajectory(
        state_dir=mat.state, run_id=run_id, run_dir=run_dir, run_id_flag_used=run_id_flag_used,
        pool_bin=args.pool_bin, history_has_atif=surface.history_has_atif, env=env,
    )
    debt += recovery.debt
    if recovery.error:
        print(f"  trajectory: {recovery.error}")
    elif recovery.trajectory_path:
        print(f"  trajectory: recovered -> {recovery.trajectory_path.name}")

    facts: dict = {}
    if recovery.trajectory_path is not None:
        facts, facts_debt = art.scrape_run_facts(recovery.trajectory_path)
        debt += facts_debt

    # Validator via the argv contract.
    validator_out = run_dir / VALIDATOR_OUT_NAME
    validator_argv = validator_command_argv(case, mat.workspace, validator_out)
    validator_run = run_command(validator_argv, cwd=REPO_ROOT, env=base_env(), timeout_s=args.validator_timeout)
    validator_result, validator_errors = load_validator_result(validator_out)
    if validator_result is None:
        if validator_out.is_file():  # keep the malformed evidence
            validator_out.rename(run_dir / "validator.raw.json")
        validator_result = make_error_result(case.id, validator_run.duration_ms)
        validator_out.write_text(json.dumps(validator_result, indent=2) + "\n", encoding="utf-8")
        debt.append({
            "kind": "validator-result-invalid",
            "detail": f"validator exited {validator_run.exit_code}"
                      + (" (timed out)" if validator_run.timed_out else "")
                      + f"; result synthesized as status=error: {'; '.join(validator_errors)}",
        })
    graded_pass = validator_result["status"] == case.expected_status
    print(f"  validator: {validator_result['status']} (expected {case.expected_status}) -> {'PASS' if graded_pass else 'FAIL' if validator_result['status'] != 'error' else 'ERROR'}")

    # Preserve the gradeable workspace artifacts before scratch cleanup.
    # expected/ mirrors workspace-relative output paths (fixtures.py replay
    # contract), so its file list names exactly what the model was asked to
    # produce; without this copy the artifact dies with the temp workspace
    # and reviewers have nothing to judge.
    output_artifacts: dict[str, str] = {}
    output_missing: list[str] = []
    if case.expected_dir.is_dir():
        for gold in sorted(p for p in case.expected_dir.rglob("*") if p.is_file()):
            rel = gold.relative_to(case.expected_dir)
            produced = mat.workspace / rel
            if produced.is_file():
                dest = run_dir / "output" / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(produced, dest)
                output_artifacts[f"output:{rel}"] = str(Path("output") / rel)
            else:
                output_missing.append(str(rel))

    # Sidecar facts (the closed manifest schema has no fields for these).
    run_facts = {
        "schema_version": "run-facts.v0",
        "case_id": case.id,
        "case_dir": str(case.case_dir),
        "arm": arm.name,
        "agent_name": arm.agent_name,
        "expected_status": case.expected_status,
        "graded_pass": graded_pass,
        "pool": {"exit_code": result.exit_code, "timed_out": result.timed_out, "cli_rejection": result.cli_rejection},
        "trajectory_facts": facts or None,
        "recovery_error": recovery.error,
        "session": recovery.session,
        "validator_invocation": {
            "argv": validator_argv, "exit_code": validator_run.exit_code,
            "duration_ms": validator_run.duration_ms, "timed_out": validator_run.timed_out,
        },
        "output_artifacts": {"copied": sorted(output_artifacts.values()), "missing": output_missing},
    }
    (run_dir / "run-facts.json").write_text(json.dumps(run_facts, indent=2) + "\n", encoding="utf-8")

    skill_version, version_problem = art.read_skill_version(args.skills_root, case.skill)
    if version_problem:
        debt.append({"kind": "skill-version-unresolved", "detail": version_problem + "; manifest records 0.0.0."})

    artifact_map = planned_artifacts(
        trajectory=recovery.trajectory_path is not None,
        atif=recovery.atif_path is not None,
        pool_log=recovery.pool_log_path is not None,
    )
    artifact_map.update(output_artifacts)
    manifest = art.build_manifest(
        run_id=run_id, skill_name=case.skill, skill_version=skill_version, agent_name=arm.agent_name,
        pool_version=surface.pool_version, command=argv, exit_code=result.exit_code,
        artifacts=artifact_map, started_at=result.started_at, finished_at=result.finished_at,
        duration_ms=result.duration_ms, validator_result=validator_result, harness_debt=debt,
    )
    manifest_errors = art.write_manifest(run_dir, manifest)
    if manifest_errors:
        print("  manifest: INVALID against run-manifest.v0 (wrote manifest.invalid.json):")
        for error in manifest_errors:
            print(f"    - {error}")

    if args.keep_workspaces:
        print(f"  scratch kept: {mat.scratch}")
    else:
        mat.cleanup()

    # Harness success = the run produced a valid manifest from a command pool
    # actually executed; graded outcome is the report's business, validator
    # "error" and a CLI-rejected (no-op) run are harness failures.
    return not manifest_errors and validator_result["status"] != "error" and result.cli_rejection is None


# --------------------------------------------------------------------------- shared helpers

def validator_command_argv(case: mx.Case, workspace: Path, out_path: Path) -> list[str]:
    """metadata.json validator.command + the fixed argv contract."""
    return [
        *case.validator_command,
        "--case", str(case.case_dir),
        "--workspace", str(workspace),
        "--out", str(out_path),
    ]


def planned_artifacts(*, trajectory: bool = True, atif: bool = False, pool_log: bool = False) -> dict[str, str]:
    """Artifact name -> run-dir-relative path map for run-manifest.v0."""
    artifacts = {
        "prompt": "prompt.md",
        "stdout": "stdout.nljson",
        "stderr": "stderr.txt",
        "validator_result": VALIDATOR_OUT_NAME,
        "run_facts": "run-facts.json",
        "manifest": "manifest.json",
    }
    if trajectory:
        artifacts["trajectory_ndjson"] = "trajectory.ndjson"
    if atif:
        artifacts["trajectory_atif"] = "trajectory.atif.json"
    if pool_log:
        artifacts["pool_log"] = "pool.log"
    return artifacts


def shell_join(argv: list[str]) -> str:
    return " ".join(shlex.quote(a) for a in argv)


if __name__ == "__main__":
    sys.exit(main())
