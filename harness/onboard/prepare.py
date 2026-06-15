#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["litellm>=1.70", "jsonschema>=4.21", "pyyaml>=6.0"]
# ///
"""Prepare quarantined onboarding drafts for human review.

This is the LM-backed phase after triage. It writes draft contracts,
schemas, validators, and optional bootstrap case candidates under
``runs/onboard/`` only. Nothing is promoted into ``skills/`` by this command.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import jsonschema

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from check_skill_structure import check_skill  # noqa: E402
from checklib import Report, SKILL_NAME_RE  # noqa: E402
from harness.llm import make_lm  # noqa: E402
from harness.validators.command_result import base_env, run_command  # noqa: E402
from harness.validators.validator_result import load_validator_result  # noqa: E402
from triage import discover_skill_dirs, infer_output_contract, rel_to_repo, triage_skill  # noqa: E402

RUNS_ONBOARD = REPO_ROOT / "runs" / "onboard"
DEFAULT_MODEL = os.environ.get("ONBOARD_PREPARE_LM") or os.environ.get("CASEGEN_LM") or "anthropic/claude-sonnet-4-5"
SAFE_FILE = re.compile(r"^[A-Za-z0-9._-]+$")


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%SZ")


def resolve_out_dir(raw: str | None, skill: str) -> Path:
    path = Path(raw) if raw else RUNS_ONBOARD / skill / utc_stamp()
    if not path.is_absolute():
        path = REPO_ROOT / path
    resolved = path.resolve()
    allowed = RUNS_ONBOARD.resolve()
    if resolved != allowed and allowed not in resolved.parents:
        raise SystemExit(f"--out-dir must be under {RUNS_ONBOARD}")
    return resolved


def clip(text: str, limit: int = 100_000) -> str:
    return text if len(text) <= limit else text[:limit] + f"\n...[clipped {len(text) - limit} chars]"


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


def pick_skill(source: Path, name: str | None) -> Path:
    skills = discover_skill_dirs(source.resolve())
    if name:
        matches = [p for p in skills if p.name == name]
        if not matches:
            raise SystemExit(f"--skill {name!r} not found below {source}")
        return matches[0]
    if len(skills) != 1:
        raise SystemExit("--source must be one skill dir, or pass --skill")
    return skills[0]


def source_snapshot(skill_dir: Path) -> str:
    chunks: list[str] = []
    for path in sorted(p for p in skill_dir.rglob("*") if p.is_file()):
        rel = path.relative_to(skill_dir)
        if rel.parts[0] in {"evals", ".git", "node_modules", "__pycache__"}:
            continue
        try:
            chunks.append(f"### {rel}\n{path.read_text(encoding='utf-8')}")
        except UnicodeDecodeError:
            continue
    return clip("\n\n".join(chunks))


def load_review_feedback(raw: str | None) -> dict[str, Any] | None:
    if not raw:
        return None
    path = Path(raw)
    if not path.is_absolute():
        path = REPO_ROOT / path
    resolved = path.resolve()
    allowed = RUNS_ONBOARD.resolve()
    if resolved != allowed and allowed not in resolved.parents:
        raise SystemExit(f"--review-dir must be under {RUNS_ONBOARD}")
    review_path = resolved / "agent-review.json" if resolved.is_dir() else resolved
    if not review_path.exists():
        raise SystemExit(f"agent review not found: {review_path}")
    with review_path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise SystemExit(f"agent review is not a JSON object: {review_path}")
    return {"path": rel_to_repo(review_path), "review": data}


def prepare_prompt(skill: str, triage: dict[str, Any], snapshot: str, imported: bool = False, review_feedback: dict[str, Any] | None = None) -> str:
    import_note = (
        "- The source is external/upstream. Do not edit it in place; create a local project-owned candidate draft.\n"
        if imported
        else ""
    )
    review_note = ""
    if review_feedback:
        review_note = f"""
Repair feedback:
```json
{json.dumps(review_feedback, indent=2)}
```

Use the review verdict and findings as blocking acceptance criteria. Return a revised complete candidate, not a prose response.
"""
    return f"""Prepare a Poolside skill onboarding draft. Return ONLY JSON:
{{"skill_md":"complete SKILL.md with YAML frontmatter", "schemas":{{"name.schema.json":"..."}}, "validators":{{"validate_name.ts":"..."}}, "case_specs":[{{"slug":"kebab","bucket":"easy|realistic|adversarial|edge","difficulty":"easy|medium|hard","expected_status":"pass","scenario":"3-6 sentences","target_gap":"coverage gap"}}], "review_notes":["..."]}}

Rules:
{import_note}- Treat the returned files as a new local candidate version, not a patch to the source directory.
- frontmatter name must be `{skill}` and metadata.version must be semver.
- SKILL.md must include Output contract and Do not use when/non-goals sections.
- Output contract must name a deterministic `.laguna/*.json` artifact path.
- Schema(s) must be valid JSON Schema.
- Validator(s) must be `validate_*.ts`, use fixed argv (`--workspace`, `--out`, optional `--case`), write validator-result.v1, use no network/packages, and should import `../../_shared/validator-result.ts`.
- Junk model output must grade `fail`, not crash and not status `error`.
- Propose exactly three bootstrap case specs, including one adversarial or edge case.

Triage:
```json
{json.dumps(triage, indent=2)}
```

Source:
```text
{snapshot}
```
{review_note}
"""


def smoke_payload(skill_dir: Path) -> dict[str, Any]:
    schemas = {p.name: p.read_text(encoding="utf-8") for p in sorted((skill_dir / "schemas").glob("*.schema.json"))} if (skill_dir / "schemas").is_dir() else {}
    validators = {p.name: p.read_text(encoding="utf-8") for p in sorted((skill_dir / "scripts").glob("validate_*.ts"))} if (skill_dir / "scripts").is_dir() else {}
    return {
        "skill_md": (skill_dir / "SKILL.md").read_text(encoding="utf-8"),
        "schemas": schemas,
        "validators": validators,
        "case_specs": [],
        "review_notes": ["smoke copied from an existing skill; no LM call"],
    }


def import_source_baseline(source: Path, out_dir: Path, skill: str) -> dict[str, str]:
    baseline_dir = out_dir / "import" / "baseline" / skill
    shutil.rmtree(baseline_dir, ignore_errors=True)
    baseline_dir.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(
        source,
        baseline_dir,
        ignore=shutil.ignore_patterns(".git", "node_modules", "__pycache__"),
    )
    manifest = {
        "source": str(source),
        "baseline": rel_to_repo(baseline_dir),
        "candidate": rel_to_repo(out_dir / "skill" / skill),
        "note": "Baseline is a read-only snapshot of the external source; generated candidate files stay inside this run.",
    }
    manifest_path = out_dir / "import" / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def payload_filename(name: object, directory: str) -> str | None:
    if not isinstance(name, str) or "\\" in name or name.startswith("/"):
        return None
    parts = name.split("/")
    if len(parts) == 2 and parts[0] == directory:
        leaf = parts[1]
    elif len(parts) == 1:
        leaf = parts[0]
    else:
        return None
    if leaf in {"", ".", ".."} or not SAFE_FILE.fullmatch(leaf):
        return None
    return leaf


def normalize_payload(raw: object, skill: str) -> tuple[dict[str, Any] | None, list[str]]:
    problems: list[str] = []
    if not isinstance(raw, dict):
        return None, ["payload is not a JSON object"]
    skill_md = raw.get("skill_md")
    schemas = raw.get("schemas")
    validators = raw.get("validators")
    specs = raw.get("case_specs", [])
    notes = raw.get("review_notes", [])
    if not isinstance(skill_md, str) or not skill_md.strip():
        problems.append("skill_md must be non-empty text")
    if not SKILL_NAME_RE.fullmatch(skill):
        problems.append(f"skill name {skill!r} is not valid kebab-case")
    clean_schemas: dict[str, str] = {}
    if not isinstance(schemas, dict) or not schemas:
        problems.append("schemas must be a non-empty object")
    else:
        for name, text in schemas.items():
            clean_name = payload_filename(name, "schemas")
            if clean_name is None or not clean_name.endswith(".schema.json"):
                problems.append(f"bad schema filename: {name!r}")
            elif not isinstance(text, str) or not text.strip():
                problems.append(f"schema {name} is empty")
            else:
                clean_schemas[clean_name] = text
    clean_validators: dict[str, str] = {}
    if not isinstance(validators, dict) or not validators:
        problems.append("validators must be a non-empty object")
    else:
        for name, text in validators.items():
            clean_name = payload_filename(name, "scripts")
            if clean_name is None or not clean_name.startswith("validate_") or not clean_name.endswith(".ts"):
                problems.append(f"bad validator filename: {name!r}")
            elif not isinstance(text, str) or not text.strip():
                problems.append(f"validator {name} is empty")
            else:
                clean_validators[clean_name] = text
    if not isinstance(specs, list):
        specs = []
    if not isinstance(notes, list):
        notes = []
    if problems:
        return None, problems
    return {
        "skill_md": skill_md,
        "schemas": clean_schemas,
        "validators": clean_validators,
        "case_specs": [s for s in specs if isinstance(s, dict)][:20],
        "review_notes": [str(n) for n in notes if isinstance(n, str)],
    }, []


def write_draft(out_dir: Path, skill: str, payload: dict[str, Any]) -> Path:
    skill_dir = out_dir / "skill" / skill
    shutil.rmtree(skill_dir, ignore_errors=True)
    (skill_dir / "schemas").mkdir(parents=True)
    (skill_dir / "scripts").mkdir()
    (skill_dir / "SKILL.md").write_text(payload["skill_md"].rstrip() + "\n", encoding="utf-8")
    for name, text in payload["schemas"].items():
        (skill_dir / "schemas" / name).write_text(text.rstrip() + "\n", encoding="utf-8")
    for name, text in payload["validators"].items():
        dest = skill_dir / "scripts" / name
        dest.write_text(text.rstrip() + "\n", encoding="utf-8")
        dest.chmod(0o755)
    (out_dir / "case_specs.json").write_text(json.dumps(payload["case_specs"], indent=2) + "\n", encoding="utf-8")
    (out_dir / "review_notes.json").write_text(json.dumps(payload["review_notes"], indent=2) + "\n", encoding="utf-8")
    return skill_dir


def schema_gate(skill_dir: Path) -> list[str]:
    problems: list[str] = []
    for path in sorted((skill_dir / "schemas").glob("*.schema.json")):
        try:
            schema = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(schema, dict):
                problems.append(f"{path.name}: schema root must be an object")
                continue
            jsonschema.validators.validator_for(schema, default=jsonschema.Draft202012Validator).check_schema(schema)
        except Exception as exc:  # noqa: BLE001
            problems.append(f"{path.name}: invalid schema: {exc}")
    return problems


def validator_gate(skill_dir: Path, timeout_s: float) -> list[str]:
    problems: list[str] = []
    contract = infer_output_contract((skill_dir / "SKILL.md").read_text(encoding="utf-8"))
    artifacts = contract.get("artifact_paths") or []
    if not artifacts:
        return ["draft SKILL.md does not name a deterministic artifact path"]
    tmp_root = Path(tempfile.mkdtemp(prefix="onboard-prepare-"))
    try:
        (tmp_root / "skills").mkdir()
        shutil.copytree(skill_dir, tmp_root / "skills" / skill_dir.name)
        shutil.copytree(REPO_ROOT / "skills" / "_shared", tmp_root / "skills" / "_shared")
        for validator in sorted((tmp_root / "skills" / skill_dir.name / "scripts").glob("validate_*.ts")):
            workspace = Path(tempfile.mkdtemp(prefix="onboard-junk-"))
            out_dir = Path(tempfile.mkdtemp(prefix="onboard-out-"))
            try:
                for artifact in artifacts:
                    target = workspace / artifact
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text("null\n", encoding="utf-8")
                out = out_dir / "validator.json"
                result = run_command(["bun", str(validator), "--workspace", str(workspace), "--out", str(out)], cwd=tmp_root, env=base_env(), timeout_s=timeout_s)
                if result.exit_code != 0:
                    problems.append(f"{validator.name}: crashed on junk artifact: {result.stderr_tail(800)}")
                    continue
                instance, errors = load_validator_result(out)
                if instance is None:
                    problems.append(f"{validator.name}: invalid validator-result: {'; '.join(errors)}")
                    continue
                if instance["status"] != "fail":
                    problems.append(f"{validator.name}: junk artifact status {instance['status']!r}, expected 'fail'")
                if instance["status"] == "fail" and (not instance["checks"] or not instance["repair_feedback"]):
                    problems.append(f"{validator.name}: fail must include checks and repair_feedback")
            finally:
                shutil.rmtree(workspace, ignore_errors=True)
                shutil.rmtree(out_dir, ignore_errors=True)
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)
    return problems


def gate_draft(skill_dir: Path, timeout_s: float) -> dict[str, Any]:
    report = Report("onboard_prepare")
    check_skill(report, skill_dir)
    violations = [f"structure {v.path} [{v.check}] {v.message}" for v in report.violations]
    violations.extend(f"schema {p}" for p in schema_gate(skill_dir))
    violations.extend(f"validator {p}" for p in validator_gate(skill_dir, timeout_s))
    return {"schema_version": "onboard-prepare-gates.v1", "ok": not violations, "violations": violations}


def bootstrap_cases(skill_dir: Path, out_dir: Path, payload: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    if args.skip_cases:
        return {"ok": True, "skipped": True, "reason": "--skip-cases"}
    repo_skill = REPO_ROOT / "skills" / skill_dir.name
    specs = payload["case_specs"][: args.n_cases]
    if not specs:
        return {"ok": False, "skipped": True, "reason": "payload has no case_specs"}
    case_out = out_dir / "cases"
    copied_overlay = False
    try:
        if repo_skill.exists():
            raw_source = Path(args.source)
            source_path = raw_source if raw_source.is_absolute() else REPO_ROOT / raw_source
            if source_path.resolve() != repo_skill.resolve() and repo_skill.resolve() != skill_dir.resolve():
                return {"ok": False, "skipped": True, "reason": f"skills/{skill_dir.name} already exists; refusing temp overlay"}
        else:
            shutil.copytree(skill_dir, repo_skill)
            copied_overlay = True
        cmd = ["uv", "run", "harness/generate/gen_eval_cases.py", "--skill", skill_dir.name, "--bootstrap", "--out-dir", str(case_out), "--model", args.case_model or args.model, "--max-repair-rounds", str(args.max_repair_rounds), "--validator-timeout", str(args.validator_timeout)]
        if args.api_base:
            cmd.extend(["--api-base", args.api_base])
        if args.api_key_env:
            cmd.extend(["--api-key-env", args.api_key_env])
        for spec in specs:
            cmd.extend(["--spec", json.dumps(spec)])
        proc = subprocess.run(cmd, cwd=REPO_ROOT, text=True, capture_output=True, env=os.environ.copy())
        return {"ok": proc.returncode == 0, "skipped": False, "command": cmd, "exit_code": proc.returncode, "out_dir": rel_to_repo(case_out), "stdout_tail": proc.stdout[-3000:], "stderr_tail": proc.stderr[-3000:]}
    finally:
        if copied_overlay:
            shutil.rmtree(repo_skill, ignore_errors=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--skill")
    parser.add_argument("--out-dir")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--api-base", default=os.environ.get("ONBOARD_PREPARE_API_BASE"))
    parser.add_argument("--api-key-env", default=os.environ.get("ONBOARD_PREPARE_API_KEY_ENV"))
    parser.add_argument("--case-model")
    parser.add_argument("--max-output-tokens", type=int, default=20000)
    parser.add_argument("--n-cases", type=int, default=3)
    parser.add_argument("--max-repair-rounds", type=int, default=1)
    parser.add_argument("--validator-timeout", type=float, default=120.0)
    parser.add_argument("--skip-cases", action="store_true")
    parser.add_argument("--smoke", action="store_true", help="no LM; copy existing source contract and run gates")
    parser.add_argument("--import-source", action="store_true", help="copy external/advisory source into the run as a baseline before generating a local candidate")
    parser.add_argument("--review-dir", help="previous onboarding run or agent-review.json whose findings should guide this repair pass")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    source = pick_skill(Path(args.source), args.skill)
    skill = args.skill or source.name
    out_dir = resolve_out_dir(args.out_dir, skill)
    out_dir.mkdir(parents=True, exist_ok=True)
    triage = triage_skill(source, source.parent)
    review_feedback = load_review_feedback(args.review_dir)
    imported_source = import_source_baseline(source, out_dir, skill) if args.import_source else None
    if triage["verdict"] == "advice-only" and not args.smoke and not args.import_source:
        raise SystemExit("advice-only skills need a local candidate import before prepare can synthesize a validator; rerun with --import-source")

    if args.smoke:
        raw = smoke_payload(source)
    else:
        lm = make_lm(args.model, api_base=args.api_base, api_key_env=args.api_key_env, max_tokens=args.max_output_tokens)
        response = lm(prepare_prompt(skill, triage, source_snapshot(source), imported=bool(args.import_source), review_feedback=review_feedback))
        (out_dir / "lm-response.txt").write_text(response, encoding="utf-8")
        raw = extract_json(response)
    payload, errors = normalize_payload(raw, skill)
    (out_dir / "triage.json").write_text(json.dumps(triage, indent=2) + "\n", encoding="utf-8")
    if payload is None:
        report = {"schema_version": "onboard-prepare.v1", "ok": False, "skill": skill, "source": str(source), "out_dir": rel_to_repo(out_dir), "mode": "smoke" if args.smoke else "lm", "triage_verdict": triage["verdict"], "imported_source": imported_source, "review_source": review_feedback["path"] if review_feedback else None, "payload_errors": errors, "review_queue": [], "reminder": "No source files were modified. Imported baselines and generated candidates stay quarantined under runs/onboard/."}
        (out_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report, indent=2))
        return 1

    draft = write_draft(out_dir, skill, payload)
    gates = gate_draft(draft, args.validator_timeout)
    cases = bootstrap_cases(draft, out_dir, payload, args) if gates["ok"] else {"ok": False, "skipped": True, "reason": "draft gates failed"}
    queue = [rel_to_repo(draft)]
    candidates = out_dir / "cases" / "candidates"
    if candidates.is_dir():
        queue.extend(rel_to_repo(p) for p in sorted(candidates.iterdir()) if p.is_dir())
    report = {"schema_version": "onboard-prepare.v1", "ok": gates["ok"] and cases.get("ok") is True, "skill": skill, "source": str(source), "out_dir": rel_to_repo(out_dir), "mode": "smoke" if args.smoke else "lm", "triage_verdict": triage["verdict"], "imported_source": imported_source, "review_source": review_feedback["path"] if review_feedback else None, "gates": gates, "case_generation": cases, "review_queue": queue, "reminder": "Human review required: generated validators and eval cases are quarantined under runs/onboard/."}
    (out_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2) if args.json else f"onboard prepare: {skill}\nreport: {rel_to_repo(out_dir / 'report.json')}\ngates: {'ok' if gates['ok'] else 'fail'}\ncase generation: {cases.get('reason') or ('ok' if cases.get('ok') else 'fail')}\nreview queue:\n" + "\n".join(f"- {p}" for p in queue))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
