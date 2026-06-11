#!/usr/bin/env python3
"""Frozen-paths gate for the skill-optimization track.

A candidate skill payload may change ONLY the prose/reference surface of a
skill: SKILL.md, references/, and non-validator scripts (preprocessors).
Everything grading depends on is frozen: eval cases + golds (evals/), output
schemas (schemas/), and executable validators (scripts/validate_*.ts).

The harness already grades against the canonical repo regardless of
--skills-root (cases, golds, and validator.command resolve from REPO_ROOT —
harness/runner/matrix.py + run_eval.py), so a tampered copy cannot change
scores. This gate exists so a tampered copy cannot even reach an agent's
workspace payload, a lineage record, or a human review queue unnoticed.

Checks, for skills/<skill> under --candidate-root vs the canonical skills/:
- every canonical file under evals/ and schemas/, and every
  scripts/validate_*.ts, exists in the candidate with byte-identical content;
- the candidate adds no files under those frozen surfaces;
- the candidate adds no unexpected top-level entries
  (allowed: SKILL.md, schemas/, scripts/, references/, evals/);
- SKILL.md exists in the candidate.

Usage:

    uv run harness/optimize/frozen_paths_gate.py \
        --skill ci-log-reducer --candidate-root /tmp/candidate/skills

Output: one frozen-paths-gate.v1 JSON object on stdout.
Exit codes: 0 clean, 1 violations, 2 usage/configuration error.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ALLOWED_TOP_LEVEL = {"SKILL.md", "schemas", "scripts", "references", "evals"}
SKIP_NAMES = {".DS_Store"}


def frozen_relpaths(skill_dir: Path) -> set[Path]:
    """Relative paths of all grading-critical files inside a skill dir.

    NOTE: gold artifacts live under dot-directories (expected/.laguna/...),
    so only SKIP_NAMES is filtered — never dotfiles wholesale.
    """
    rels: set[Path] = set()
    for sub in ("evals", "schemas"):
        root = skill_dir / sub
        if root.is_dir():
            rels.update(
                p.relative_to(skill_dir)
                for p in root.rglob("*")
                if p.is_file() and p.name not in SKIP_NAMES
            )
    scripts = skill_dir / "scripts"
    if scripts.is_dir():
        rels.update(
            p.relative_to(skill_dir)
            for p in scripts.rglob("validate_*.ts")
            if p.is_file()
        )
    return rels


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify a candidate skill payload left frozen surfaces untouched.")
    parser.add_argument("--skill", required=True, help="skill name (directory under the skills roots)")
    parser.add_argument("--candidate-root", required=True, help="candidate skills root containing <skill>/")
    parser.add_argument("--canonical-root", default=str(REPO_ROOT / "skills"), help="canonical skills root (default: repo skills/)")
    args = parser.parse_args()

    canonical = Path(args.canonical_root).resolve() / args.skill
    candidate = Path(args.candidate_root).resolve() / args.skill
    if not canonical.is_dir():
        print(json.dumps({
            "schema_version": "frozen-paths-gate.v1",
            "ok": False,
            "fatal": f"canonical skill not found: {canonical}",
        }))
        return 2

    violations: list[dict] = []
    canon_frozen = frozen_relpaths(canonical)

    if not candidate.is_dir():
        violations.append({
            "path": str(candidate),
            "kind": "candidate-missing",
            "detail": "candidate skill directory does not exist",
        })
    else:
        for rel in sorted(canon_frozen):
            cand_file = candidate / rel
            if not cand_file.is_file():
                violations.append({
                    "path": str(rel),
                    "kind": "frozen-file-missing",
                    "detail": "frozen file missing from candidate payload",
                })
            elif cand_file.read_bytes() != (canonical / rel).read_bytes():
                violations.append({
                    "path": str(rel),
                    "kind": "frozen-file-modified",
                    "detail": "candidate content differs from canonical frozen content",
                })
        for rel in sorted(frozen_relpaths(candidate) - canon_frozen):
            violations.append({
                "path": str(rel),
                "kind": "frozen-file-added",
                "detail": "candidate adds a file under a frozen surface (evals/, schemas/, scripts/validate_*)",
            })
        canon_top = {p.name for p in canonical.iterdir() if p.name not in SKIP_NAMES}
        for entry in sorted(p.name for p in candidate.iterdir() if p.name not in SKIP_NAMES):
            if entry not in canon_top and entry not in ALLOWED_TOP_LEVEL:
                violations.append({
                    "path": entry,
                    "kind": "unexpected-top-level-entry",
                    "detail": f"allowed top-level entries: {sorted(ALLOWED_TOP_LEVEL)}",
                })
        if not (candidate / "SKILL.md").is_file():
            violations.append({
                "path": "SKILL.md",
                "kind": "skill-md-missing",
                "detail": "candidate payload must ship SKILL.md",
            })

    result = {
        "schema_version": "frozen-paths-gate.v1",
        "skill": args.skill,
        "candidate_root": str(Path(args.candidate_root).resolve()),
        "n_frozen_files": len(canon_frozen),
        "ok": not violations,
        "violations": violations,
    }
    print(json.dumps(result, indent=2))
    return 0 if not violations else 1


if __name__ == "__main__":
    sys.exit(main())
