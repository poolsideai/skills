#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "gepa==0.1.1",
#   "litellm>=1.70",
#   "pyyaml>=6.0",
# ]
# ///
"""GEPA pilot driver for the skill-optimization track (Phase 1).

Optimizes a skill's SKILL.md against the frozen eval harness using
gepa.optimize_anything (reflective text evolution + per-instance Pareto
candidate selection — arXiv 2507.19457; same recipe as the GEPA team's
`gskill` pipeline for coding-agent skills).

THE GENOME IS SKILL.MD TEXT ONLY. Everything grading depends on is frozen and
enforced mechanically per candidate, before any pool token is spent:

  candidate text
    -> materialized candidate skills root (full copy of the canonical skill
       directory with SKILL.md swapped)
    -> harness/optimize/frozen_paths_gate.py   (byte-immutability of evals/,
       schemas/, scripts/validate_*)            [score 0 + feedback on failure]
    -> scripts/check_skill_structure.py checks (frontmatter, non-goals
       section, ...) via direct import          [score 0 + feedback on failure]
    -> byte cap (--max-skill-bytes)             [score 0 + feedback on failure]
    -> harness/optimize/fitness.py --case <id> --arm <arm>
       (real pool exec, frozen validator)       [validator score 0..1 +
                                                 repair_feedback as reflection
                                                 fuel]

Gate rejections return score 0 WITH the violation text as side info — the
reflection LM learns the authoring rules from its own mistakes without
burning pool runs.

Usage (from the repo root):

    # wiring check — no pool runs, no reflection LM, no API keys:
    uv run harness/optimize/gepa_skill.py --skill ci-log-reducer --smoke

    # score the unmodified seed on the val split (pool runs, no reflection):
    uv run harness/optimize/gepa_skill.py --skill ci-log-reducer --baseline-only

    # live optimization (authenticated pool + reflection-LM API key, e.g.
    # ANTHROPIC_API_KEY for anthropic/* litellm ids):
    uv run harness/optimize/gepa_skill.py --skill ci-log-reducer \
        --max-metric-calls 60

    # reflection via OpenRouter (litellm-native; needs OPENROUTER_API_KEY):
    uv run harness/optimize/gepa_skill.py --skill ci-log-reducer \
        --reflection-lm openrouter/anthropic/claude-sonnet-4.5

    # reflection via any OpenAI-compatible endpoint (vLLM, LiteLLM proxy, ...):
    uv run harness/optimize/gepa_skill.py --skill ci-log-reducer \
        --reflection-lm my-served-model \
        --reflection-api-base http://localhost:8000/v1 --reflection-api-key-env MY_KEY

Outputs under runs/optimize/<skill>/<utc-stamp>/:
    config.json   — resolved arguments + train/val split
    gepa/         — gepa engine state (resumable run dir)
    candidates/   — materialized candidate payloads (gate-checked)
    result.json   — seed/best val scores, lineage, metric-call count
    best/SKILL.md — best candidate text (gate-checked again on the way out)
    best.diff     — unified diff seed -> best

Promotion is manual and stays inside the normal contract: review best.diff,
bump metadata.version, open a PR, let CI structure checks + eval evidence
gate the merge. Eval-set caveat: GEPA guidance assumes ~50+ val instances;
with a handful of cases treat any lift as directional only and lean on the
adversarial cases in the val split as overfitting tripwires
(docs/eval-methodology.md §7).
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
import shutil
import subprocess
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
FITNESS = REPO_ROOT / "harness" / "optimize" / "fitness.py"
FROZEN_GATE = REPO_ROOT / "harness" / "optimize" / "frozen_paths_gate.py"
ARM_NAMES = ("xs_without_skill", "xs_with_skill", "m_without_skill", "m_with_skill")
DEFAULT_REFLECTION_LM = os.environ.get("GEPA_REFLECTION_LM", "anthropic/claude-sonnet-4-5")

sys.path.insert(0, str(REPO_ROOT / "scripts"))
sys.path.insert(0, str(REPO_ROOT))  # harness.llm (shared LM client)


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%SZ")


def load_suite(suite_path: Path) -> tuple[str, list[str]]:
    data = json.loads(suite_path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        return data.get("name") or suite_path.stem, [str(c) for c in data.get("cases", [])]
    if isinstance(data, list):
        return suite_path.stem, [str(c) for c in data]
    raise SystemExit(f"unsupported suite shape: {suite_path}")


def child_env() -> dict[str, str]:
    # This script runs in uv's isolated PEP 723 env; drop VIRTUAL_ENV so the
    # nested `uv run` resolves the repo's project env instead of warning.
    env = dict(os.environ)
    env.pop("VIRTUAL_ENV", None)
    return env


class CandidateFactory:
    """Materializes + gate-checks candidate payloads, memoized by text hash."""

    COMMON_NAMES = {"ci.log", "ci-job.json", "SKILL.md", "metadata.json", "prompt.md"}

    def __init__(
        self, skill: str, scratch: Path, max_bytes: int, case_dirs: list[Path], seed_text: str = ""
    ) -> None:
        self.skill = skill
        self.scratch = scratch
        self.max_bytes = max_bytes
        self.canonical_skill = REPO_ROOT / "skills" / skill
        self._cache: dict[str, tuple[Path | None, list[str]]] = {}
        self._lock = threading.Lock()  # gepa may evaluate candidates in parallel
        # Grandfather literals the SEED already quotes (e.g. a deliberate
        # worked example citing its own easy case). The gate then means
        # "no NEW case-specific quotes" — the search cannot memorize further.
        self.banned_literals = [
            (literal, why)
            for literal, why in self._collect_banned_literals(case_dirs)
            if literal not in seed_text
        ]

    @classmethod
    def _collect_banned_literals(cls, case_dirs: list[Path]) -> list[tuple[str, str]]:
        """Anti-overfit tripwires: a general skill has no business quoting
        case ids, case-specific input filenames, or gold error lines."""
        banned: list[tuple[str, str]] = []
        for case_dir in case_dirs:
            cid = case_dir.name
            banned.append((cid, f"eval case id `{cid}`"))
            input_dir = case_dir / "input"
            if input_dir.is_dir():
                for f in input_dir.rglob("*"):
                    if f.is_file() and f.name not in cls.COMMON_NAMES:
                        banned.append((f.name, f"eval input filename `{f.name}` (case {cid})"))
            expected_dir = case_dir / "expected"
            if expected_dir.is_dir():
                for gold in expected_dir.rglob("*.json"):
                    try:
                        data = json.loads(gold.read_text(encoding="utf-8"))
                    except (OSError, json.JSONDecodeError):
                        continue
                    if not isinstance(data, dict):
                        continue
                    for el in data.get("error_lines") or []:
                        text = el.get("text", "") if isinstance(el, dict) else ""
                        if isinstance(text, str) and len(text.strip()) >= 25:
                            banned.append((text.strip(), f"gold error line from case {cid}"))
        seen: set[str] = set()
        unique = []
        for literal, why in banned:
            if literal not in seen:
                seen.add(literal)
                unique.append((literal, why))
        return unique

    def materialize(self, text: str) -> tuple[Path | None, list[str]]:
        """Returns (candidate skills root, gate violations). Root is None only
        when materialization itself failed; gate violations leave the payload
        on disk for postmortems."""
        key = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
        with self._lock:
            return self._materialize_locked(key, text)

    def _materialize_locked(self, key: str, text: str) -> tuple[Path | None, list[str]]:
        if key in self._cache:
            return self._cache[key]

        violations: list[str] = []
        for literal, why in self.banned_literals:
            if literal in text:
                violations.append(
                    f"anti-overfit: candidate quotes {why}. The skill must stay "
                    "general — describe procedures, never specific eval cases."
                )
        size = len(text.encode("utf-8"))
        if size > self.max_bytes:
            violations.append(
                f"byte-cap: SKILL.md is {size} bytes; cap is {self.max_bytes}. "
                "Tighten the prose — long skills bloat agent context and overfit."
            )

        root = self.scratch / f"cand-{key}" / "skills"
        if not (root / self.skill).is_dir():
            shutil.copytree(self.canonical_skill, root / self.skill)
        (root / self.skill / "SKILL.md").write_text(text, encoding="utf-8")

        gate = subprocess.run(
            [sys.executable, str(FROZEN_GATE), "--skill", self.skill, "--candidate-root", str(root)],
            capture_output=True, text=True, cwd=REPO_ROOT,
        )
        if gate.returncode == 2:
            raise RuntimeError(f"frozen_paths_gate configuration error: {gate.stderr or gate.stdout}")
        if gate.returncode != 0:
            try:
                for v in json.loads(gate.stdout).get("violations", []):
                    violations.append(f"frozen-paths {v['kind']}: {v['path']} — {v['detail']}")
            except json.JSONDecodeError:
                violations.append(f"frozen-paths gate failed: {gate.stdout[-500:]}")

        violations.extend(self._structure_violations(root / self.skill))

        result = (root, violations)
        self._cache[key] = result
        return result

    def _structure_violations(self, skill_dir: Path) -> list[str]:
        # Same checks `scripts/check_skill_structure.py` runs in CI — the
        # authoring contract is one set of rules with two callers.
        from check_skill_structure import check_skill  # noqa: PLC0415
        from checklib import Report  # noqa: PLC0415

        report = Report("gepa-candidate-gate")
        check_skill(report, skill_dir)
        return [f"structure {v.check}: {v.message}" for v in report.violations]


def run_fitness_case(
    skills_root: Path, suite_path: Path, case_id: str, arm: str, args: argparse.Namespace
) -> tuple[float, str, dict]:
    cmd = [
        "uv", "run", str(FITNESS),
        "--suite", str(suite_path),
        "--case", case_id,
        "--arm", arm,
        "--skills-root", str(skills_root),
    ]
    if args.timeout is not None:
        cmd += ["--timeout", str(args.timeout)]
    if args.pool_bin:
        cmd += ["--pool-bin", args.pool_bin]
    if args.api_url:
        cmd += ["--api-url", args.api_url]
    if args.sandbox:
        cmd += ["--sandbox", args.sandbox]
    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=REPO_ROOT, env=child_env())
    if proc.returncode == 2:
        raise RuntimeError(
            f"fitness.py configuration error for {case_id}/{arm}:\n{proc.stderr[-2000:]}"
        )
    try:
        fitness = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"fitness.py emitted unparseable output for {case_id}/{arm}: {exc}\n{proc.stdout[-1000:]}"
        ) from exc

    row = fitness.get("per_case", {}).get(f"{case_id}/{arm}", {})
    score = float(row.get("score", 0.0))
    lines = [
        f"validator status: {row.get('validator_status')} (expected: {row.get('expected_status')})",
        f"validator score: {score}",
    ]
    if row.get("harness_failure"):
        lines.append(f"harness failure: {row['harness_failure']}")
    for item in row.get("feedback", []):
        lines.append(f"- {item}")
    if score >= 1.0:
        lines.append("This case fully passed — preserve whatever made it work.")
    return score, "\n".join(lines), row


def split_cases(case_ids: list[str], train: list[str], val: list[str], buckets: dict[str, str]) -> tuple[list[str], list[str]]:
    if train or val:
        unknown = sorted((set(train) | set(val)) - set(case_ids))
        if unknown:
            raise SystemExit(f"--train-case/--val-case not in suite: {unknown}")
        val_set = set(val) or set(case_ids) - set(train)
        train_set = set(train) or set(case_ids) - val_set
        overlap = train_set & val_set
        if overlap:
            raise SystemExit(f"cases in both train and val: {sorted(overlap)}")
        return sorted(train_set), sorted(val_set)
    # Deterministic bucket-aware default: ALL adversarial-bucket cases go to
    # validation (overfitting tripwires the search cannot train on), plus
    # every 5th remaining case for breadth. Override with --train-case/--val-case.
    ordered = sorted(case_ids)
    adversarial = [c for c in ordered if buckets.get(c) == "adversarial"]
    rest = [c for c in ordered if c not in adversarial]
    val_def = sorted(set(adversarial + rest[0::5]))
    train_def = [c for c in ordered if c not in val_def]
    if not train_def or not val_def:
        val_def = ordered[2::3] or ordered[-1:]
        train_def = [c for c in ordered if c not in val_def]
    return train_def, val_def


def main() -> int:
    parser = argparse.ArgumentParser(description="GEPA optimization of a skill's SKILL.md against the frozen eval harness.")
    parser.add_argument("--skill", required=True)
    parser.add_argument("--suite", help="suite JSON (default: evals/suites/skill-<skill>.json)")
    parser.add_argument("--arm", action="append", default=[], dest="arms", choices=ARM_NAMES,
                        help="arm(s) used during search (default: xs_with_skill)")
    parser.add_argument("--train-case", action="append", default=[], dest="train_cases")
    parser.add_argument("--val-case", action="append", default=[], dest="val_cases")
    parser.add_argument("--max-metric-calls", type=int, default=60,
                        help="total evaluator calls = pool execs upper bound (default 60)")
    parser.add_argument("--reflection-lm", default=DEFAULT_REFLECTION_LM,
                        help=f"litellm model id for reflection (default {DEFAULT_REFLECTION_LM}; env GEPA_REFLECTION_LM). "
                             "OpenRouter works natively: openrouter/<provider>/<model> + OPENROUTER_API_KEY.")
    parser.add_argument("--reflection-api-base", default=os.environ.get("GEPA_REFLECTION_API_BASE"),
                        help="base URL of an OpenAI-compatible endpoint for reflection (e.g. "
                             "https://openrouter.ai/api/v1 or a vLLM/LiteLLM proxy; env GEPA_REFLECTION_API_BASE). "
                             "A bare model name is then addressed as openai/<name>.")
    parser.add_argument("--reflection-api-key-env", default=os.environ.get("GEPA_REFLECTION_API_KEY_ENV"),
                        help="name of the env var holding the API key for --reflection-api-base "
                             "(env GEPA_REFLECTION_API_KEY_ENV; default: litellm's own key resolution)")
    parser.add_argument("--reflection-minibatch-size", type=int, default=None)
    parser.add_argument("--workers", type=int, default=1,
                        help="parallel evaluator calls (concurrent pool runs; default 1 = serial)")
    parser.add_argument("--max-skill-bytes", type=int, default=None,
                        help="hard byte cap on candidate SKILL.md (default: max(32768, 2x seed))")
    parser.add_argument("--out-dir", help="default: runs/optimize/<skill>/<utc-stamp>")
    parser.add_argument("--timeout", type=float, help="per-pool-run timeout (fitness passthrough)")
    parser.add_argument("--pool-bin")
    parser.add_argument("--api-url")
    parser.add_argument("--sandbox", choices=("auto", "required", "disabled"))
    parser.add_argument("--seed", type=int, default=0, help="gepa engine seed")
    parser.add_argument("--smoke", action="store_true",
                        help="verify wiring only: gates on seed + fitness --dry-run --replay; no pool, no reflection LM")
    parser.add_argument("--baseline-only", action="store_true",
                        help="evaluate the unmodified seed on the val split (live pool), then exit")
    args = parser.parse_args()

    skill_dir = REPO_ROOT / "skills" / args.skill
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        raise SystemExit(f"no such skill: {args.skill} ({skill_md} missing)")
    suite_path = (REPO_ROOT / args.suite).resolve() if args.suite else (
        REPO_ROOT / "evals" / "suites" / f"skill-{args.skill}.json"
    )
    if not suite_path.is_file():
        raise SystemExit(f"suite not found: {suite_path} (create the per-skill suite first)")

    suite_name, case_entries = load_suite(suite_path)
    case_dirs = [REPO_ROOT / c for c in case_entries]
    case_ids = [d.name for d in case_dirs]
    buckets: dict[str, str] = {}
    for d in case_dirs:
        try:
            meta = json.loads((d / "metadata.json").read_text(encoding="utf-8"))
            buckets[d.name] = meta.get("bucket", "realistic")
        except (OSError, json.JSONDecodeError):
            buckets[d.name] = "realistic"
    arms = args.arms or ["xs_with_skill"]
    train_ids, val_ids = split_cases(case_ids, args.train_cases, args.val_cases, buckets)
    # Stable aliases keep raw case ids out of reflection side info.
    case_alias = {cid: f"case-{i + 1}" for i, cid in enumerate(sorted(case_ids))}

    seed_text = skill_md.read_text(encoding="utf-8")
    max_bytes = args.max_skill_bytes or max(32768, 2 * len(seed_text.encode("utf-8")))

    out_dir = Path(args.out_dir).resolve() if args.out_dir else (
        REPO_ROOT / "runs" / "optimize" / args.skill / utc_stamp()
    )
    out_dir.mkdir(parents=True, exist_ok=True)
    factory = CandidateFactory(args.skill, out_dir / "candidates", max_bytes, case_dirs, seed_text)

    config = {
        "skill": args.skill,
        "suite": suite_name,
        "arms": arms,
        "train_cases": train_ids,
        "val_cases": val_ids,
        "max_metric_calls": args.max_metric_calls,
        "reflection_lm": args.reflection_lm,
        "reflection_api_base": args.reflection_api_base,
        "reflection_api_key_env": args.reflection_api_key_env,
        "max_skill_bytes": max_bytes,
        "workers": args.workers,
        "seed": args.seed,
        "argv": sys.argv[1:],
    }
    (out_dir / "config.json").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"out_dir": str(out_dir), **config}, indent=2), file=sys.stderr)

    # ---------------------------------------------------------------- smoke
    if args.smoke:
        import gepa  # noqa: F401  (proves the optimizer dependency resolves)

        root, violations = factory.materialize(seed_text)
        dry = subprocess.run(
            ["uv", "run", str(FITNESS), "--suite", str(suite_path), "--dry-run", "--replay"],
            capture_output=True, text=True, cwd=REPO_ROOT, env=child_env(),
        )
        ok = not violations and dry.returncode == 0 and root is not None
        print(json.dumps({
            "smoke": True,
            "ok": ok,
            "seed_gate_violations": violations,
            "fitness_dry_run_ok": dry.returncode == 0,
            "fitness_tail": dry.stdout[-800:] if dry.returncode != 0 else "ok",
            "out_dir": str(out_dir),
        }, indent=2))
        return 0 if ok else 1

    def evaluate(text: str, case_id: str, arm: str) -> tuple[float, dict]:
        root, violations = factory.materialize(text)
        if violations or root is None:
            feedback = (
                "Candidate REJECTED by repo gates before any agent run (score 0). "
                "Fix these and keep all frozen surfaces untouched:\n- "
                + "\n- ".join(violations or ["materialization failed"])
            )
            return 0.0, {
                "Input": f"eval {case_alias.get(case_id, case_id)} (arm {arm})",
                "Feedback": feedback,
                "scores": {"gates": 0.0},
            }
        score, feedback, row = run_fitness_case(root, suite_path, case_id, arm, args)
        alias = case_alias.get(case_id, case_id)
        return score, {
            "Input": f"eval {alias} (arm {arm})",
            "Feedback": feedback.replace(case_id, alias),
            "scores": {"validator": score},
        }

    # -------------------------------------------------------------- baseline
    if args.baseline_only:
        rows = {}
        scores = []
        for case_id in val_ids:
            for arm in arms:
                score, side = evaluate(seed_text, case_id, arm)
                rows[f"{case_id}/{arm}"] = {"score": score, "feedback": side["Feedback"]}
                scores.append(score)
        baseline = {
            "skill": args.skill,
            "val_cases": val_ids,
            "arms": arms,
            "seed_val_score": round(sum(scores) / len(scores), 6) if scores else 0.0,
            "per_case": rows,
        }
        (out_dir / "seed-baseline.json").write_text(json.dumps(baseline, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(baseline, indent=2))
        return 0

    # ------------------------------------------------------------- optimize
    from gepa.optimize_anything import EngineConfig, GEPAConfig, ReflectionConfig, optimize_anything

    # gepa accepts a litellm id string or a (prompt | messages) -> str callable.
    # Plain litellm ids (anthropic/*, openrouter/*, ...) pass through as
    # strings; an explicit OpenAI-compatible endpoint needs the callable so we
    # can pin api_base/api_key (harness/llm.py).
    reflection_lm: object = args.reflection_lm
    if args.reflection_api_base or args.reflection_api_key_env:
        from harness.llm import make_lm  # noqa: PLC0415

        reflection_lm = make_lm(
            args.reflection_lm,
            api_base=args.reflection_api_base,
            api_key_env=args.reflection_api_key_env,
        )

    def evaluator(candidate, example=None, **_kwargs):
        text = candidate["skill_md"] if isinstance(candidate, dict) else str(candidate)
        return evaluate(text, example["case_id"], example["arm"])

    dataset = [{"case_id": c, "arm": a} for c in train_ids for a in arms]
    valset = [{"case_id": c, "arm": a} for c in val_ids for a in arms]

    objective = (
        f"Rewrite the SKILL.md of the `{args.skill}` agent skill so that a small "
        "coding agent (pool CLI / Laguna models) with this skill installed reliably "
        "produces the exact gradeable artifact that the skill's FROZEN validator "
        "checks: right workspace path, schema-valid JSON, evidence-faithful content, "
        "safe suggested actions. Maximize the mean validator score across held-out "
        "eval cases. The skill must STAY GENERAL: never hardcode details of "
        "individual eval cases (ids, specific log lines, specific file names) — "
        "improve the procedure, the output contract explanation, and the failure-"
        "mode warnings instead."
    )
    background = (
        "Authoring contract (mechanically enforced; violations score 0):\n"
        f"- YAML frontmatter must stay valid; `name` must remain `{args.skill}`; "
        "`description` is trigger phrases ('Use when ...'), <=1024 chars; keep "
        "`metadata.version` unchanged (it is bumped manually at promotion).\n"
        "- Keep a 'Do not use when' (non-goals) section.\n"
        "- Keep the deterministic output artifact path and the validator argv "
        "contract exactly as documented in the current SKILL.md.\n"
        f"- Hard cap: SKILL.md <= {max_bytes} bytes.\n"
        "- Only SKILL.md may change; eval cases, schemas, and validators are "
        "frozen and byte-compared.\n"
        "- The runtime is `bun` for skill scripts; the agent may not have network "
        "access; validators grade workspace state + final message only."
    )

    result = optimize_anything(
        seed_candidate={"skill_md": seed_text},
        evaluator=evaluator,
        dataset=dataset,
        valset=valset,
        objective=objective,
        background=background,
        config=GEPAConfig(
            engine=EngineConfig(
                run_dir=str(out_dir / "gepa"),
                seed=args.seed,
                max_metric_calls=args.max_metric_calls,
                parallel=args.workers > 1,
                max_workers=args.workers,
                cache_evaluation=True,
                display_progress_bar=True,
            ),
            reflection=ReflectionConfig(
                reflection_lm=reflection_lm,
                reflection_minibatch_size=args.reflection_minibatch_size,
                perfect_score=1.0,
                skip_perfect_score=True,
            ),
        ),
    )

    best = result.best_candidate
    best_text = best["skill_md"] if isinstance(best, dict) else str(best)
    _root, best_violations = factory.materialize(best_text)
    if best_violations:
        # Should be impossible (gated during search); refuse to ship it anyway.
        print(json.dumps({"error": "best candidate fails gates", "violations": best_violations}), file=sys.stderr)
        return 1

    (out_dir / "best").mkdir(exist_ok=True)
    (out_dir / "best" / "SKILL.md").write_text(best_text, encoding="utf-8")
    diff = "".join(difflib.unified_diff(
        seed_text.splitlines(keepends=True), best_text.splitlines(keepends=True),
        fromfile=f"skills/{args.skill}/SKILL.md (seed)", tofile=f"skills/{args.skill}/SKILL.md (best)",
    ))
    (out_dir / "best.diff").write_text(diff, encoding="utf-8")

    val_scores = list(getattr(result, "val_aggregate_scores", []) or [])
    summary = {
        "skill": args.skill,
        "suite": suite_name,
        "train_cases": train_ids,
        "val_cases": val_ids,
        "arms": arms,
        "seed_val_score": val_scores[0] if val_scores else None,
        "best_val_score": max(val_scores) if val_scores else None,
        "val_aggregate_scores": val_scores,
        "n_candidates": len(getattr(result, "candidates", []) or []),
        "parents": getattr(result, "parents", None),
        "total_metric_calls": getattr(result, "total_metric_calls", None),
        "best_changed": best_text != seed_text,
        "out_dir": str(out_dir),
        "promotion": "review best.diff, bump metadata.version, open a PR (human merge)",
    }
    (out_dir / "result.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
