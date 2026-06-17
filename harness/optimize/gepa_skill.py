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

Optimizes selected skill authoring components against the frozen eval harness using
gepa.optimize_anything (reflective text evolution + per-instance Pareto
candidate selection — arXiv 2507.19457; same recipe as the GEPA team's
`gskill` pipeline for coding-agent skills).

By default the genome is SKILL.md text only. With `--components references`,
reference files are mutable components too. Everything grading depends on is
frozen and enforced mechanically per candidate, before any pool token is spent:

  candidate component text(s)
    -> materialized candidate skills root (full copy of the canonical skill
       directory with selected component files swapped)
    -> harness/optimize/frozen_paths_gate.py   (byte-immutability of evals/,
       schemas/, scripts/validate_*)            [score 0 + feedback on failure]
    -> scripts/check_skill_structure.py checks (frontmatter, non-goals
       section, ...) via direct import          [score 0 + feedback on failure]
    -> byte caps (--max-component-bytes/--max-total-bytes) [score 0 + feedback on failure]
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

    # reflection via the authenticated pool CLI / model selector surface:
    uv run harness/optimize/gepa_skill.py --skill ci-log-reducer \
        --reflection-pool-agent anthropic/claude-4.5-sonnet

Outputs under runs/optimize/<skill>/<utc-stamp>/:
    config.json   — resolved arguments + train/val split
    gepa/         — gepa engine state (resumable run dir)
    candidates/   — materialized candidate payloads (gate-checked)
    result.json   — seed/best val scores, lineage, metric-call count
    best/         — best candidate component files (gate-checked again)
    best.diff     — unified diff seed -> best across changed components

Promotion is manual and stays inside the normal contract: review best.diff,
bump metadata.version when SKILL.md changes, open a PR, let CI structure checks + eval evidence
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
import re
import shutil
import subprocess
import sys
import threading
import tempfile
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
FITNESS = REPO_ROOT / "harness" / "optimize" / "fitness.py"
FROZEN_GATE = REPO_ROOT / "harness" / "optimize" / "frozen_paths_gate.py"
ARM_NAMES = ("xs_without_skill", "xs_with_skill", "m_without_skill", "m_with_skill")
DEFAULT_REFLECTION_LM = os.environ.get("GEPA_REFLECTION_LM", "anthropic/claude-sonnet-4-5")
DEFAULT_REFLECTION_POOL_AGENT = os.environ.get("GEPA_REFLECTION_POOL_AGENT")
SYNTHETIC_BOOTSTRAP_HEADING = "## Synthetic Laguna Bootstrap Contract"
SYNTHETIC_BOOTSTRAP_SCHEMA_RE = re.compile(r"[a-z0-9][a-z0-9_-]*\.synthetic-bootstrap\.v1")

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


def case_validator_command(case_dir: Path) -> list[str]:
    try:
        meta = json.loads((case_dir / "metadata.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    validator = meta.get("validator") if isinstance(meta, dict) else None
    command = validator.get("command") if isinstance(validator, dict) else None
    return [str(item) for item in command] if isinstance(command, list) else []


def suite_is_synthetic_bootstrap_only(case_dirs: list[Path]) -> bool:
    if not case_dirs:
        return False
    commands = [case_validator_command(d) for d in case_dirs]
    return bool(commands) and all(any("synthetic_bootstrap" in item for item in command) for command in commands)


def strip_synthetic_bootstrap_contract(text: str) -> tuple[str, bool]:
    pattern = re.compile(rf"\n+{re.escape(SYNTHETIC_BOOTSTRAP_HEADING)}\n.*?(?=\n## |\Z)", re.DOTALL)
    stripped, count = pattern.subn("", text.rstrip())
    if count:
        return stripped.rstrip() + "\n", True
    return text, False


def case_dir_for_id(suite_path: Path, case_id: str) -> Path | None:
    _suite_name, entries = load_suite(suite_path)
    for entry in entries:
        case_dir = REPO_ROOT / entry
        if case_dir.name == case_id:
            return case_dir
    return None


def case_prompt_contract_excerpt(suite_path: Path, case_id: str, max_chars: int = 1600) -> str | None:
    case_dir = case_dir_for_id(suite_path, case_id)
    prompt_path = case_dir / "prompt.md" if case_dir else None
    if not prompt_path or not prompt_path.is_file():
        return None
    text = prompt_path.read_text(encoding="utf-8", errors="replace").strip()
    if len(text) > max_chars:
        text = text[:max_chars].rsplit("\n", 1)[0] + "\n..."
    return text


def child_env() -> dict[str, str]:
    # This script runs in uv's isolated PEP 723 env; drop VIRTUAL_ENV so the
    # nested `uv run` resolves the repo's project env instead of warning.
    env = dict(os.environ)
    env.pop("VIRTUAL_ENV", None)
    return env


def prompt_to_text(prompt: str | list[dict]) -> str:
    if isinstance(prompt, str):
        return prompt
    parts = []
    for message in prompt:
        role = str(message.get("role", "user"))
        content = message.get("content", "")
        if isinstance(content, str):
            rendered = content
        else:
            rendered = json.dumps(content, ensure_ascii=True)
        parts.append(f"<{role}>\n{rendered}\n</{role}>")
    return "\n\n".join(parts)


def fenced_blocks(text: str) -> list[str]:
    return [m.group(1).strip() for m in re.finditer(r"```(?:[A-Za-z0-9_-]+)?\s*\n(.*?)```", text, re.DOTALL)]


def clean_pool_reflection_output(text: str) -> str:
    blocks = fenced_blocks(text)
    if not blocks:
        return text.strip()
    for block in reversed(blocks):
        stripped = block.lstrip()
        if stripped.startswith("---\nname:") or stripped.startswith("---\r\nname:"):
            return f"```\n{block}\n```"
    for block in reversed(blocks):
        if "metadata:" in block and "## Do not use when" in block and "# " in block:
            return f"```\n{block}\n```"
    return f"```\n{blocks[-1]}\n```"


def make_pool_reflection_lm(args: argparse.Namespace, out_dir: Path):
    """GEPA LanguageModel adapter backed by the repo's existing pool auth path."""
    from harness.runner.pool_exec import (  # noqa: PLC0415
        DEFAULT_API_URL,
        DEFAULT_POOL_BIN,
        cli_rejection,
        probe_surface,
        sandbox_available,
    )

    pool_bin = args.pool_bin or DEFAULT_POOL_BIN
    api_url = args.api_url or DEFAULT_API_URL
    surface = probe_surface(pool_bin)
    base = [pool_bin, "exec"] if surface.has_exec_subcommand else [pool_bin]
    sandbox = args.reflection_pool_sandbox
    if sandbox == "auto":
        sandbox = "required" if sandbox_available() else "disabled"
    calls_dir = out_dir / "reflection-pool"
    calls_dir.mkdir(parents=True, exist_ok=True)
    lock = threading.Lock()
    counter = {"n": 0}

    def _lm(prompt: str | list[dict]) -> str:
        text = (
            "You are being used as a GEPA reflection model, not as an interactive coding agent.\n"
            "Do not inspect files, run tools, update todos, or explain your process.\n"
            "Return exactly one fenced code block containing only the replacement component text requested by the prompt.\n"
            "No prose before or after the fenced block.\n\n"
            + prompt_to_text(prompt)
        )
        with lock:
            counter["n"] += 1
            call_dir = calls_dir / f"call-{counter['n']:03d}"
        call_dir.mkdir(parents=True, exist_ok=True)
        prompt_file = call_dir / "prompt.md"
        prompt_file.write_text(text, encoding="utf-8")
        workspace = Path(tempfile.mkdtemp(prefix="gepa-reflection-", dir=str(call_dir)))
        argv = [*base]
        if surface.supports("--prompt-file"):
            argv += ["--prompt-file", str(prompt_file)]
        else:
            argv += ["-p", text]
        if surface.supports("--directory"):
            argv += ["--directory", str(workspace)]
        else:
            argv += ["-d", str(workspace)]
        argv += ["-o", "markdown", "--unsafe-auto-allow"]
        if surface.supports("--sandbox"):
            argv += ["--sandbox", sandbox]
        argv += ["--agent-name", args.reflection_pool_agent, "--api-url", api_url]
        (call_dir / "argv.json").write_text(json.dumps(argv, indent=2) + "\n", encoding="utf-8")
        try:
            proc = subprocess.run(
                argv,
                capture_output=True,
                text=True,
                cwd=REPO_ROOT,
                env=child_env(),
                timeout=args.reflection_pool_timeout,
            )
        except subprocess.TimeoutExpired as exc:
            stdout = exc.stdout.decode("utf-8", errors="replace") if isinstance(exc.stdout, bytes) else (exc.stdout or "")
            stderr = exc.stderr.decode("utf-8", errors="replace") if isinstance(exc.stderr, bytes) else (exc.stderr or "")
            (call_dir / "stdout.md").write_text(stdout, encoding="utf-8")
            (call_dir / "stderr.txt").write_text(stderr, encoding="utf-8")
            (call_dir / "timeout.json").write_text(
                json.dumps(
                    {
                        "timeout_s": args.reflection_pool_timeout,
                        "agent": args.reflection_pool_agent,
                        "argv": argv,
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            raise RuntimeError(
                "pool reflection timed out "
                f"after {args.reflection_pool_timeout}s (call_dir={call_dir})"
            ) from exc
        (call_dir / "stdout.md").write_text(proc.stdout, encoding="utf-8")
        (call_dir / "stderr.txt").write_text(proc.stderr, encoding="utf-8")
        rejection = cli_rejection(proc.stderr)
        if proc.returncode != 0 or rejection:
            raise RuntimeError(
                "pool reflection failed "
                f"(exit={proc.returncode}, rejection={rejection}, call_dir={call_dir}):\n"
                f"{proc.stderr[-2000:]}"
            )
        output = clean_pool_reflection_output(proc.stdout)
        if not output:
            raise RuntimeError(f"pool reflection returned empty stdout (call_dir={call_dir})")
        (call_dir / "cleaned.md").write_text(output, encoding="utf-8")
        return output

    return _lm


def parse_components(values: list[str]) -> list[str]:
    selected = ["skill_md"]
    for raw in values:
        for item in raw.split(","):
            item = item.strip()
            if not item:
                continue
            if item in {"SKILL.md", "skill_md"}:
                if "skill_md" not in selected:
                    selected.append("skill_md")
                continue
            if item == "references":
                if "references" not in selected:
                    selected.append("references")
                continue
            raise SystemExit(f"unsupported --components value {item!r}; supported: SKILL.md, references")
    return selected


def component_relpath(component: str) -> Path:
    if component == "skill_md":
        return Path("SKILL.md")
    if component.startswith("references/") and ".." not in Path(component).parts:
        return Path(component)
    raise ValueError(f"unsupported component: {component}")


def load_seed_components(
    skill_dir: Path,
    selected: list[str],
    *,
    strip_synthetic_bootstrap: bool = False,
) -> tuple[dict[str, str], list[str]]:
    components = {"skill_md": (skill_dir / "SKILL.md").read_text(encoding="utf-8")}
    if "references" in selected and (skill_dir / "references").is_dir():
        for path in sorted(p for p in (skill_dir / "references").rglob("*") if p.is_file()):
            components[path.relative_to(skill_dir).as_posix()] = path.read_text(encoding="utf-8")
    notes: list[str] = []
    if strip_synthetic_bootstrap and "skill_md" in components:
        components["skill_md"], changed = strip_synthetic_bootstrap_contract(components["skill_md"])
        if changed:
            notes.append(
                "stripped generated Synthetic Laguna Bootstrap Contract from optimizer seed "
                "because the active suite uses non-synthetic validators"
            )
    return components, notes


def candidate_components(candidate: object) -> dict[str, str]:
    if isinstance(candidate, dict):
        return {str(k): str(v) for k, v in candidate.items()}
    return {"skill_md": str(candidate)}


class CandidateFactory:
    """Materializes + gate-checks candidate payloads, memoized by text hash."""

    COMMON_NAMES = {"ci.log", "ci-job.json", "SKILL.md", "metadata.json", "prompt.md"}

    def __init__(
        self,
        skill: str,
        scratch: Path,
        component_caps: dict[str, int],
        max_total_bytes: int,
        case_dirs: list[Path],
        seed_components: dict[str, str],
        disallowed_literals: list[tuple[str, str]] | None = None,
        max_candidate_bytes_over_seed: int | None = None,
        reject_broad_artifact_overrides: bool = False,
    ) -> None:
        self.skill = skill
        self.scratch = scratch
        self.component_caps = component_caps
        self.max_total_bytes = max_total_bytes
        self.seed_components = dict(seed_components)
        self.allowed_components = set(seed_components)
        self.canonical_skill = REPO_ROOT / "skills" / skill
        self.disallowed_literals = list(disallowed_literals or [])
        self.max_candidate_bytes_over_seed = max_candidate_bytes_over_seed
        self.reject_broad_artifact_overrides = reject_broad_artifact_overrides
        self._cache: dict[str, tuple[Path | None, list[str]]] = {}
        self._lock = threading.Lock()  # gepa may evaluate candidates in parallel
        # Grandfather literals the SEED already quotes (e.g. a deliberate
        # worked example citing its own easy case). The gate then means
        # "no NEW case-specific quotes" — the search cannot memorize further.
        seed_text = "\n".join(seed_components.values())
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

    def materialize(self, candidate: object) -> tuple[Path | None, list[str]]:
        """Returns (candidate skills root, gate violations). Root is None only
        when materialization itself failed; gate violations leave the payload
        on disk for postmortems."""
        raw_components = candidate_components(candidate)
        unknown = sorted(set(raw_components) - self.allowed_components)
        components = {name: raw_components.get(name, self.seed_components[name]) for name in self.seed_components}
        key = hashlib.sha256(json.dumps({"components": components, "unknown": unknown}, sort_keys=True).encode("utf-8")).hexdigest()[:16]
        with self._lock:
            return self._materialize_locked(key, components, unknown)

    def _materialize_locked(self, key: str, components: dict[str, str], unknown: list[str]) -> tuple[Path | None, list[str]]:
        if key in self._cache:
            return self._cache[key]

        violations: list[str] = []
        for name in unknown:
            violations.append(f"component-scope: candidate returned unsupported component {name!r}; allowed: {sorted(self.allowed_components)}")
        combined = "\n".join(components.values())
        for literal, why in self.banned_literals:
            if literal in combined:
                violations.append(
                    f"anti-overfit: candidate quotes {why}. The skill must stay "
                    "general — describe procedures, never specific eval cases."
                )
        for literal, why in self.disallowed_literals:
            if literal in combined:
                violations.append(f"contract-conflict: candidate contains {why}: {literal}")
        total_size = 0
        for name, text in components.items():
            size = len(text.encode("utf-8"))
            total_size += size
            seed_size = len(self.seed_components.get(name, "").encode("utf-8"))
            if (
                self.max_candidate_bytes_over_seed is not None
                and size - seed_size > self.max_candidate_bytes_over_seed
            ):
                violations.append(
                    "candidate-shape: "
                    f"{component_relpath(name)} grew by {size - seed_size} bytes; "
                    f"cap is {self.max_candidate_bytes_over_seed}. Use a surgical "
                    "instructional edit instead of a broad mode rewrite."
                )
            cap = self.component_caps.get(name, self.component_caps.get("skill_md", 32768))
            if size > cap:
                violations.append(f"byte-cap: {component_relpath(name)} is {size} bytes; cap is {cap}")
        if self.reject_broad_artifact_overrides:
            risky_needles = [
                ("JSON_CONTRACT_MODE", "introduces a global JSON contract mode"),
                ("CRITICAL OVERRIDE", "introduces a critical override block"),
                ("Prompt-Local JSON Artifact", "introduces a broad prompt-local artifact section"),
                ("Prompt-Local Artifact", "introduces a broad prompt-local artifact section"),
                ("Prompt-local artifact", "introduces a broad prompt-local artifact section"),
                ("prompt-local artifact", "introduces a broad prompt-local artifact section"),
                ("artifact-contract mode", "introduces a broad alternate artifact workflow"),
                ("Artifact-Contract Mode", "introduces a broad alternate artifact workflow"),
                ("STRUCTURED_ARTIFACT_MODE", "introduces a global structured artifact mode"),
                ("PROMPT_ARTIFACT_MODE", "introduces a global prompt artifact mode"),
                ("DELIVERABLE_MODE=artifact-contract", "introduces a global artifact deliverable mode"),
                ("Highest-Priority Deliverable Contract", "introduces a broad top-level deliverable override"),
                ("bypass standard outputs", "bypasses the skill's normal output flow"),
                ("overrides the default `docs/plans/", "overrides the skill's normal plan output flow"),
                ("overrides the default docs/plans", "overrides the skill's normal plan output flow"),
                ("skip the normal post-generation menu", "bypasses the skill's normal completion flow"),
                ("skip the default interactive post-generation menu", "bypasses the skill's normal completion flow"),
            ]
            seed_combined = "\n".join(self.seed_components.values())
            for needle, why in risky_needles:
                if needle not in seed_combined and needle in combined:
                    violations.append(
                        "candidate-shape: "
                        f"{why}. Keep eval-artifact guidance local and procedural, "
                        "not as a top-level alternate workflow."
                    )
        if total_size > self.max_total_bytes:
            violations.append(f"byte-cap: selected components total {total_size} bytes; cap is {self.max_total_bytes}")

        root = self.scratch / f"cand-{key}" / "skills"
        if not (root / self.skill).is_dir():
            shutil.copytree(self.canonical_skill, root / self.skill)
        for name, text in components.items():
            dest = root / self.skill / component_relpath(name)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(text, encoding="utf-8")

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
        "eval prompt/output contract excerpt:",
        case_prompt_contract_excerpt(suite_path, case_id) or "(prompt unavailable)",
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
    parser = argparse.ArgumentParser(description="GEPA optimization of selected skill components against the frozen eval harness.")
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
    parser.add_argument("--reflection-reasoning-effort",
                        choices=("none", "minimal", "low", "medium", "high", "xhigh"),
                        default=os.environ.get("GEPA_REFLECTION_REASONING_EFFORT"),
                        help="optional reasoning effort for LiteLLM-backed reflection calls. "
                             "For OpenRouter this is sent as reasoning.effort with reasoning excluded from output "
                             "(env GEPA_REFLECTION_REASONING_EFFORT).")
    parser.add_argument("--reflection-pool-agent", default=DEFAULT_REFLECTION_POOL_AGENT,
                        help="pool agent name for GEPA reflection instead of LiteLLM "
                             "(env GEPA_REFLECTION_POOL_AGENT; e.g. anthropic/claude-4.5-sonnet).")
    parser.add_argument("--reflection-pool-timeout", type=float, default=float(os.environ.get("GEPA_REFLECTION_POOL_TIMEOUT", "240")),
                        help="timeout in seconds for each pool-backed reflection call (default 240; env GEPA_REFLECTION_POOL_TIMEOUT)")
    parser.add_argument("--reflection-pool-sandbox", choices=("auto", "required", "disabled"),
                        default=os.environ.get("GEPA_REFLECTION_POOL_SANDBOX", "disabled"),
                        help="sandbox mode for pool-backed reflection calls (default disabled; env GEPA_REFLECTION_POOL_SANDBOX)")
    parser.add_argument("--reflection-minibatch-size", type=int, default=None)
    parser.add_argument("--workers", type=int, default=1,
                        help="parallel evaluator calls (concurrent pool runs; default 1 = serial)")
    parser.add_argument("--max-skill-bytes", type=int, default=None,
                        help="deprecated alias for --max-component-bytes on SKILL.md")
    parser.add_argument("--components", action="append", default=[],
                        help="mutable component set: SKILL.md (default) and/or references; comma-separated values accepted")
    parser.add_argument("--max-component-bytes", type=int, default=None,
                        help="hard byte cap per selected component (default: max(32768, 2x seed component))")
    parser.add_argument("--max-total-bytes", type=int, default=None,
                        help="hard byte cap across selected components (default: max(sum caps, 2x seed total))")
    parser.add_argument("--max-candidate-bytes-over-seed", type=int, default=None,
                        help="optional candidate-shape guard: reject any selected component that grows by more "
                             "than this many bytes over the seed before spending pool runs")
    parser.add_argument("--reject-broad-artifact-overrides", action="store_true",
                        help="candidate-shape guard for bootstrap/eval-artifact optimization: reject newly "
                             "introduced top-level JSON override modes that tend to bypass the skill workflow")
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
    synthetic_bootstrap_only = suite_is_synthetic_bootstrap_only(case_dirs)
    arms = args.arms or ["xs_with_skill"]
    train_ids, val_ids = split_cases(case_ids, args.train_cases, args.val_cases, buckets)
    # Stable aliases keep raw case ids out of reflection side info.
    case_alias = {cid: f"case-{i + 1}" for i, cid in enumerate(sorted(case_ids))}

    component_selection = parse_components(args.components)
    raw_skill_md = (skill_dir / "SKILL.md").read_text(encoding="utf-8")
    seed_components, seed_sanitization_notes = load_seed_components(
        skill_dir,
        component_selection,
        strip_synthetic_bootstrap=not synthetic_bootstrap_only,
    )
    seed_text = seed_components["skill_md"]
    disallowed_literals: list[tuple[str, str]] = []
    if not synthetic_bootstrap_only:
        synthetic_literals = set(SYNTHETIC_BOOTSTRAP_SCHEMA_RE.findall(raw_skill_md))
        synthetic_literals.add(f"{args.skill}.synthetic-bootstrap.v1")
        for match in sorted(synthetic_literals):
            disallowed_literals.append((match, "synthetic bootstrap schema in a non-synthetic optimization suite"))
    component_caps = {
        name: args.max_component_bytes or args.max_skill_bytes or max(32768, 2 * len(text.encode("utf-8")))
        for name, text in seed_components.items()
    }
    seed_total_bytes = sum(len(text.encode("utf-8")) for text in seed_components.values())
    max_total_bytes = args.max_total_bytes or max(sum(component_caps.values()), 2 * seed_total_bytes)

    out_dir = Path(args.out_dir).resolve() if args.out_dir else (
        REPO_ROOT / "runs" / "optimize" / args.skill / utc_stamp()
    )
    out_dir.mkdir(parents=True, exist_ok=True)
    factory = CandidateFactory(
        args.skill,
        out_dir / "candidates",
        component_caps,
        max_total_bytes,
        case_dirs,
        seed_components,
        disallowed_literals=disallowed_literals,
        max_candidate_bytes_over_seed=args.max_candidate_bytes_over_seed,
        reject_broad_artifact_overrides=args.reject_broad_artifact_overrides,
    )

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
        "reflection_reasoning_effort": args.reflection_reasoning_effort,
        "reflection_pool_agent": args.reflection_pool_agent,
        "reflection_pool_timeout": args.reflection_pool_timeout,
        "reflection_pool_sandbox": args.reflection_pool_sandbox,
        "synthetic_bootstrap_only": synthetic_bootstrap_only,
        "seed_sanitization": seed_sanitization_notes,
        "disallowed_literals": [literal for literal, _why in disallowed_literals],
        "components": list(seed_components),
        "component_caps": component_caps,
        "max_total_bytes": max_total_bytes,
        "max_skill_bytes": component_caps.get("skill_md"),
        "max_candidate_bytes_over_seed": args.max_candidate_bytes_over_seed,
        "reject_broad_artifact_overrides": args.reject_broad_artifact_overrides,
        "workers": args.workers,
        "seed": args.seed,
        "argv": sys.argv[1:],
    }
    (out_dir / "config.json").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"out_dir": str(out_dir), **config}, indent=2), file=sys.stderr)

    # ---------------------------------------------------------------- smoke
    if args.smoke:
        import gepa  # noqa: F401  (proves the optimizer dependency resolves)

        root, violations = factory.materialize(seed_components)
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

    def evaluate(candidate: object, case_id: str, arm: str) -> tuple[float, dict]:
        root, violations = factory.materialize(candidate)
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
                score, side = evaluate(seed_components, case_id, arm)
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
    if args.reflection_pool_agent:
        reflection_lm = make_pool_reflection_lm(args, out_dir)
    elif args.reflection_api_base or args.reflection_api_key_env or args.reflection_reasoning_effort:
        from harness.llm import make_lm  # noqa: PLC0415

        reflection_lm = make_lm(
            args.reflection_lm,
            api_base=args.reflection_api_base,
            api_key_env=args.reflection_api_key_env,
            reasoning_effort=args.reflection_reasoning_effort,
        )

    def evaluator(candidate, example=None, **_kwargs):
        return evaluate(candidate, example["case_id"], example["arm"])

    dataset = [{"case_id": c, "arm": a} for c in train_ids for a in arms]
    valset = [{"case_id": c, "arm": a} for c in val_ids for a in arms]

    objective = (
        f"Rewrite the selected components of the `{args.skill}` agent skill ({list(seed_components)}) so that a small "
        "coding agent (pool CLI / Laguna models) with this skill installed reliably "
        "produces the exact gradeable artifact that the skill's FROZEN validator "
        "checks: right workspace path, schema-valid JSON, evidence-faithful content, "
        "safe suggested actions. Maximize the mean validator score across held-out "
        "eval cases. The skill must STAY GENERAL: never hardcode details of "
        "individual eval cases (ids, specific log lines, specific file names) — "
        "improve the procedure, the output contract explanation, reference guidance, "
        "and the failure-mode warnings instead. When a case prompt specifies a "
        "structured `.laguna/<skill>.json` artifact, the skill should teach the "
        "agent to follow that prompt-local artifact contract exactly rather than "
        "falling back to any generic bootstrap example."
    )
    background = (
        "Authoring contract (mechanically enforced; violations score 0):\n"
        f"- YAML frontmatter must stay valid; `name` must remain `{args.skill}`; "
        "`description` is trigger phrases ('Use when ...'), <=1024 chars; keep "
        "`metadata.version` unchanged (it is bumped manually at promotion).\n"
        "- Keep a 'Do not use when' (non-goals) section.\n"
        "- Keep the deterministic output artifact path and the validator argv "
        "contract exactly as documented in the current SKILL.md.\n"
        f"- Hard caps: per component <= {component_caps}; total <= {max_total_bytes} bytes.\n"
        "- Only selected components may change; eval cases, schemas, and validators are "
        "frozen and byte-compared.\n"
        "- The runtime is `bun` for skill scripts; the agent may not have network "
        "access; validators grade workspace state + final message only."
    )

    result = optimize_anything(
        seed_candidate=seed_components,
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

    raw_best_components = candidate_components(result.best_candidate)
    best_components = {name: raw_best_components.get(name, seed_components[name]) for name in seed_components}
    _root, best_violations = factory.materialize(raw_best_components)
    if best_violations:
        # Should be impossible (gated during search); refuse to ship it anyway.
        print(json.dumps({"error": "best candidate fails gates", "violations": best_violations}), file=sys.stderr)
        return 1

    best_dir = out_dir / "best"
    best_dir.mkdir(exist_ok=True)
    diff_parts = []
    changed_components = []
    for name, text in best_components.items():
        rel = component_relpath(name)
        dest = best_dir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(text, encoding="utf-8")
        seed = seed_components.get(name, "")
        if text != seed:
            changed_components.append(str(rel))
        diff_parts.append("".join(difflib.unified_diff(
            seed.splitlines(keepends=True), text.splitlines(keepends=True),
            fromfile=f"skills/{args.skill}/{rel} (seed)",
            tofile=f"skills/{args.skill}/{rel} (best)",
        )))
    (out_dir / "best.diff").write_text("\n".join(part for part in diff_parts if part), encoding="utf-8")

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
        "best_changed": bool(changed_components),
        "changed_components": changed_components,
        "out_dir": str(out_dir),
        "promotion": "review best.diff, bump metadata.version, open a PR (human merge)",
    }
    (out_dir / "result.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
