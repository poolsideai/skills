#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["litellm>=1.70"]
# ///
"""Agent-review a quarantined onboarding bundle.

Reads an onboarding run under runs/onboard/, asks a model to review the
baseline/candidate/report, and writes agent-review.json in the same run. This
does not promote files and never edits the source or candidate.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from harness.llm import make_lm  # noqa: E402

RUNS_ONBOARD = REPO_ROOT / "runs" / "onboard"
DEFAULT_MODEL = os.environ.get("ONBOARD_REVIEW_LM") or os.environ.get("ONBOARD_PREPARE_LM") or os.environ.get("CASEGEN_LM") or "anthropic/claude-sonnet-4-5"


def rel_to_repo(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def resolve_run_dir(raw: str) -> Path:
    path = Path(raw)
    if not path.is_absolute():
        path = REPO_ROOT / path
    resolved = path.resolve()
    allowed = RUNS_ONBOARD.resolve()
    if resolved != allowed and allowed not in resolved.parents:
        raise SystemExit(f"--run-dir must be under {RUNS_ONBOARD}")
    if not resolved.is_dir():
        raise SystemExit(f"--run-dir does not exist: {raw}")
    return resolved


def clip(text: str, limit: int = 80_000) -> str:
    return text if len(text) <= limit else text[:limit] + f"\n...[clipped {len(text) - limit} chars]"


def load_json(path: Path) -> Any:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"_error": f"invalid JSON in {rel_to_repo(path)}"}


def file_snapshot(root: Path, *, limit: int = 100_000) -> str:
    if not root.is_dir():
        return "(missing)"
    chunks: list[str] = []
    used = 0
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        rel = path.relative_to(root)
        if rel.parts and rel.parts[0] in {".git", "node_modules", "__pycache__"}:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        chunk = f"### {rel}\n{text}"
        if used + len(chunk) > limit:
            chunks.append(f"...[snapshot clipped at {limit} chars]")
            break
        chunks.append(chunk)
        used += len(chunk)
    return "\n\n".join(chunks) if chunks else "(no text files)"


def extract_json(text: str) -> object | None:
    candidates = re.findall(r"```(?:json)?\s*\n(.*?)```", text, re.DOTALL)
    candidates.append(text.strip())
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        candidates.append(text[start : end + 1])
    for candidate in candidates:
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass
    return None


def review_prompt(run_dir: Path) -> str:
    report = load_json(run_dir / "report.json")
    triage = load_json(run_dir / "triage.json")
    manifest = load_json(run_dir / "import" / "manifest.json")
    baseline = run_dir / "import" / "baseline"
    candidate = run_dir / "skill"
    cases = run_dir / "cases"
    return f"""Review this quarantined Poolside skill onboarding bundle. Return ONLY JSON:
{{"schema_version":"onboard-agent-review.v1","verdict":"approve|changes_requested|blocked","summary":"...","findings":[{{"severity":"blocker|major|minor","path":"...","issue":"...","recommendation":"..."}}],"promotion_recommendation":"...","next_actions":["..."]}}

Rules:
- Do not promote or edit files.
- Review generated candidate files under the run only.
- If source is external/upstream, confirm the candidate is local/project-owned and the baseline is only a snapshot.
- Check whether SKILL.md, schemas, validators, and eval/case specs are coherent enough for a human to inspect next.
- Prefer actionable findings with exact relative paths.

Run directory: {rel_to_repo(run_dir)}

report.json:
```json
{json.dumps(report, indent=2)}
```

triage.json:
```json
{json.dumps(triage, indent=2)}
```

import/manifest.json:
```json
{json.dumps(manifest, indent=2)}
```

Baseline snapshot:
```text
{clip(file_snapshot(baseline))}
```

Candidate snapshot:
```text
{clip(file_snapshot(candidate))}
```

Case snapshot:
```text
{clip(file_snapshot(cases), 40_000)}
```
"""


def normalize(raw: object, run_dir: Path) -> tuple[dict[str, Any], list[str]]:
    problems: list[str] = []
    if not isinstance(raw, dict):
        raw = {}
        problems.append("model response was not a JSON object")
    verdict = raw.get("verdict")
    if verdict not in {"approve", "changes_requested", "blocked"}:
        verdict = "blocked"
        problems.append("verdict must be approve, changes_requested, or blocked")
    findings = raw.get("findings")
    if not isinstance(findings, list):
        findings = []
        problems.append("findings must be an array")
    clean_findings = []
    for item in findings[:50]:
        if not isinstance(item, dict):
            continue
        severity = item.get("severity") if item.get("severity") in {"blocker", "major", "minor"} else "major"
        clean_findings.append({
            "severity": severity,
            "path": str(item.get("path") or rel_to_repo(run_dir)),
            "issue": str(item.get("issue") or "Review finding omitted issue text."),
            "recommendation": str(item.get("recommendation") or "Inspect the candidate bundle manually."),
        })
    next_actions = raw.get("next_actions")
    if not isinstance(next_actions, list):
        next_actions = []
    result = {
        "schema_version": "onboard-agent-review.v1",
        "ok": True,
        "run_dir": rel_to_repo(run_dir),
        "verdict": verdict,
        "summary": str(raw.get("summary") or "Agent review completed."),
        "findings": clean_findings,
        "promotion_recommendation": str(raw.get("promotion_recommendation") or "No promotion recommendation provided."),
        "next_actions": [str(action) for action in next_actions[:10]],
        "normalization_warnings": problems,
    }
    return result, problems


def smoke_review(run_dir: Path) -> dict[str, Any]:
    report = load_json(run_dir / "report.json")
    review_queue = report.get("review_queue") if isinstance(report, dict) else []
    payload_errors = report.get("payload_errors") if isinstance(report, dict) else []
    verdict = "changes_requested" if payload_errors else "approve" if review_queue else "blocked"
    findings = []
    if payload_errors:
        findings.append({
            "severity": "blocker",
            "path": rel_to_repo(run_dir / "report.json"),
            "issue": "; ".join(str(e) for e in payload_errors),
            "recommendation": "Regenerate or repair the candidate before human promotion.",
        })
    return {
        "schema_version": "onboard-agent-review.v1",
        "ok": True,
        "run_dir": rel_to_repo(run_dir),
        "verdict": verdict,
        "summary": "Smoke review inspected report.json without calling a model.",
        "findings": findings,
        "promotion_recommendation": "Do not promote automatically; use this as a smoke-only status check.",
        "next_actions": ["Run agent review with a model for substantive review."],
        "normalization_warnings": [],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--api-base", default=os.environ.get("ONBOARD_REVIEW_API_BASE"))
    parser.add_argument("--api-key-env", default=os.environ.get("ONBOARD_REVIEW_API_KEY_ENV"))
    parser.add_argument("--max-output-tokens", type=int, default=8000)
    parser.add_argument("--smoke", action="store_true", help="no LM; write a mechanical status review")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    run_dir = resolve_run_dir(args.run_dir)
    if args.smoke:
        result = smoke_review(run_dir)
    else:
        lm = make_lm(args.model, api_base=args.api_base, api_key_env=args.api_key_env, max_tokens=args.max_output_tokens)
        response = lm(review_prompt(run_dir))
        (run_dir / "agent-review-response.txt").write_text(response, encoding="utf-8")
        result, _warnings = normalize(extract_json(response), run_dir)
    (run_dir / "agent-review.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2) if args.json else f"agent review: {result['verdict']}\nreport: {rel_to_repo(run_dir / 'agent-review.json')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
