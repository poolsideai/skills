#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "litellm>=1.70",
#   "jsonschema>=4.21",
#   "referencing>=0.31",
# ]
# ///
"""Eval-case generator for the skill eval corpus (gskill/SWE-smith recipe).

The pipeline is synthesize -> mechanically validate -> HUMAN-REVIEW into the
frozen set. Generated candidates are quarantined under runs/generate/ (which
is gitignored) and only enter skills/<skill>/evals/ via an explicit --promote
that a human runs after reading the case. Nothing is ever auto-merged: the
eval corpus is the grader, and the grader stays human-curated.

Per candidate, after the LM emits a complete case payload, these mechanical
gates run (violations feed a bounded LM repair loop):

  1. CI parity      — the same scripts/check_eval_cases.py checks CI runs
                      (imported, not reimplemented): folder entries, metadata
                      vs eval-case.v1, id/skill consistency, validator script.
  2. shared target  — prompt.md must name every gold artifact's workspace-
                      relative path (baseline arms share the grading target).
  3. no gold leak   — input/ must not pre-seed any gold artifact path.
  4. dedup          — case id unused; no input file byte-identical to an
                      existing case's input file for this skill.
  5. size caps      — per-file and per-case byte caps; gold *.json parses.
  6. gold replay    — input/ + expected/ overlaid into a scratch workspace,
                      the case's FROZEN validator runs via the fixed argv
                      contract, and its status must equal
                      validator.expected_status (good-failure cases expect
                      "fail"). Same replay the harness does in --dry-run.
  7. sensitivity    — pass-cases replay AGAIN with every gold artifact
                      replaced by junk; the validator must NOT still pass
                      (a case that grades nothing is vacuous).

Usage (from the repo root):

    # generate 4 candidates (LM-proposed specs covering corpus gaps):
    uv run harness/generate/gen_eval_cases.py --skill ci-log-reducer --n 4

    # generate from explicit specs:
    uv run harness/generate/gen_eval_cases.py --skill ci-log-reducer \
        --spec 'CircleCI yarn workspace test failure with a misleading warning decoy'

    # offline: run the mechanical gates against existing case dirs (no LM):
    uv run harness/generate/gen_eval_cases.py --skill ci-log-reducer \
        --validate-only skills/ci-log-reducer/evals/ci-log-reducer-pytest-single-failure

    # promote a reviewed candidate into the frozen set (copies the case dir,
    # appends to evals/suites/skill-<skill>.json, re-runs repo checks; rolls
    # back on any failure). Review the diff and commit manually afterwards:
    uv run harness/generate/gen_eval_cases.py --skill ci-log-reducer \
        --promote runs/generate/ci-log-reducer/<stamp>/candidates/<case-id>

Model selection mirrors the optimization track (harness/llm.py): any litellm
id via --model (default $CASEGEN_LM, then $GEPA_REFLECTION_LM, then
anthropic/claude-sonnet-4-5). OpenRouter: --model openrouter/<provider>/<m>
with OPENROUTER_API_KEY. Any OpenAI-compatible endpoint: --api-base URL
[--api-key-env NAME] with a bare served-model name.

Methodology caveats (docs/eval-methodology.md §7 applies): LM-generated cases
share failure-mode priors with LM agents under test — the human review step
plus the adversarial/edge buckets in val splits are the guard, and every
promoted case is marked generated_by in its notes for provenance.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from harness.llm import make_lm  # noqa: E402
from harness.runner import fixtures as fx  # noqa: E402
from harness.runner import matrix as mx  # noqa: E402
from harness.validators.command_result import base_env, run_command  # noqa: E402
from harness.validators.validator_result import load_validator_result  # noqa: E402
from checklib import SKILL_NAME_RE, split_frontmatter  # noqa: E402

DEFAULT_MODEL = (
    os.environ.get("CASEGEN_LM")
    or os.environ.get("GEPA_REFLECTION_LM")
    or "anthropic/claude-sonnet-4-5"
)
MAX_FILE_BYTES = 256 * 1024
MAX_CASE_BYTES = 1024 * 1024
CASE_GENERATION_RESULT_SCHEMA = "case-generation-result.v1"
CONTEXT_FILE_CHARS = 30_000
EXAMPLE_INPUT_CHARS = 4_000
SAFE_SEGMENT = re.compile(r"^[A-Za-z0-9._\-]+$")
FEEDBACK_ITEM_CHARS = 500
IMPORT_IGNORE = shutil.ignore_patterns(
    ".git",
    "node_modules",
    "__pycache__",
    ".DS_Store",
    ".beads",
    "agent_ergonomics_audit",
    "runs",
)


DEFAULT_ARMS = ["xs_without_skill", "xs_with_skill", "m_without_skill", "m_with_skill"]
ARTIFACT_PATH_RE = re.compile(r"(?:`|\s|^)((?:\.laguna|[A-Za-z0-9._/-]+?)/[A-Za-z0-9._/-]+\.json)(?:`|\s|$)")
NON_GOALS_MARKERS = ("do not use when", "non-goals", "non goals")


def infer_artifact_paths(text: str) -> list[str]:
    paths = {m.group(1).strip("`,)") for m in ARTIFACT_PATH_RE.finditer(text)}
    return sorted(
        p for p in paths
        if not p.startswith("schemas/")
        and not p.endswith("validator-result.json")
        and "/validator-result" not in p
    )


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%SZ")


def validate_only_payload(case_dir: Path, violations: list[str], info: dict) -> dict:
    payload = {
        "schema_version": CASE_GENERATION_RESULT_SCHEMA,
        "operation": "validate-only",
        "case_id": case_dir.name,
        "case_dir": str(case_dir),
        "ok": not violations,
        "violations": violations,
    }
    if info["replay_status"] is not None:
        payload["replay_status"] = info["replay_status"]
    if info["sensitivity_status"] is not None:
        payload["sensitivity_status"] = info["sensitivity_status"]
    return payload


def infer_skill_name_from_dir(skill_dir: Path) -> str:
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        raise SystemExit(f"skill path must contain SKILL.md: {skill_dir}")
    text = skill_md.read_text(encoding="utf-8")
    frontmatter = split_frontmatter(text)
    name: str | None = None
    if frontmatter is not None:
        for line in frontmatter[0].splitlines():
            match = re.fullmatch(r"\s*name:\s*[\"']?([^\"'#\s]+)[\"']?\s*(?:#.*)?", line)
            if match:
                name = match.group(1)
                break
    name = name or skill_dir.name
    if not SKILL_NAME_RE.fullmatch(name):
        raise SystemExit(
            f"skill path {skill_dir} resolves to invalid skill name {name!r}; "
            "frontmatter name must be kebab-case"
        )
    return name


def resolve_skill_argument(raw_skill: str) -> tuple[str, dict[str, str | bool | None]]:
    """Resolve --skill as either a repo skill name or a filesystem path.

    Path mode is designed around a full skill directory because supporting
    files such as references/, schemas/, scripts/, and assets/ are part of the
    skill contract. Passing a SKILL.md file is accepted as a convenience alias
    for its parent directory.
    """
    raw_path = Path(raw_skill).expanduser()
    path_like = raw_path.is_absolute() or len(raw_path.parts) > 1 or raw_skill in {".", ".."}
    if not path_like:
        return raw_skill, {
            "skill_source": None,
            "skill_imported": False,
            "skill_import_reused": False,
            "imported_skill_dir": None,
        }

    candidate = raw_path if raw_path.is_absolute() else REPO_ROOT / raw_path
    if candidate.is_file() and candidate.name == "SKILL.md":
        candidate = candidate.parent
    source_dir = candidate.resolve()
    if not (source_dir / "SKILL.md").is_file():
        raise SystemExit(
            f"--skill path must be a skill directory or SKILL.md file: {raw_skill}. "
            "Use --skill <name> for an existing repo skill."
        )

    skill = infer_skill_name_from_dir(source_dir)
    repo_skill_dir = REPO_ROOT / "skills" / skill
    imported = False
    try:
        same_as_repo = repo_skill_dir.resolve() == source_dir
    except FileNotFoundError:
        same_as_repo = False
    if not same_as_repo:
        if repo_skill_dir.exists():
            return skill, {
                "skill_source": str(source_dir),
                "skill_imported": False,
                "skill_import_reused": True,
                "imported_skill_dir": str(repo_skill_dir.relative_to(REPO_ROOT)),
            }
        else:
            repo_skill_dir.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(source_dir, repo_skill_dir, ignore=IMPORT_IGNORE)
            imported = True

    return skill, {
        "skill_source": str(source_dir),
        "skill_imported": imported,
        "skill_import_reused": False,
        "imported_skill_dir": str(repo_skill_dir.relative_to(REPO_ROOT)),
    }


def missing_validator_message(skill: str) -> str:
    return "\n".join([
        f"skill {skill} has no scripts/validate_*.ts - not generatable yet",
        "The skill was resolved/imported, but eval-case generation needs a frozen validator first.",
        "Next commands:",
        f"- bun ui/bench.ts onboard-prepare --source skills/{skill} --skill {skill} --import-source",
        f"- add schemas/*.schema.json and scripts/validate_*.ts, then rerun: uv run harness/generate/gen_eval_cases.py --skill {skill} --bootstrap --n 3",
    ])


def validator_slug(skill: str) -> str:
    return re.sub(r"[^A-Za-z0-9_]", "_", skill)


def body_has_non_goals_heading(body: str) -> bool:
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped.startswith("#"):
            continue
        heading = stripped.lstrip("#").strip().lower()
        if any(marker in heading for marker in NON_GOALS_MARKERS):
            return True
    return False


def frontmatter_has_metadata_version(yaml_text: str) -> bool:
    lines = yaml_text.splitlines()
    in_metadata = False
    metadata_indent = 0
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(line) - len(line.lstrip(" "))
        if re.match(r"^metadata\s*:\s*(?:#.*)?$", stripped):
            in_metadata = True
            metadata_indent = indent
            continue
        if in_metadata:
            if indent <= metadata_indent and not line.startswith(" "):
                in_metadata = False
            elif re.match(r"^version\s*:\s*['\"][0-9]+\.[0-9]+\.[0-9]+['\"]\s*(?:#.*)?$", stripped):
                return True
    return False


def add_frontmatter_metadata_version(yaml_text: str) -> str:
    lines = yaml_text.splitlines()
    for index, line in enumerate(lines):
        if re.match(r"^\s*metadata\s*:\s*(?:#.*)?$", line.strip()):
            indent = len(line) - len(line.lstrip(" "))
            lines.insert(index + 1, " " * (indent + 2) + 'version: "0.1.0"')
            return "\n".join(lines)
    return yaml_text.rstrip() + '\nmetadata:\n  version: "0.1.0"'


def ensure_imported_authoring_contract(skill: str, skill_dir: Path) -> bool:
    """Patch only the repo-local imported copy so downstream GEPA gates work."""
    skill_md = skill_dir / "SKILL.md"
    text = skill_md.read_text(encoding="utf-8")
    parts = split_frontmatter(text)
    if parts is None:
        return False
    yaml_text, body = parts
    changed = False
    if not frontmatter_has_metadata_version(yaml_text):
        yaml_text = add_frontmatter_metadata_version(yaml_text)
        changed = True
    if not body_has_non_goals_heading(body):
        body = body.rstrip() + (
            "\n\n## Do not use when\n\n"
            "Do not use when the task does not match this imported skill's trigger, "
            "or when a repo-native Laguna skill with a reviewed eval corpus is a better fit.\n"
        )
        changed = True
    if changed:
        skill_md.write_text(f"---\n{yaml_text.rstrip()}\n---\n\n{body.lstrip()}", encoding="utf-8")
    return changed


def has_laguna_validator(skill_dir: Path) -> bool:
    return any((skill_dir / "scripts").glob("validate_*.ts"))


def ensure_synthetic_laguna_contract(skill: str, skill_dir: Path) -> bool:
    """Add a minimal generated Laguna contract to an imported prompt-style skill.

    The source skill is not edited; callers run this only against the repo-local
    imported copy under skills/<name>. This gives case generation a frozen
    validator and deterministic artifact path instead of stopping at the
    missing-Laguna-layer gap.
    """
    if has_laguna_validator(skill_dir):
        return False

    schema_version = f"{skill}.synthetic-bootstrap.v1"
    artifact_path = f".laguna/{skill}.json"
    schema_dir = skill_dir / "schemas"
    scripts_dir = skill_dir / "scripts"
    schema_dir.mkdir(parents=True, exist_ok=True)
    scripts_dir.mkdir(parents=True, exist_ok=True)

    schema_path = schema_dir / f"{skill}-synthetic-bootstrap.schema.json"
    if not schema_path.exists():
        schema_path.write_text(
            json.dumps(
                {
                    "$schema": "https://json-schema.org/draft/2020-12/schema",
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["schema_version", "summary", "evidence"],
                    "properties": {
                        "schema_version": {"const": schema_version},
                        "summary": {"type": "string", "minLength": 1},
                        "evidence": {
                            "type": "array",
                            "minItems": 1,
                            "items": {"type": "string", "minLength": 1},
                        },
                    },
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

    validator_path = scripts_dir / f"validate_{validator_slug(skill)}_synthetic_bootstrap.ts"
    if not validator_path.exists():
        validator_path.write_text(
            f"""#!/usr/bin/env bun
import {{ mkdirSync, readFileSync, writeFileSync }} from "node:fs";
import {{ dirname, join }} from "node:path";

const valueAfter = (flag: string): string | null => {{
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}};

const workspace = valueAfter("--workspace") ?? ".";
const out = valueAfter("--out");
const caseDir = valueAfter("--case");
if (!out) throw new Error("missing --out");

let status: "pass" | "fail" = "fail";
let detail = "artifact missing or invalid";
try {{
  const artifact = JSON.parse(readFileSync(join(workspace, {json.dumps(artifact_path)}), "utf8"));
  const evidence = Array.isArray(artifact.evidence) ? artifact.evidence : [];
  if (
    artifact.schema_version === {json.dumps(schema_version)} &&
    typeof artifact.summary === "string" &&
    artifact.summary.trim().length > 0 &&
    evidence.length > 0 &&
    evidence.every((item: unknown) => typeof item === "string" && item.trim().length > 0)
  ) {{
    status = "pass";
    detail = "synthetic bootstrap artifact satisfies the generated Laguna contract";
  }}
}} catch {{
  // fall through to fail result
}}

mkdirSync(dirname(out), {{ recursive: true }});
writeFileSync(out, JSON.stringify({{
  schema_version: "validator-result.v1",
  case_id: caseDir ? caseDir.split("/").filter(Boolean).pop() : {json.dumps(skill + "-synthetic-bootstrap")},
  status,
  score: status === "pass" ? 1 : 0,
  checks: [{{ id: "synthetic-bootstrap-artifact", status, detail }}],
  repair_feedback: status === "pass" ? [] : [
    `Write {artifact_path} with schema_version {schema_version}, summary, and evidence.`
  ],
  duration_ms: 0
}}, null, 2) + "\\n");
""",
            encoding="utf-8",
        )

    skill_md_path = skill_dir / "SKILL.md"
    skill_md = skill_md_path.read_text(encoding="utf-8")
    if artifact_path not in skill_md:
        skill_md_path.write_text(
            skill_md.rstrip()
            + f"""

## Synthetic Laguna Bootstrap Contract

This section was generated during eval-case bootstrap because the imported skill did not yet contain Laguna schemas or validators.

Write `{artifact_path}` with:

- `schema_version`: `{schema_version}`
- `summary`: non-empty string summarizing the completed work
- `evidence`: non-empty array of local evidence strings
"""
            + "\n",
            encoding="utf-8",
        )
    return True


def clip(text: str, chars: int) -> str:
    if len(text) <= chars:
        return text
    return text[:chars] + f"\n... [clipped at {chars} chars]"


def child_env() -> dict[str, str]:
    # Runs inside uv's isolated PEP 723 env; drop VIRTUAL_ENV so nested
    # `uv run` resolves the repo project env instead of warning.
    env = dict(os.environ)
    env.pop("VIRTUAL_ENV", None)
    return env


# --------------------------------------------------------------------- skill context


class SkillContext:
    """Everything the generator needs to know about one skill, read once."""

    def __init__(self, skill: str, seed_example: str | None, *, bootstrap: bool = False) -> None:
        self.skill = skill
        self.bootstrap = bootstrap
        self.skill_dir = REPO_ROOT / "skills" / skill
        if not (self.skill_dir / "SKILL.md").is_file():
            raise SystemExit(f"no such skill: {skill} ({self.skill_dir}/SKILL.md missing)")
        self.skill_md = (self.skill_dir / "SKILL.md").read_text(encoding="utf-8")
        self.schemas = {
            p.name: p.read_text(encoding="utf-8")
            for p in sorted((self.skill_dir / "schemas").glob("*.schema.json"))
        }
        self.validators = {
            p.name: p.read_text(encoding="utf-8")
            for p in sorted((self.skill_dir / "scripts").glob("validate_*.ts"))
        }
        if not self.validators:
            raise SystemExit(missing_validator_message(skill))

        evals_dir = self.skill_dir / "evals"
        self.cases = [
            mx.load_case(d)
            for d in sorted(p for p in evals_dir.iterdir() if p.is_dir())
        ] if evals_dir.is_dir() else []
        clean = [c for c in self.cases if not c.errors]
        self.clean_cases = clean
        self.has_clean_cases = bool(clean)
        self.existing_ids = {c.id for c in self.cases}
        self.example: mx.Case | None = None
        self.canonical_validator: list[str] | None = None
        self.artifact_relpaths: list[str] = []

        if not clean and (not bootstrap or seed_example):
            raise SystemExit(f"skill {skill} has no loadable eval cases to seed from")

        # Byte-dedup index over every existing case's input files.
        self.input_hashes: dict[str, str] = {}
        for case in self.cases:
            if case.input_dir.is_dir():
                for f in sorted(p for p in case.input_dir.rglob("*") if p.is_file()):
                    digest = hashlib.sha256(f.read_bytes()).hexdigest()
                    self.input_hashes.setdefault(digest, f"{case.id}/input/{f.relative_to(case.input_dir)}")

        if bootstrap and not clean:
            if seed_example:
                raise SystemExit("--seed-example cannot be used with --bootstrap before any cases exist")
            validator_name = sorted(self.validators)[0]
            self.example = None
            self.canonical_validator = ["bun", f"skills/{skill}/scripts/{validator_name}"]
            schema_text = "\n".join(self.schemas.values())
            self.artifact_relpaths = infer_artifact_paths(self.skill_md + "\n" + schema_text)
            if not self.artifact_relpaths:
                raise SystemExit(
                    f"--bootstrap could not infer a deterministic artifact path for {skill}; "
                    "add one to SKILL.md's Output contract first"
                )
            self.arms = list(DEFAULT_ARMS)
        elif seed_example:
            picks = [c for c in clean if c.id == seed_example]
            if not picks:
                raise SystemExit(f"--seed-example {seed_example!r} is not a loadable case of {skill}")
            self.example = picks[0]
            self.arms = list(self.example.metadata.get("arms") or DEFAULT_ARMS)
        else:
            preferred = [c for c in clean if c.expected_status == "pass"]
            self.example = (preferred or clean)[0]
            self.arms = list(self.example.metadata.get("arms") or DEFAULT_ARMS)
        if self.example is not None:
            self.canonical_validator = self.example.validator_command
            self.artifact_relpaths = [
                str(p.relative_to(self.example.expected_dir))
                for p in sorted(self.example.expected_dir.rglob("*"))
                if p.is_file()
            ]

    def inventory(self) -> str:
        rows = []
        if not self.cases:
            return "No existing eval cases. This is bootstrap mode; create the first worked example."
        for c in self.cases:
            m = c.metadata
            rows.append(
                f"- {c.id} [bucket={m.get('bucket')}, difficulty={m.get('difficulty')}, "
                f"expected_status={c.expected_status}]: {m.get('notes', '')}"
            )
        return "\n".join(rows)

    def example_block(self) -> str:
        if self.example is None:
            return "\n\n".join([
                "### bootstrap mode",
                "No existing case is available. Create the first case in the same shape the harness expects.",
                "### metadata.json required shape",
                json.dumps({
                    "id": f"{self.skill}-<slug>",
                    "skill": self.skill,
                    "bucket": "easy|realistic|adversarial|edge",
                    "difficulty": "easy|medium|hard",
                    "arms": self.arms,
                    "publishability": "internal",
                    "validator": {"command": self.canonical_validator, "expected_status": "pass|fail"},
                    "notes": "Synthetic fixture; no customer data. Generated case.",
                }, indent=2),
            ])
        parts = [f"### prompt.md\n{self.example.prompt_path.read_text(encoding='utf-8')}"]
        parts.append(
            "### metadata.json\n"
            + json.dumps(self.example.metadata, indent=2)
        )
        for f in sorted(p for p in self.example.input_dir.rglob("*") if p.is_file()):
            rel = f.relative_to(self.example.input_dir)
            parts.append(
                f"### input/{rel} (excerpt)\n"
                + clip(f.read_text(encoding="utf-8", errors="replace"), EXAMPLE_INPUT_CHARS)
            )
        for rel in self.artifact_relpaths:
            gold = self.example.expected_dir / rel
            parts.append(
                f"### expected/{rel} (gold artifact)\n"
                + clip(gold.read_text(encoding="utf-8", errors="replace"), EXAMPLE_INPUT_CHARS)
            )
        return "\n\n".join(parts)


def skill_has_visible_case_dirs(skill: str) -> bool:
    evals_dir = REPO_ROOT / "skills" / skill / "evals"
    if not evals_dir.is_dir():
        return False
    return any(
        p.is_dir() and not p.name.startswith(".")
        for p in sorted(evals_dir.iterdir())
    )


# --------------------------------------------------------------------- LM prompts


def spec_prompt(ctx: SkillContext, n: int) -> str:
    return f"""You design evaluation cases for an agent-skill eval harness.

Skill under test: `{ctx.skill}`. Its SKILL.md contract:

```markdown
{clip(ctx.skill_md, CONTEXT_FILE_CHARS)}
```

Existing eval cases (DO NOT duplicate these scenarios):
{ctx.inventory()}

Propose exactly {n} NEW case specs that grow coverage of this corpus. Rules:
- Diversity first: new tools/providers/failure shapes/log dialects (or the
  analogous axes for this skill), not rewordings of existing cases.
- Spread across buckets; include at least one "adversarial" (tries to trip the
  skill with decoys/misleading content) or "edge" spec when {n} >= 3.
- expected_status "fail" (a GOOD-FAILURE case) has strict live-run semantics:
  the SCENARIO ITSELF must make a failing validator verdict the correct
  outcome of CORRECT agent behavior (e.g. an impossible or out-of-scope
  request the agent should refuse to inflate). It is NOT "a normal scenario
  with a deliberately broken gold" — that would grade good agents as failures
  and bad agents as passes in live runs. If no such scenario exists for this
  skill, propose only expected_status "pass" specs.
- Everything synthetic: invent project/file/test names. No real company,
  customer, or personal data.

Return ONLY a JSON array of {n} objects, each:
{{"slug": "<kebab suffix, no skill-name prefix>",
  "bucket": "easy|realistic|adversarial|edge",
  "difficulty": "easy|medium|hard",
  "expected_status": "pass" | "fail",
  "scenario": "<3-6 sentences: the fixture, the failure, what makes it challenging>",
  "target_gap": "<which coverage gap this fills>"}}"""


def materialize_prompt(ctx: SkillContext, spec: dict, attempt: str | None, violations: list[str]) -> str:
    schemas = "\n\n".join(f"### schemas/{name}\n```json\n{clip(text, CONTEXT_FILE_CHARS)}\n```" for name, text in ctx.schemas.items())
    validators = "\n\n".join(f"### scripts/{name}\n```ts\n{clip(text, CONTEXT_FILE_CHARS)}\n```" for name, text in ctx.validators.items())
    repair = ""
    if attempt is not None:
        repair = f"""

== YOUR PREVIOUS ATTEMPT FAILED THE MECHANICAL GATES ==
Previous payload:
```json
{clip(attempt, CONTEXT_FILE_CHARS)}
```
Gate violations to fix (change ONLY what these require; keep the rest):
- """ + "\n- ".join(violations)
    return f"""You author ONE complete eval case for the `{ctx.skill}` agent skill. The case
will be graded by a FROZEN validator that you cannot change — your gold
artifact must make that validator return status "{spec.get('expected_status', 'pass')}" when replayed.

== Skill contract (SKILL.md) ==
```markdown
{clip(ctx.skill_md, CONTEXT_FILE_CHARS)}
```

== Output artifact schema(s) ==
{schemas}

== FROZEN validator source — study exactly what it checks ==
{validators}

== Example case (study the SHAPE; do not copy the content or scenario) ==
{ctx.example_block()}

== Your assignment ==
{json.dumps(spec, indent=2)}

Authoring rules (mechanically enforced; violations are rejected):
- case_id = "{ctx.skill}-<slug>" (kebab-case).
- metadata must conform to eval-case.v1 exactly like the example: fields id,
  skill ("{ctx.skill}"), bucket, difficulty, arms {json.dumps(ctx.arms)},
  publishability ("internal"), validator, notes. Use validator.command
  {json.dumps(ctx.canonical_validator)} and expected_status "{spec.get('expected_status', 'pass')}".
  End notes with: "Synthetic fixture; no customer data. Generated case."
- prompt.md must explicitly name every gold artifact workspace-relative path
  ({', '.join('`' + p + '`' for p in ctx.artifact_relpaths)}) so baseline arms share the grading
  target. The prompt must NOT mention the skill, its name, or its internals.
- input/ is the entire world the agent sees: realistic raw fixtures with
  realistic noise. NEVER place a gold artifact path inside input/.
- expected/ holds the gold artifact(s) at exactly the path(s) the prompt
  names. Evidence faithfulness is mechanically cross-checked: any line number
  or verbatim quote cited in a gold artifact must match the input fixture
  byte-for-byte (count lines carefully, 1-based).
- For expected_status "fail": valid ONLY when the scenario makes a failing
  verdict the correct outcome of correct agent behavior (live runs grade
  models on matching this status). The gold then shows the natural artifact
  such a scenario produces — which the validator rejects. For expected_status
  "pass": the gold must fully satisfy the validator.
- Everything synthetic; no real-world company/customer/person data; fixtures
  must not require network access to make sense.{repair}

Return ONLY one JSON object (no commentary):
{{"case_id": "{ctx.skill}-<slug>",
  "metadata": {{ ...metadata.json object... }},
  "files": {{"prompt.md": "<text>",
            "input/<name>": "<text>", ...,
            "expected/<artifact-path>": "<text>", ...}}}}"""


def extract_json(text: str) -> object | None:
    candidates: list[str] = re.findall(r"```(?:json)?\s*\n(.*?)```", text, re.DOTALL)
    candidates.append(text.strip())
    for opener, closer in (("{", "}"), ("[", "]")):
        i, j = text.find(opener), text.rfind(closer)
        if i != -1 and j > i:
            candidates.append(text[i : j + 1])
    for c in candidates:
        try:
            return json.loads(c)
        except json.JSONDecodeError:
            continue
    return None


# --------------------------------------------------------------------- candidate IO


def write_candidate(parent: Path, payload: object) -> tuple[Path | None, list[str]]:
    """Write one LM case payload to parent/<case_id>/. Returns (dir, problems);
    dir is None when the payload is too malformed to write at all."""
    problems: list[str] = []
    if not isinstance(payload, dict):
        return None, ["payload: not a JSON object"]
    case_id = payload.get("case_id")
    metadata = payload.get("metadata")
    files = payload.get("files")
    if not isinstance(case_id, str) or not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", case_id):
        return None, [f"payload: case_id {case_id!r} is not a kebab-case id"]
    if not isinstance(metadata, dict):
        return None, ["payload: metadata is not an object"]
    if not isinstance(files, dict) or not files:
        return None, ["payload: files is not a non-empty object"]

    rels: dict[str, str] = {}
    for rel, content in files.items():
        if not isinstance(rel, str) or not isinstance(content, str):
            problems.append(f"files[{rel!r}]: path and content must be strings")
            continue
        parts = Path(rel).parts
        if rel == "metadata.json":
            problems.append("files: metadata.json belongs in the `metadata` key, not files")
            continue
        ok_root = rel == "prompt.md" or (len(parts) >= 2 and parts[0] in ("input", "expected"))
        if not ok_root or any(p == ".." for p in parts) or rel.startswith("/") or "\\" in rel:
            problems.append(f"files[{rel!r}]: path must be prompt.md or under input/ or expected/")
            continue
        if not all(SAFE_SEGMENT.fullmatch(p) for p in parts):
            problems.append(f"files[{rel!r}]: path segment with unsafe characters")
            continue
        if len(content.encode("utf-8")) > MAX_FILE_BYTES:
            problems.append(f"files[{rel!r}]: exceeds per-file cap of {MAX_FILE_BYTES} bytes")
            continue
        rels[rel] = content
    folded: dict[str, str] = {}
    for rel in rels:
        if rel.casefold() in folded:
            problems.append(
                f"files: {rel!r} and {folded[rel.casefold()]!r} collide on case-insensitive "
                "filesystems (APFS) — use distinct lowercase names"
            )
        folded[rel.casefold()] = rel
    if "prompt.md" not in rels:
        problems.append("files: prompt.md missing")
    if not any(r.startswith("input/") for r in rels):
        problems.append("files: no input/ file (input/ is the world the agent sees)")
    if not any(r.startswith("expected/") for r in rels):
        problems.append("files: no expected/ gold artifact")
    total = sum(len(c.encode("utf-8")) for c in rels.values())
    if total > MAX_CASE_BYTES:
        problems.append(f"files: case totals {total} bytes; cap is {MAX_CASE_BYTES}")
    if problems:
        return None, problems

    case_dir = parent / case_id
    if case_dir.exists():
        shutil.rmtree(case_dir)
    (case_dir / "input").mkdir(parents=True)
    (case_dir / "expected").mkdir(parents=True)
    for rel, content in rels.items():
        dest = case_dir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(content if content.endswith("\n") else content + "\n", encoding="utf-8")
    (case_dir / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    return case_dir, []


def slugify_segment(value: object, fallback: str) -> str:
    raw = str(value or fallback).lower()
    slug = re.sub(r"[^a-z0-9]+", "-", raw).strip("-")
    return slug or fallback


def read_schema_const_for_property(ctx: SkillContext, prop: str) -> str | None:
    for text in ctx.schemas.values():
        try:
            schema = json.loads(text)
        except json.JSONDecodeError:
            continue
        properties = schema.get("properties") if isinstance(schema, dict) else None
        field = properties.get(prop) if isinstance(properties, dict) else None
        const = field.get("const") if isinstance(field, dict) else None
        if isinstance(const, str):
            return const
    return None


def skeleton_gold_for_artifact(ctx: SkillContext, artifact_relpath: str) -> str:
    if artifact_relpath == f".laguna/{ctx.skill}.json":
        schema_version = (
            read_schema_const_for_property(ctx, "schema_version")
            or f"{ctx.skill}.synthetic-bootstrap.v1"
        )
        return json.dumps(
            {
                "schema_version": schema_version,
                "summary": "Completed the requested work from local input evidence.",
                "evidence": ["input/brief.md"],
            },
            indent=2,
        )
    return json.dumps(
        {
            "todo": "Replace this starter gold with a validator-complete artifact before promotion.",
            "artifact_path": artifact_relpath,
        },
        indent=2,
    )


def skeleton_candidate_payload(ctx: SkillContext, spec: dict | None, index: int) -> dict:
    spec = spec or {}
    suffix = slugify_segment(spec.get("slug") or spec.get("scenario"), f"starter-{index}")
    base_case_id = f"{ctx.skill}-{suffix}"
    if not base_case_id.startswith(f"{ctx.skill}-"):
        base_case_id = f"{ctx.skill}-{base_case_id}"
    case_id = base_case_id
    counter = 2
    while case_id in ctx.existing_ids:
        case_id = f"{base_case_id}-{counter}"
        counter += 1
    artifact_relpaths = ctx.artifact_relpaths or [f".laguna/{ctx.skill}.json"]
    artifact_list = ", ".join(f"`{p}`" for p in artifact_relpaths)
    scenario = str(
        spec.get("scenario")
        or "A first bootstrap case for a newly imported skill with no existing eval corpus."
    )
    files: dict[str, str] = {
        "prompt.md": "\n".join(
            [
                "Read the local input brief and complete the requested work.",
                f"Write the grading artifact at {artifact_list}.",
                "",
            ]
        ),
        "input/brief.md": "\n".join(
            [
                "# Bootstrap Fixture Brief",
                "",
                f"Case id: {case_id}",
                "",
                scenario,
                "",
                "Use only this local fixture. Do not rely on network access or external project state.",
                "",
            ]
        ),
    }
    for rel in artifact_relpaths:
        files[f"expected/{rel}"] = skeleton_gold_for_artifact(ctx, rel)
    return {
        "case_id": case_id,
        "metadata": {
            "id": case_id,
            "skill": ctx.skill,
            "bucket": spec.get("bucket") or "easy",
            "difficulty": spec.get("difficulty") or "easy",
            "arms": ctx.arms,
            "publishability": "internal",
            "validator": {
                "command": ctx.canonical_validator,
                "expected_status": spec.get("expected_status") or "pass",
            },
            "notes": "No-LM bootstrap starter. Review before promotion. Synthetic fixture; no customer data. Generated case.",
        },
        "files": files,
    }


def write_generation_config(out_dir: Path, config: dict) -> None:
    (out_dir / "config.json").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")


def generate_no_lm_skeletons(
    ctx: SkillContext,
    args: argparse.Namespace,
    out_dir: Path,
    config: dict,
    *,
    reason: str,
) -> int:
    specs: list[dict]
    if args.specs:
        specs = []
        for raw in args.specs:
            try:
                parsed = json.loads(raw)
                specs.append(parsed if isinstance(parsed, dict) else {"scenario": raw})
            except json.JSONDecodeError:
                specs.append({"scenario": raw})
    else:
        specs = [{
            "slug": "no-lm-bootstrap-starter",
            "bucket": "easy",
            "difficulty": "easy",
            "expected_status": "pass",
            "scenario": (
                "Starter case produced mechanically because no case-generation LM was configured."
            ),
        }]

    write_generation_config(out_dir, {**config, "no_lm_skeleton": True, "no_lm_reason": reason})
    results = []
    for index, spec in enumerate(specs[: args.n], start=1):
        payload = skeleton_candidate_payload(ctx, spec, index)
        case_dir, problems = write_candidate(out_dir / "candidates", payload)
        record: dict = {
            "spec": spec,
            "case_dir": str(case_dir) if case_dir is not None else None,
            "rounds": [],
            "ok": False,
            "generated_without_lm": True,
        }
        if case_dir is None:
            violations = problems
            info = {"replay_status": None, "sensitivity_status": None}
        else:
            violations, info = gate_candidate(ctx, case_dir, args.validator_timeout)
        record["replay_status"] = info["replay_status"]
        record["sensitivity_status"] = info["sensitivity_status"]
        record["rounds"].append({"round": 0, "violations": violations})
        record["ok"] = not violations
        results.append(record)

    survivors = [r for r in results if r["ok"]]
    report = {
        "schema_version": "case-generation.v1",
        "skill": ctx.skill,
        "skill_source": config["skill_source"],
        "skill_imported": config["skill_imported"],
        "skill_import_reused": config["skill_import_reused"],
        "imported_skill_dir": config["imported_skill_dir"],
        "synthetic_laguna_bootstrap": config["synthetic_laguna_bootstrap"],
        "out_dir": str(out_dir),
        "n_specs": len(specs[: args.n]),
        "n_survivors": len(survivors),
        "generated_without_lm": True,
        "no_lm_reason": reason,
        "results": results,
        "promote_hint": [
            f"uv run harness/generate/gen_eval_cases.py --skill {ctx.skill} --promote {r['case_dir']}"
            for r in survivors
        ],
        "reminder": "no-LM candidates are starter artifacts; review each case BEFORE promoting.",
    }
    (out_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if survivors else 1


# --------------------------------------------------------------------- gates


def collect_validator_feedback(result: dict) -> list[str]:
    feedback = []
    for item in result.get("repair_feedback") or []:
        if isinstance(item, str) and item.strip():
            feedback.append(item.strip()[:FEEDBACK_ITEM_CHARS])
    for check in result.get("checks") or []:
        if isinstance(check, dict) and check.get("status") == "fail":
            feedback.append(f"check {check.get('id')}: {str(check.get('detail'))[:FEEDBACK_ITEM_CHARS]}")
    return feedback[:24]


def replay_candidate(
    case: mx.Case, timeout_s: float, *, corrupt_golds: list[str] | None = None
) -> tuple[str | None, list[str]]:
    """Gold replay via the fixed argv contract. Returns (status, problems).

    With ``corrupt_golds``, the named workspace-relative gold artifacts are
    overwritten with junk after materialization — the sensitivity probe: a
    validator that still passes graded nothing."""
    workspace = fx.materialize_replay_workspace(case)
    for rel in corrupt_golds or []:
        target = workspace / rel
        if target.is_file():
            target.write_text("{}\n", encoding="utf-8")
    out_dir = Path(tempfile.mkdtemp(prefix="gen-replay-out-"))
    try:
        argv = [
            *case.validator_command,
            "--case", str(case.case_dir),
            "--workspace", str(workspace),
            "--out", str(out_dir / "validator.json"),
        ]
        run = run_command(argv, cwd=REPO_ROOT, env=base_env(), timeout_s=timeout_s)
        result, errors = load_validator_result(out_dir / "validator.json")
        if result is None:
            return None, [
                f"replay: validator produced no valid result (exit {run.exit_code}"
                + (", timed out" if run.timed_out else "")
                + f"): {'; '.join(errors)}"
            ]
        if corrupt_golds:
            return result["status"], []
        if result["status"] != case.expected_status:
            problems = [
                f"replay: validator returned {result['status']!r} on the gold artifacts, "
                f"expected {case.expected_status!r}"
            ]
            if case.expected_status == "pass":
                problems += collect_validator_feedback(result)
            else:
                problems.append(
                    "good-failure case: the gold artifact must be deliberately bad enough "
                    "that the validator fails it"
                )
            return result["status"], problems
        return result["status"], []
    finally:
        shutil.rmtree(workspace, ignore_errors=True)
        shutil.rmtree(out_dir, ignore_errors=True)


def gate_candidate(ctx: SkillContext, case_dir: Path, timeout_s: float) -> tuple[list[str], dict]:
    """All mechanical gates for one candidate case dir. Returns (violations, info)."""
    import check_eval_cases as cec  # noqa: PLC0415
    from checklib import Report  # noqa: PLC0415

    violations: list[str] = []
    info: dict = {"replay_status": None, "sensitivity_status": None}
    case_dir = case_dir.resolve()
    is_canonical = case_dir.parent == (ctx.skill_dir / "evals").resolve()
    if not case_dir.is_dir():
        case = mx.load_case(case_dir)
        for err in case.errors:
            line = f"case-load: {err}"
            if line not in violations:
                violations.append(line)
        if not violations:
            violations.append(f"case-load: case directory missing: {case_dir}")
        return violations, info

    # 1. CI parity: the exact checks scripts/check_eval_cases.py runs per case.
    report = Report("gen-eval-cases")
    schema_validator = cec.load_case_schema(report)
    cec.check_case(report, ctx.skill_dir, case_dir, schema_validator)
    violations += [f"structure {v.check}: {v.message}" for v in report.violations]

    case = mx.load_case(case_dir)
    for err in case.errors:
        line = f"case-load: {err}"
        if line not in violations:
            violations.append(line)

    # 2+3+5. Shared grading target, no gold leak, parseable JSON golds.
    expected_files = (
        [p.relative_to(case.expected_dir) for p in sorted(case.expected_dir.rglob("*")) if p.is_file()]
        if case.expected_dir.is_dir()
        else []
    )
    if not expected_files:
        violations.append("expected: no gold artifact files")
    prompt_text = case.prompt_path.read_text(encoding="utf-8") if case.prompt_path.is_file() else ""
    for rel in expected_files:
        if str(rel) not in prompt_text:
            violations.append(
                f"prompt-names-artifact: prompt.md must name the gold artifact path `{rel}` "
                "so without-skill arms share the grading target"
            )
        if (case.input_dir / rel).exists():
            violations.append(f"gold-leak: input/ pre-seeds the gold artifact path `{rel}`")
        if rel.suffix == ".json":
            try:
                json.loads((case.expected_dir / rel).read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                violations.append(f"gold-json: expected/{rel} is not valid JSON: {exc}")

    # 4. Dedup against the existing corpus (self-matches allowed for canonical dirs).
    if not is_canonical:
        if case.id in ctx.existing_ids:
            violations.append(f"dedup: case id {case.id!r} already exists for this skill")
        if case.input_dir.is_dir():
            for f in sorted(p for p in case.input_dir.rglob("*") if p.is_file()):
                digest = hashlib.sha256(f.read_bytes()).hexdigest()
                if digest in ctx.input_hashes:
                    violations.append(
                        f"dedup: input/{f.relative_to(case.input_dir)} is byte-identical to "
                        f"existing {ctx.input_hashes[digest]} — fixtures must be novel"
                    )

    # 5b. Size caps + symlink ban (also re-checked here for --validate-only
    # inputs; promote copytree would dereference a symlink into the repo).
    total = 0
    for f in sorted(p for p in case_dir.rglob("*")):
        if f.is_symlink():
            violations.append(f"symlink: {f.relative_to(case_dir)} — cases must not contain symlinks")
            continue
        if not f.is_file():
            continue
        size = f.stat().st_size
        total += size
        if size > MAX_FILE_BYTES:
            violations.append(f"size-cap: {f.relative_to(case_dir)} is {size} bytes (cap {MAX_FILE_BYTES})")
    if total > MAX_CASE_BYTES:
        violations.append(f"size-cap: case totals {total} bytes (cap {MAX_CASE_BYTES})")

    # 6. Gold replay against the frozen validator. Dedup violations are
    # diagnostics, not replay-safety issues — replay still runs so the repair
    # loop gets validator signal in the same round. Structural/path/size
    # violations DO block replay (replaying a broken folder is noise).
    replay_blocking = [v for v in violations if not v.startswith("dedup:")]
    if not replay_blocking:
        status, problems = replay_candidate(case, timeout_s)
        info["replay_status"] = status
        violations += problems

        # 7. Sensitivity probe (pass-cases only): corrupt every gold artifact
        # in the workspace and replay again — if the frozen validator STILL
        # passes, the case grades nothing and is vacuous by construction.
        if not problems and case.expected_status == "pass":
            corrupt_status, corrupt_problems = replay_candidate(
                case, timeout_s, corrupt_golds=[str(r) for r in expected_files]
            )
            info["sensitivity_status"] = corrupt_status
            if corrupt_status == "pass":
                violations.append(
                    "sensitivity: validator still returns 'pass' with every gold artifact "
                    "replaced by junk — the case grades nothing (vacuous gold)"
                )
            violations += corrupt_problems
    return violations, info


# --------------------------------------------------------------------- promote


def promote(
    ctx: SkillContext,
    case_dir: Path,
    timeout_s: float,
    *,
    bootstrap: bool = False,
    defer_corpus_minimum: bool = False,
) -> bool:
    violations, info = gate_candidate(ctx, case_dir, timeout_s)
    case = mx.load_case(case_dir)
    if violations:
        print(json.dumps({
            "schema_version": CASE_GENERATION_RESULT_SCHEMA,
            "operation": "promote",
            "case_id": case.id,
            "case_dir": str(case_dir),
            "ok": False,
            "violations": violations,
        }, indent=2))
        return False

    dest = ctx.skill_dir / "evals" / case.id
    if dest.exists():
        print(json.dumps({
            "schema_version": CASE_GENERATION_RESULT_SCHEMA,
            "operation": "promote",
            "case_id": case.id,
            "case_dir": str(case_dir),
            "ok": False,
            "violations": [f"destination exists: {dest}"],
        }, indent=2))
        return False
    suite_path = REPO_ROOT / "evals" / "suites" / f"skill-{ctx.skill}.json"
    suite_original = suite_path.read_text(encoding="utf-8") if suite_path.is_file() else None
    suite_tmp_path: Path | None = None

    def rollback() -> None:
        if suite_tmp_path is not None:
            suite_tmp_path.unlink(missing_ok=True)
        shutil.rmtree(dest, ignore_errors=True)
        if suite_original is None:
            suite_path.unlink(missing_ok=True)
        else:
            suite_path.write_text(suite_original, encoding="utf-8")

    def fail_rolled_back(problems: list[str]) -> bool:
        rollback()
        print(json.dumps({
            "schema_version": CASE_GENERATION_RESULT_SCHEMA,
            "operation": "promote",
            "case_id": case.id,
            "case_dir": str(case_dir),
            "ok": False,
            "rolled_back": True,
            "violations": problems,
        }, indent=2))
        return False

    try:
        shutil.copytree(case_dir, dest)
        entry = f"skills/{ctx.skill}/evals/{case.id}"
        if suite_original is None:
            suite = {"name": f"skill-{ctx.skill}", "cases": []}
        else:
            try:
                suite = json.loads(suite_original)
            except json.JSONDecodeError as exc:
                return fail_rolled_back([f"suite-json: {suite_path}: invalid JSON: {exc}"])
        if not isinstance(suite, dict) or not isinstance(suite.get("cases"), list):
            return fail_rolled_back([
                f"suite-shape: {suite_path}: suite must be an object with a cases array"
            ])
        if not all(isinstance(existing, str) for existing in suite["cases"]):
            return fail_rolled_back([
                f"suite-entry-type: {suite_path}: all existing cases entries must be strings"
            ])
        if entry not in suite["cases"]:
            suite["cases"] = sorted({*suite["cases"], entry})
        suite_path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(prefix=f".{suite_path.name}.", suffix=".tmp", dir=suite_path.parent)
        suite_tmp_path = Path(tmp_name)
        with os.fdopen(fd, "w", encoding="utf-8") as tmp:
            tmp.write(json.dumps(suite, indent=2) + "\n")
        os.replace(suite_tmp_path, suite_path)
        suite_tmp_path = None

        # Re-run the CI checks scoped to this skill + this suite. A repo-wide
        # suite scan would fail on unrelated pre-existing suite violations and
        # wrongly roll back an otherwise valid promotion.
        import check_eval_cases as cec  # noqa: PLC0415
        from checklib import Report  # noqa: PLC0415

        problems: list[str] = []
        report = Report("gen-eval-cases-promote")
        schema_validator = cec.load_case_schema(report)
        if bootstrap or defer_corpus_minimum:
            cec.check_case(report, ctx.skill_dir, dest, schema_validator)
        else:
            cec.check_skill_cases(report, ctx.skill_dir, schema_validator)
        cec.check_suite(report, suite_path)
        problems += [f"post-promote check {v.check}: {v.path}: {v.message}" for v in report.violations]
        dry = subprocess.run(
            ["uv", "run", "harness/runner/run_eval.py", "--suite", str(suite_path),
             "--dry-run", "--replay", "--case", case.id],
            capture_output=True, text=True, cwd=REPO_ROOT, env=child_env(), timeout=timeout_s,
        )
        if dry.returncode != 0:
            problems.append(f"run_eval --dry-run --replay failed:\nstdout:\n{dry.stdout[-2000:]}\nstderr:\n{dry.stderr[-2000:]}")

        if problems:
            return fail_rolled_back(problems)
    except subprocess.TimeoutExpired as exc:
        stdout = (exc.stdout or "")[-2000:] if isinstance(exc.stdout, str) else ""
        stderr = (exc.stderr or "")[-2000:] if isinstance(exc.stderr, str) else ""
        return fail_rolled_back([
            f"run_eval --dry-run --replay timed out after {timeout_s:g}s:\nstdout:\n{stdout}\nstderr:\n{stderr}"
        ])
    except Exception as exc:  # noqa: BLE001 — post-copy failures must leave no promoted residue
        return fail_rolled_back([f"promote: post-copy update failed: {exc}"])

    next_step = "review `git diff`/`git status`, then commit — promotion is a human decision"
    if bootstrap or defer_corpus_minimum:
        try:
            import check_eval_cases as cec  # noqa: PLC0415
            from checklib import Report  # noqa: PLC0415

            completion_report = Report("gen-eval-cases-promote-completion")
            schema_validator = cec.load_case_schema(completion_report)
            cec.check_skill_cases(completion_report, ctx.skill_dir, schema_validator)
            corpus_complete = not completion_report.violations
        except Exception:  # noqa: BLE001 - post-success guidance should not fail promotion
            corpus_complete = False
        if corpus_complete and not defer_corpus_minimum:
            next_step = "review `git diff`/`git status`, then commit — bootstrap corpus is complete"
        else:
            next_step = (
                "review `git diff`/`git status`, then add remaining bootstrap cases; "
                "repo-wide check_eval_cases still requires ≥3 cases including ≥1 adversarial"
            )

    print(json.dumps({
        "schema_version": CASE_GENERATION_RESULT_SCHEMA,
        "operation": "promote",
        "case_id": case.id,
        "case_dir": str(case_dir),
        "ok": True,
        "violations": [],
        "dest": str(dest.relative_to(REPO_ROOT)),
        "suite": str(suite_path.relative_to(REPO_ROOT)),
        "replay_status": info["replay_status"],
        "next": next_step,
    }, indent=2))
    return True


# --------------------------------------------------------------------- main


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate, gate, and promote eval cases for a skill.")
    parser.add_argument("--skill", required=True)
    parser.add_argument("--n", type=int, default=4, help="number of candidates to generate (default 4)")
    parser.add_argument("--spec", action="append", default=[], dest="specs",
                        help="explicit case spec (free text or a JSON object with slug/bucket/"
                             "difficulty/expected_status/scenario); repeatable; skips LM spec proposal")
    parser.add_argument("--model", default=DEFAULT_MODEL,
                        help=f"litellm model id (default {DEFAULT_MODEL}; env CASEGEN_LM / GEPA_REFLECTION_LM). "
                             "OpenRouter: openrouter/<provider>/<model> + OPENROUTER_API_KEY.")
    parser.add_argument("--api-base", default=os.environ.get("CASEGEN_API_BASE"),
                        help="OpenAI-compatible endpoint base URL (env CASEGEN_API_BASE); "
                             "bare model names are addressed as openai/<name>")
    parser.add_argument("--api-key-env", default=os.environ.get("CASEGEN_API_KEY_ENV"),
                        help="env var holding the key for --api-base (env CASEGEN_API_KEY_ENV)")
    parser.add_argument("--max-output-tokens", type=int, default=16384,
                        help="LM completion cap; raise for long fixtures (default 16384)")
    parser.add_argument("--temperature", type=float, default=None)
    parser.add_argument("--max-repair-rounds", type=int, default=2,
                        help="LM repair rounds after a gate rejection (default 2)")
    parser.add_argument("--seed-example", help="case id to use as the worked example (default: first pass-status case)")
    parser.add_argument("--bootstrap", action="store_true",
                        help="allow zero-case generation/validation using SKILL.md, schemas, and validator only")
    parser.add_argument("--no-lm-skeleton", action="store_true",
                        help="offline bootstrap: write mechanically generated starter candidate artifacts and gate them without an LM")
    parser.add_argument("--validator-timeout", type=float, default=120.0)
    parser.add_argument("--out-dir", help="default: runs/generate/<skill>/<utc-stamp>")
    parser.add_argument("--validate-only", nargs="+", metavar="CASE_DIR",
                        help="no LM: run the mechanical gates against existing case dir(s)")
    parser.add_argument("--promote", nargs="+", metavar="CASE_DIR",
                        help="no LM: gate + copy candidate(s) into skills/<skill>/evals/ and the per-skill suite")
    args = parser.parse_args()

    if args.validate_only and args.promote:
        parser.error("--validate-only and --promote are mutually exclusive")
    if args.n < 1:
        parser.error("--n must be at least 1")
    if args.max_output_tokens < 1:
        parser.error("--max-output-tokens must be at least 1")
    if args.max_repair_rounds < 0:
        parser.error("--max-repair-rounds must be non-negative")
    if args.validator_timeout <= 0:
        parser.error("--validator-timeout must be greater than 0")

    skill, skill_resolution = resolve_skill_argument(args.skill)
    synthetic_laguna_bootstrap = False
    if skill_resolution["skill_source"]:
        ensure_imported_authoring_contract(skill, REPO_ROOT / "skills" / skill)
        synthetic_laguna_bootstrap = ensure_synthetic_laguna_contract(
            skill,
            REPO_ROOT / "skills" / skill,
        )
    is_validate_or_promote = bool(args.validate_only or args.promote)
    started_from_true_zero = not skill_has_visible_case_dirs(skill)
    bootstrap_context = args.bootstrap or (started_from_true_zero and not args.seed_example)
    ctx = SkillContext(skill, args.seed_example, bootstrap=bootstrap_context)

    if args.validate_only:
        results = []
        for raw in args.validate_only:
            case_dir = Path(raw) if Path(raw).is_absolute() else REPO_ROOT / raw
            violations, info = gate_candidate(ctx, case_dir, args.validator_timeout)
            results.append(validate_only_payload(case_dir, violations, info))

        if len(results) == 1:
            print(json.dumps(results[0], indent=2))
            return 0 if results[0]["ok"] else 1

        failed = [result for result in results if not result["ok"]]
        aggregate_violations = []
        for result in failed:
            if result["violations"]:
                aggregate_violations.extend(
                    f"{result['case_id']}: {violation}" for violation in result["violations"]
                )
            else:
                aggregate_violations.append(
                    f"{result['case_id']}: validation failed without reported violations"
                )
        payload = {
            "schema_version": CASE_GENERATION_RESULT_SCHEMA,
            "operation": "validate-only",
            "case_id": "aggregate",
            "case_dir": "aggregate",
            "ok": not failed,
            "violations": aggregate_violations,
            "counts": {
                "cases": len(results),
                "ok": len(results) - len(failed),
                "failed": len(failed),
            },
            "results": results,
        }
        print(json.dumps(payload, indent=2))
        return 0 if not failed else 1

    if args.promote:
        failures = 0
        promote_batch_bootstrap = bootstrap_context
        promote_paths = list(args.promote)
        for index, raw in enumerate(promote_paths):
            case_dir = Path(raw) if Path(raw).is_absolute() else REPO_ROOT / raw
            defer_corpus_minimum = len(promote_paths) > 1 and index < len(promote_paths) - 1
            if not promote(
                ctx,
                case_dir,
                args.validator_timeout,
                bootstrap=promote_batch_bootstrap,
                defer_corpus_minimum=defer_corpus_minimum,
            ):
                failures += 1
            ctx = SkillContext(
                skill,
                args.seed_example,
                bootstrap=bootstrap_context,
            )  # refresh ids/hashes after each promote
        return 0 if failures == 0 else 1

    # ----------------------------------------------------------- generation
    out_dir = Path(args.out_dir).resolve() if args.out_dir else (
        REPO_ROOT / "runs" / "generate" / skill / utc_stamp()
    )
    (out_dir / "candidates").mkdir(parents=True, exist_ok=True)
    config = {
        "skill": skill,
        "skill_source": skill_resolution["skill_source"],
        "skill_imported": skill_resolution["skill_imported"],
        "skill_import_reused": skill_resolution["skill_import_reused"],
        "imported_skill_dir": skill_resolution["imported_skill_dir"],
        "synthetic_laguna_bootstrap": synthetic_laguna_bootstrap,
        "model": args.model,
        "api_base": args.api_base,
        "n": args.n,
        "explicit_specs": args.specs,
        "max_repair_rounds": args.max_repair_rounds,
        "seed_example": ctx.example.id if ctx.example is not None else None,
        "bootstrap": bootstrap_context,
        "bootstrap_explicit": args.bootstrap,
        "no_lm_skeleton": args.no_lm_skeleton,
        "argv": sys.argv[1:],
    }
    if args.no_lm_skeleton:
        return generate_no_lm_skeletons(
            ctx,
            args,
            out_dir,
            config,
            reason="requested by --no-lm-skeleton",
        )

    try:
        lm = make_lm(
            args.model,
            api_base=args.api_base,
            api_key_env=args.api_key_env,
            max_tokens=args.max_output_tokens,
            temperature=args.temperature,
        )
    except RuntimeError as exc:
        if bootstrap_context:
            print(
                f"warning: LM setup failed ({exc}); writing no-LM bootstrap skeleton instead",
                file=sys.stderr,
            )
            return generate_no_lm_skeletons(
                ctx,
                args,
                out_dir,
                config,
                reason=f"LM setup failed: {exc}",
            )
        print(f"error: LM setup failed: {exc}", file=sys.stderr)
        print(
            "next: set the requested key environment variable, pass --api-key-env with a populated variable, "
            "use --no-lm-skeleton for bootstrap starter artifacts, "
            "or use --validate-only/--promote for already-generated candidates",
            file=sys.stderr,
        )
        return 2
    write_generation_config(out_dir, config)
    print(json.dumps({"out_dir": str(out_dir), **config}, indent=2), file=sys.stderr)

    if args.specs:
        specs = []
        for raw in args.specs:
            try:
                parsed = json.loads(raw)
                specs.append(parsed if isinstance(parsed, dict) else {"scenario": raw})
            except json.JSONDecodeError:
                specs.append({"scenario": raw})
    else:
        try:
            raw_specs = extract_json(lm(spec_prompt(ctx, args.n)))
        except Exception as exc:  # noqa: BLE001 - provider auth/setup can fail only when first called.
            if bootstrap_context:
                print(
                    f"warning: LM call failed during spec proposal ({exc}); "
                    "writing no-LM bootstrap skeleton instead",
                    file=sys.stderr,
                )
                return generate_no_lm_skeletons(
                    ctx,
                    args,
                    out_dir,
                    config,
                    reason=f"LM call failed during spec proposal: {exc}",
                )
            print(f"error: LM call failed during spec proposal: {exc}", file=sys.stderr)
            print(
                "next: set the requested provider key, pass --api-key-env with a populated variable, "
                "use --no-lm-skeleton for bootstrap starter artifacts, "
                "or use --validate-only/--promote for already-generated candidates",
                file=sys.stderr,
            )
            return 2
        if not isinstance(raw_specs, list) or not raw_specs:
            print("error: spec-proposal LM call returned no parseable JSON array", file=sys.stderr)
            return 2
        specs = [s for s in raw_specs if isinstance(s, dict)][: args.n]
    for spec in specs:
        spec.setdefault("expected_status", "pass")

    results = []
    for i, spec in enumerate(specs, start=1):
        label = spec.get("slug") or f"spec-{i}"
        print(f"\n=== [{i}/{len(specs)}] {label}", file=sys.stderr)
        attempt_payload: str | None = None
        violations: list[str] = []
        record: dict = {"spec": spec, "case_dir": None, "rounds": [], "ok": False}
        for round_no in range(args.max_repair_rounds + 1):
            try:
                raw = lm(materialize_prompt(ctx, spec, attempt_payload, violations))
            except Exception as exc:  # noqa: BLE001 - provider auth/setup can fail only when first called.
                if bootstrap_context:
                    print(
                        f"warning: LM call failed during case materialization ({exc}); "
                        "writing no-LM bootstrap skeleton instead",
                        file=sys.stderr,
                    )
                    return generate_no_lm_skeletons(
                        ctx,
                        args,
                        out_dir,
                        config,
                        reason=f"LM call failed during case materialization: {exc}",
                    )
                print(f"error: LM call failed during case materialization: {exc}", file=sys.stderr)
                print(
                    "next: set the requested provider key, pass --api-key-env with a populated variable, "
                    "use --no-lm-skeleton for bootstrap starter artifacts, "
                    "or use --validate-only/--promote for already-generated candidates",
                    file=sys.stderr,
                )
                return 2
            payload = extract_json(raw)
            attempt_payload = json.dumps(payload, indent=2) if payload is not None else raw
            case_dir, problems = write_candidate(out_dir / "candidates", payload)
            if case_dir is None:
                violations = problems
            else:
                record["case_dir"] = str(case_dir)
                violations, info = gate_candidate(ctx, case_dir, args.validator_timeout)
                record["replay_status"] = info["replay_status"]
            record["rounds"].append({"round": round_no, "violations": violations})
            print(f"  round {round_no}: {'CLEAN' if not violations else f'{len(violations)} violation(s)'}", file=sys.stderr)
            if not violations:
                record["ok"] = True
                break
        results.append(record)

    survivors = [r for r in results if r["ok"]]
    report = {
        "schema_version": "case-generation.v1",
        "skill": skill,
        "skill_source": skill_resolution["skill_source"],
        "skill_imported": skill_resolution["skill_imported"],
        "skill_import_reused": skill_resolution["skill_import_reused"],
        "imported_skill_dir": skill_resolution["imported_skill_dir"],
        "synthetic_laguna_bootstrap": synthetic_laguna_bootstrap,
        "out_dir": str(out_dir),
        "n_specs": len(specs),
        "n_survivors": len(survivors),
        "results": results,
        "promote_hint": [
            f"uv run harness/generate/gen_eval_cases.py --skill {skill} --promote {r['case_dir']}"
            for r in survivors
        ],
        "reminder": "candidates are quarantined; review each case BEFORE promoting — "
                    "the eval corpus is the grader and stays human-curated",
    }
    (out_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if survivors else 1


if __name__ == "__main__":
    sys.exit(main())
