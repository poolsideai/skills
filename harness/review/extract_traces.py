#!/usr/bin/env -S uv run python
"""Extract review traces from eval run dirs into one traces.json.

Feeds harness/review/app (the human annotation interface used for the
error-analysis-first discipline in docs/eval-methodology.md section "error
analysis"). The review unit is one case x arm `pool exec` run: this script
walks runs/<suite>/<case>/<arm>/ dirs produced by harness/runner/run_eval.py
and flattens each into a self-contained trace object the browser can render
without touching the filesystem.

Sampling stays here, outside the app (build-review-interface guideline):
--sample N picks a seeded random subset.

--demo synthesizes plausible traces from the eval cases' gold expected/
artifacts so the interface can be built, tested, and demoed before any live
runs exist. Demo traces are marked "demo": true and banner-flagged in the UI.

Usage:
  uv run harness/review/extract_traces.py --runs-root runs --out runs/review/traces.json
  uv run harness/review/extract_traces.py --demo --out runs/review/traces.json
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from harness.runner import matrix as mx  # noqa: E402
from harness.runner import report  # noqa: E402

TRACES_SCHEMA_VERSION = "review-traces.v0"
MAX_STEP_DETAIL = 4000
MAX_STEPS = 300
MAX_FILE_CONTENT = 200_000


def _read_json(path: Path) -> object | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _read_text(path: Path, limit: int = MAX_FILE_CONTENT) -> str | None:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    return text if len(text) <= limit else text[:limit] + f"\n… [truncated {len(text) - limit} chars]"


def _clip(value: object, limit: int = MAX_STEP_DETAIL) -> str:
    text = value if isinstance(value, str) else json.dumps(value, indent=2, ensure_ascii=False)
    return text if len(text) <= limit else text[:limit] + f"… [truncated {len(text) - limit} chars]"


def final_message_from_nljson(stdout_path: Path) -> str | None:
    """Last assistant-ish text event in the sparse NLJSON stream. The final
    answer surfaces as a `thought`/message-like event (model-access spike
    section 5); shapes are internal, so collect tolerantly and keep the last."""
    if not stdout_path.is_file():
        return None
    last: str | None = None
    for line in stdout_path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(event, dict):
            continue
        if event.get("type") in ("thought", "message", "assistant", "text", "result"):
            for key in ("text", "content", "message", "value"):
                if isinstance(event.get(key), str) and event[key].strip():
                    last = event[key]
                    break
    return last


def trajectory_steps(trajectory_path: Path) -> list[dict]:
    """Tolerant flattening of the internal trajectory NDJSON into display
    steps. Never used for grading (eval-methodology: never grade NLJSON) —
    review context only."""
    if not trajectory_path.is_file():
        return []
    steps: list[dict] = []
    for line in trajectory_path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            steps.append({"kind": "raw", "title": "unparseable line", "detail": _clip(line)})
            continue
        if not isinstance(event, dict):
            continue
        kind = next((str(event[k]) for k in ("type", "event", "kind") if event.get(k)), "event")
        name = next((str(event[k]) for k in ("name", "tool", "tool_name") if event.get(k)), "")
        title = f"{kind}{f' · {name}' if name else ''}"
        steps.append({"kind": kind, "title": title, "detail": _clip(event)})
        if len(steps) >= MAX_STEPS:
            steps.append({"kind": "raw", "title": "trajectory truncated", "detail": f"more than {MAX_STEPS} events; open trajectory.ndjson directly"})
            break
    return steps


def case_index(skills_root: Path) -> dict[str, mx.Case]:
    cases: dict[str, mx.Case] = {}
    for meta in sorted(skills_root.glob("*/evals/*/metadata.json")):
        case = mx.load_case(meta.parent)
        cases[case.id] = case
    return cases


def gold_files(case: mx.Case | None) -> list[dict]:
    if case is None or not case.expected_dir.is_dir():
        return []
    return [
        {"path": str(p.relative_to(case.expected_dir)), "content": _read_text(p) or ""}
        for p in sorted(case.expected_dir.rglob("*")) if p.is_file()
    ]


def extract_run(run_dir: Path, suite: str, case_id: str, arm: str, cases: dict[str, mx.Case]) -> dict:
    manifest = _read_json(run_dir / "manifest.json") or _read_json(run_dir / "manifest.invalid.json") or {}
    facts = _read_json(run_dir / "run-facts.json") or {}
    validator = _read_json(run_dir / "validator.json")
    case = cases.get(case_id)

    output_files = []
    output_dir = run_dir / "output"
    if output_dir.is_dir():
        output_files = [
            {"path": str(p.relative_to(output_dir)), "content": _read_text(p) or "", "missing": False}
            for p in sorted(output_dir.rglob("*")) if p.is_file()
        ]
    for missing in (facts.get("output_artifacts") or {}).get("missing", []):
        output_files.append({"path": missing, "content": "", "missing": True})

    skill = (manifest.get("skill") or {}).get("name") or (case.skill if case else None)
    traj_facts = facts.get("trajectory_facts") or {}
    return {
        "trace_id": f"{suite}/{case_id}/{arm}",
        "demo": False,
        "suite": suite,
        "case_id": case_id,
        "arm": arm,
        "skill": skill,
        "agent_name": manifest.get("agent_name") or facts.get("agent_name"),
        "pool_version": manifest.get("pool_version"),
        "run_id": manifest.get("run_id"),
        "bucket": case.metadata.get("bucket") if case else None,
        "difficulty": case.metadata.get("difficulty") if case else None,
        "expected_status": facts.get("expected_status") or (case.expected_status if case else None),
        "case_notes": (case.metadata.get("notes") if case else None),
        "validator": validator,
        "graded_pass": facts.get("graded_pass"),
        "exit_code": manifest.get("exit_code"),
        "duration_ms": manifest.get("timing", {}).get("duration_ms"),
        "timed_out": (facts.get("pool") or {}).get("timed_out"),
        "activation": report._activation(run_dir, skill),
        "model_facts": traj_facts or None,
        "prompt": _read_text(run_dir / "prompt.md"),
        "final_message": final_message_from_nljson(run_dir / "stdout.nljson"),
        "output_files": output_files,
        "gold_files": gold_files(case),
        "trajectory": trajectory_steps(run_dir / "trajectory.ndjson"),
        "stderr_tail": _read_text(run_dir / "stderr.txt", limit=4000),
        "harness_debt": manifest.get("harness_debt", []),
        "command": manifest.get("command"),
        "judge": _read_json(run_dir / "judge.json"),
    }


def collect(runs_root: Path, skills_root: Path, suite_filter: str | None) -> list[dict]:
    cases = case_index(skills_root)
    traces = []
    for manifest_path in sorted(runs_root.glob("*/*/*/manifest*.json")):
        run_dir = manifest_path.parent
        arm, case_id, suite = run_dir.name, run_dir.parent.name, run_dir.parent.parent.name
        if suite == "review" or (suite_filter and suite != suite_filter):
            continue
        traces.append(extract_run(run_dir, suite, case_id, arm, cases))
    return traces


# ---------------------------------------------------------------- demo mode

_DEMO_ARMS = ("xs_with_skill", "m_without_skill")


def demo_traces(skills_root: Path) -> list[dict]:
    """Synthesize one passing and one failing trace per case from gold
    artifacts, exercising every UI state before live runs exist."""
    traces = []
    for case in case_index(skills_root).values():
        golds = gold_files(case)
        for arm in _DEMO_ARMS:
            with_skill = "with_skill" in arm and "without" not in arm
            passing = with_skill  # demo narrative: skill arm passes, baseline fails
            status = case.expected_status if passing else ("error" if case.metadata.get("bucket") == "edge" else "fail")
            checks = [
                {"id": "artifact-exists", "status": "pass" if passing else "fail",
                 "detail": "artifact found at the contract path" if passing else "artifact missing from the contract path"},
                {"id": "output-schema-valid", "status": "pass" if passing else "fail",
                 "detail": "validates against the skill schema" if passing else "2 schema violations (demo)"},
            ]
            validator = {
                "schema_version": "validator-result.v1", "case_id": case.id, "status": status,
                "score": 1.0 if passing else 0.0, "checks": checks,
                "repair_feedback": [] if passing else [f"[demo] write the artifact to the path named in the prompt for {case.skill}"],
                "duration_ms": 120,
            }
            traces.append({
                "trace_id": f"demo/{case.id}/{arm}",
                "demo": True,
                "suite": "demo", "case_id": case.id, "arm": arm, "skill": case.skill,
                "agent_name": "laguna-m.1" if arm.startswith("m_") else "laguna-xs-polaris-base-bs256-s600-ctx256k",
                "pool_version": "demo", "run_id": f"demo-{case.id}-{arm}",
                "bucket": case.metadata.get("bucket"), "difficulty": case.metadata.get("difficulty"),
                "expected_status": case.expected_status,
                "case_notes": case.metadata.get("notes"),
                "validator": validator,
                "graded_pass": status == case.expected_status,
                "exit_code": 0 if passing else 4,
                "duration_ms": 42_000 if passing else 67_000,
                "timed_out": False,
                "activation": ("yes" if with_skill else "n/a (baseline arm)"),
                "model_facts": {"model_id": "demo-model", "tokens": {"input": 6797, "output": 350}},
                "prompt": _read_text(case.prompt_path),
                "final_message": (
                    f"I analyzed the workspace and wrote the result to the contract path.\n\n"
                    f"**Summary (demo trace):** synthetic final message for `{case.id}` / `{arm}`."
                ),
                "output_files": (
                    [dict(f, missing=False) for f in golds] if passing
                    else [{"path": f["path"], "content": "", "missing": True} for f in golds]
                ),
                "gold_files": golds,
                "trajectory": [
                    {"kind": "toolCall", "title": "toolCall · skill" if with_skill else "toolCall · read_file",
                     "detail": json.dumps({"type": "toolCall", "name": "skill" if with_skill else "read_file",
                                           "args": {"name": case.skill} if with_skill else {"path": "README.md"}}, indent=2)},
                    {"kind": "toolCall", "title": "toolCall · run_command",
                     "detail": json.dumps({"type": "toolCall", "name": "run_command", "args": {"cmd": "ls -la"},
                                           "result": "input fixture files listed (demo)"}, indent=2)},
                    {"kind": "thought", "title": "thought",
                     "detail": "Writing the artifact to the contract path now. (demo step)"},
                ],
                "stderr_tail": "" if passing else "Error: task failed (exit 4) [demo]",
                "harness_debt": [{"kind": "demo-trace", "detail": "synthetic trace generated by extract_traces.py --demo; not a real run"}],
                "command": ["pool", "exec", "--prompt-file", "prompt.md", "-o", "json", "(demo)"],
            })
    return traces


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--runs-root", type=Path, default=REPO_ROOT / "runs")
    parser.add_argument("--skills-root", type=Path, default=REPO_ROOT / "skills")
    parser.add_argument("--suite", help="only this suite (default: all)")
    parser.add_argument("--out", type=Path, default=REPO_ROOT / "runs" / "review" / "traces.json")
    parser.add_argument("--sample", type=int, help="seeded random subset of N traces")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--demo", action="store_true", help="synthesize traces from gold artifacts (no runs needed)")
    args = parser.parse_args(argv)

    if args.demo:
        traces = demo_traces(args.skills_root)
    elif args.runs_root.is_dir():
        traces = collect(args.runs_root, args.skills_root, args.suite)
    else:
        print(f"error: {args.runs_root} does not exist and --demo not given", file=sys.stderr)
        return 2
    if args.sample and args.sample < len(traces):
        traces = random.Random(args.seed).sample(traces, args.sample)
    traces.sort(key=lambda t: t["trace_id"])

    args.out.parent.mkdir(parents=True, exist_ok=True)
    payload = {"schema_version": TRACES_SCHEMA_VERSION, "demo": all(t["demo"] for t in traces) if traces else False,
               "trace_count": len(traces), "traces": traces}
    args.out.write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {len(traces)} trace(s) -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
