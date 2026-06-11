#!/usr/bin/env -S uv run python
"""LLM-judge stage: second-opinion verdicts on eval runs via OpenRouter.

Deliberately NOT a Laguna/Poolside model and not routed through `pool` —
the judge must be independent of both the system under test and its serving
stack. For each run dir under runs/<suite>/<case>/<arm>/ it sends the task
prompt, the model's output artifact, the gold reference, and the
deterministic validator findings to an external judge model, and writes a
structured judge.json next to manifest.json. extract_traces.py picks it up
and the review UI renders it as the "LLM judge" card.

Methodology note (docs/eval-methodology.md, error-analysis-first): this is an
UNVALIDATED grader. Its verdicts are a reading aid for human review, not a
metric — calibrate against human labels (runs/review/labels.json) before
using it for any number that leaves the team.

Usage:
  OPENROUTER_API_KEY=... uv run harness/review/judge.py            # all runs missing judge.json
  uv run harness/review/judge.py --model openai/gpt-5.2 --force    # pick model, re-judge
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from harness.review.extract_traces import (  # noqa: E402
    _read_json,
    _read_text,
    case_index,
    final_message_from_nljson,
    gold_files,
)

API_BASE = "https://openrouter.ai/api/v1"
SCHEMA_VERSION = "judge-verdict.v0"

JUDGE_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["pass", "fail", "borderline"]},
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
        "reasons": {"type": "array", "items": {"type": "string"}},
        "what_should_have_happened": {"type": "string"},
        "diffs_that_matter": {"type": "array", "items": {"type": "string"}},
        "diffs_that_dont_matter": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["verdict", "confidence", "reasons", "what_should_have_happened",
                 "diffs_that_matter", "diffs_that_dont_matter"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = """You are an exacting senior reviewer grading the output of a small coding model \
(Laguna) on a bounded task. You receive the task prompt, the JSON artifact the model wrote, a gold \
reference artifact, and the findings of a deterministic validator.

Rules:
- The gold reference is ONE acceptable answer, not the only one. Judge correctness against the task \
and the source data quoted in the prompt, not string-equality with gold. A difference from gold is \
only a problem if it makes the answer wrong, unsupported, unsafe, or unusable.
- The deterministic validator only checks mechanical rules; you judge substance: is the analysis \
right, complete, grounded, and would a developer be well served by it?
- Be specific. Name fields and values. "summary is vague" is useless; "summary omits that 35 other \
tests passed, which changes triage priority" is useful.
- what_should_have_happened: describe concretely what a correct artifact would have contained, in \
2-4 sentences.
- Classify every observed divergence from gold into diffs_that_matter or diffs_that_dont_matter."""


def _post(path: str, payload: dict, api_key: str, timeout: float) -> dict:
    req = urllib.request.Request(
        f"{API_BASE}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "X-Title": "laguna-skills-eval-judge",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _get(path: str, api_key: str, timeout: float) -> dict:
    req = urllib.request.Request(f"{API_BASE}{path}", headers={"Authorization": f"Bearer {api_key}"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def pick_default_model(api_key: str, timeout: float) -> str:
    """No model named: pick the newest base GPT model OpenRouter serves
    (Ben's call 2026-06-11: judge from outside the Laguna/Claude orbit)."""
    import re

    ids = [m.get("id", "") for m in _get("/models", api_key, timeout).get("data", [])]
    gpts = sorted(i for i in ids if re.fullmatch(r"openai/gpt-\d+(\.\d+)?", i))
    if not gpts:
        raise SystemExit("error: no openai/gpt-<N> model found on OpenRouter; pass --model explicitly")
    return gpts[-1]


def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        text = text.rsplit("```", 1)[0]
    return text.strip()


def judge_payload(model: str, prompt: str, outputs: list[dict], golds: list[dict],
                  validator: dict | None, final_message: str | None, structured: bool) -> dict:
    def files_block(files: list[dict], label: str) -> str:
        if not files:
            return f"## {label}\n(none)"
        parts = [f"## {label}"]
        for f in files:
            parts.append(f"### {f['path']}\n```json\n{f['content']}\n```"
                         if not f.get("missing") else f"### {f['path']}\nMISSING — never written")
        return "\n".join(parts)

    user = "\n\n".join([
        f"## Task prompt given to the model\n{prompt}",
        files_block(outputs, "Model's output artifact"),
        files_block(golds, "Gold reference (one acceptable answer)"),
        f"## Deterministic validator findings\n```json\n{json.dumps(validator, indent=1)}\n```",
        f"## Model's final message\n{final_message or '(none captured)'}",
        "Grade this run." if structured else
        "Grade this run. Respond ONLY with a JSON object matching this schema, no prose:\n"
        + json.dumps(JUDGE_SCHEMA, indent=1),
    ])
    payload: dict = {
        "model": model,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT},
                     {"role": "user", "content": user}],
    }
    if structured:
        payload["response_format"] = {
            "type": "json_schema",
            "json_schema": {"name": "judge_verdict", "strict": True, "schema": JUDGE_SCHEMA},
        }
    return payload


def judge_run(run_dir: Path, case, model: str, api_key: str, timeout: float) -> dict:
    prompt = _read_text(run_dir / "prompt.md") or "(missing)"
    validator = _read_json(run_dir / "validator.json")
    final_message = final_message_from_nljson(run_dir / "stdout.nljson")
    output_dir = run_dir / "output"
    outputs = [
        {"path": str(p.relative_to(output_dir)), "content": _read_text(p) or ""}
        for p in sorted(output_dir.rglob("*")) if p.is_file()
    ] if output_dir.is_dir() else []
    facts = _read_json(run_dir / "run-facts.json") or {}
    for missing in (facts.get("output_artifacts") or {}).get("missing", []):
        outputs.append({"path": missing, "content": "", "missing": True})
    golds = gold_files(case)

    last_error = None
    for structured in (True, False):  # fall back if the model rejects response_format
        try:
            payload = judge_payload(model, prompt, outputs, golds, validator, final_message, structured)
            response = _post("/chat/completions", payload, api_key, timeout)
            content = response["choices"][0]["message"]["content"]
            verdict = json.loads(_strip_fences(content))
            return {
                "schema_version": SCHEMA_VERSION,
                "judge_model": response.get("model", model),
                "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "structured_output": structured,
                "usage": response.get("usage"),
                **{k: verdict.get(k) for k in JUDGE_SCHEMA["properties"]},
            }
        except (urllib.error.HTTPError, urllib.error.URLError, KeyError, json.JSONDecodeError) as exc:
            detail = exc.read().decode("utf-8", "replace")[:300] if isinstance(exc, urllib.error.HTTPError) else str(exc)
            last_error = f"{type(exc).__name__}: {detail}"
    raise RuntimeError(f"judge failed for {run_dir}: {last_error}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--runs-root", type=Path, default=REPO_ROOT / "runs")
    parser.add_argument("--skills-root", type=Path, default=REPO_ROOT / "skills")
    parser.add_argument("--suite", help="only this suite (default: all)")
    parser.add_argument("--model", default=os.environ.get("OPENROUTER_JUDGE_MODEL"),
                        help="OpenRouter model id (default: $OPENROUTER_JUDGE_MODEL, else newest openai/gpt-*)")
    parser.add_argument("--force", action="store_true", help="re-judge runs that already have judge.json")
    parser.add_argument("--timeout", type=float, default=180.0)
    args = parser.parse_args(argv)

    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("error: OPENROUTER_API_KEY is not set", file=sys.stderr)
        return 2
    model = args.model or pick_default_model(api_key, args.timeout)
    print(f"judge model: {model}")

    cases = case_index(args.skills_root)
    judged = skipped = failed = 0
    for manifest_path in sorted(args.runs_root.glob("*/*/*/manifest*.json")):
        run_dir = manifest_path.parent
        arm, case_id, suite = run_dir.name, run_dir.parent.name, run_dir.parent.parent.name
        if suite == "review" or (args.suite and suite != args.suite):
            continue
        if (run_dir / "judge.json").is_file() and not args.force:
            skipped += 1
            continue
        try:
            result = judge_run(run_dir, cases.get(case_id), model, api_key, args.timeout)
        except RuntimeError as exc:
            print(f"[judge] {suite}/{case_id}/{arm}: FAILED ({exc})", file=sys.stderr)
            failed += 1
            continue
        (run_dir / "judge.json").write_text(json.dumps(result, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        judged += 1
        print(f"[judge] {suite}/{case_id}/{arm}: {result['verdict']} ({result['confidence']})")

    print(f"done: {judged} judged, {skipped} skipped (existing), {failed} failed")
    print("reminder: judge verdicts are an unvalidated reading aid — calibrate against human labels")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
