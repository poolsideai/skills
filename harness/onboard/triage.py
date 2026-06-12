#!/usr/bin/env python3
"""Triage foreign skill directories for onboarding.

This is the no-LM/no-pool phase of onboarding. It inspects one SKILL.md folder
or a directory of SKILL.md folders, writes a report under runs/onboard/, and
does not copy or synthesize validators, schemas, or eval cases.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from checklib import (  # noqa: E402
    COMPATIBILITY_MAX_CHARS,
    DESCRIPTION_MAX_CHARS,
    SEMVER_RE,
    SKILL_NAME_RE,
    split_frontmatter,
)

RUNS_ONBOARD = REPO_ROOT / "runs" / "onboard"
AUTHORING_SECTIONS = [
    "Purpose",
    "Use when",
    "Do not use when",
    "Inputs",
    "Procedure",
    "Output contract",
    "Validation",
    "Repair",
    "Escalation",
    "Examples",
]
ALLOWED_TOP_LEVEL = {"SKILL.md", "schemas", "scripts", "references", "evals"}
ARTIFACT_RE = re.compile(r"(?:^|[`\s(])((?:\.laguna|laguna|outputs?)/[A-Za-z0-9._/-]+\.json|\.[A-Za-z0-9._/-]+\.json)")
SCHEMA_REF_RE = re.compile(r"schemas/[A-Za-z0-9._/-]+\.schema\.json")


@dataclass
class FrontmatterResult:
    ok: bool
    name: str | None
    description_present: bool
    version: str | None
    compatibility_present: bool
    violations: list[dict[str, str]]


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%SZ")


def resolve_out_dir(value: str | None) -> Path:
    if value:
        candidate = Path(value)
        if not candidate.is_absolute():
            candidate = REPO_ROOT / candidate
    else:
        candidate = RUNS_ONBOARD / utc_stamp()
    resolved = candidate.resolve()
    allowed = RUNS_ONBOARD.resolve()
    if resolved != allowed and allowed not in resolved.parents:
        raise SystemExit(f"--out-dir must be under {RUNS_ONBOARD}")
    return resolved


def rel_to_repo(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def discover_skill_dirs(source: Path) -> list[Path]:
    if (source / "SKILL.md").is_file():
        return [source]
    if not source.is_dir():
        raise SystemExit(f"source is not a directory: {source}")
    return sorted(
        child
        for child in source.iterdir()
        if child.is_dir() and not child.name.startswith(".") and (child / "SKILL.md").is_file()
    )


def violation(check: str, message: str) -> dict[str, str]:
    return {"check": check, "message": message}


def parse_frontmatter(skill_dir: Path, skill_md: Path, text: str) -> tuple[FrontmatterResult, str, dict[str, Any] | None]:
    parts = split_frontmatter(text)
    violations: list[dict[str, str]] = []
    if parts is None:
        violations.append(
            violation("frontmatter-fenced", "SKILL.md must open with a fenced YAML frontmatter block"),
        )
        return FrontmatterResult(False, None, False, None, False, violations), text, None

    yaml_text, body = parts
    try:
        parsed = yaml.safe_load(yaml_text)
    except yaml.YAMLError as exc:
        violations.append(violation("frontmatter-parse", f"frontmatter is not valid YAML: {exc}"))
        return FrontmatterResult(False, None, False, None, False, violations), body, None
    if not isinstance(parsed, dict):
        violations.append(violation("frontmatter-parse", f"frontmatter must be a mapping, got {type(parsed).__name__}"))
        return FrontmatterResult(False, None, False, None, False, violations), body, None

    name = parsed.get("name")
    if not isinstance(name, str) or not name:
        violations.append(violation("frontmatter-name", "frontmatter `name` is required and must be a string"))
        name = None
    else:
        if not SKILL_NAME_RE.fullmatch(name):
            violations.append(violation("frontmatter-name-regex", f"name {name!r} is not kebab-case"))
        if name != skill_dir.name:
            violations.append(violation("frontmatter-name-matches-dir", f"name {name!r} must equal directory {skill_dir.name!r}"))

    description = parsed.get("description")
    description_present = isinstance(description, str) and bool(description.strip())
    if not description_present:
        violations.append(violation("frontmatter-description", "frontmatter `description` is required"))
    elif len(description) > DESCRIPTION_MAX_CHARS:
        violations.append(violation("frontmatter-description-length", f"description exceeds {DESCRIPTION_MAX_CHARS} chars"))

    metadata = parsed.get("metadata")
    version = metadata.get("version") if isinstance(metadata, dict) else None
    if not isinstance(version, str) or not version:
        violations.append(violation("frontmatter-version", "frontmatter `metadata.version` is required"))
        version = None
    elif not SEMVER_RE.fullmatch(version):
        violations.append(violation("frontmatter-version-semver", f"metadata.version {version!r} is not semver"))

    if "allowed-tools" in parsed:
        violations.append(violation("frontmatter-allowed-tools", "allowed-tools is unsupported by pool"))

    compatibility = parsed.get("compatibility")
    compatibility_present = compatibility is not None
    if compatibility is not None:
        if not isinstance(compatibility, str):
            violations.append(violation("frontmatter-compatibility", "compatibility must be a string"))
        elif len(compatibility) > COMPATIBILITY_MAX_CHARS:
            violations.append(violation("frontmatter-compatibility-length", f"compatibility exceeds {COMPATIBILITY_MAX_CHARS} chars"))

    return (
        FrontmatterResult(
            ok=len(violations) == 0,
            name=name,
            description_present=description_present,
            version=version,
            compatibility_present=compatibility_present,
            violations=violations,
        ),
        body,
        parsed,
    )


def headings(body: str) -> list[str]:
    found: list[str] = []
    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            found.append(stripped.lstrip("#").strip())
    return found


def has_non_goals(found_headings: list[str]) -> bool:
    lowered = [heading.lower() for heading in found_headings]
    return any("do not use when" in heading or "non-goals" in heading or "non goals" in heading for heading in lowered)


def section_missing(found_headings: list[str]) -> list[str]:
    lowered = [heading.lower() for heading in found_headings]
    missing: list[str] = []
    for section in AUTHORING_SECTIONS:
        needle = section.lower()
        if section == "Do not use when":
            if not has_non_goals(found_headings):
                missing.append(section)
            continue
        if not any(needle in heading for heading in lowered):
            missing.append(section)
    return missing


def sorted_rel(paths: list[Path], base: Path) -> list[str]:
    return sorted(str(path.relative_to(base)) for path in paths)


def infer_output_contract(body: str) -> dict[str, Any]:
    lines = body.splitlines()
    output_lines: list[str] = []
    in_output = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#"):
            heading = stripped.lstrip("#").strip().lower()
            in_output = "output contract" in heading or heading == "outputs" or heading == "output"
            continue
        if in_output:
            output_lines.append(line)

    output_text = "\n".join(output_lines)
    body_text = body
    artifacts = sorted(set(match.group(1).strip("`,)") for match in ARTIFACT_RE.finditer(output_text)))
    schema_refs = sorted(set(SCHEMA_REF_RE.findall(output_text)))
    body_artifacts = sorted(set(match.group(1).strip("`,)") for match in ARTIFACT_RE.finditer(body_text)))
    body_schema_refs = sorted(set(SCHEMA_REF_RE.findall(body_text)))

    evidence: list[str] = []
    if artifacts:
        evidence.append("output-contract-artifact-path")
    if schema_refs:
        evidence.append("output-contract-schema-ref")
    if not artifacts and body_artifacts:
        evidence.append("body-artifact-path")
    if not schema_refs and body_schema_refs:
        evidence.append("body-schema-ref")

    if artifacts:
        status = "present"
    elif body_artifacts or schema_refs or body_schema_refs:
        status = "implied"
    else:
        status = "missing"

    return {
        "status": status,
        "artifact_paths": artifacts or body_artifacts,
        "schema_refs": schema_refs or body_schema_refs,
        "evidence": evidence,
    }


def triage_skill(skill_dir: Path, source_root: Path) -> dict[str, Any]:
    skill_md = skill_dir / "SKILL.md"
    try:
        text = skill_md.read_text(encoding="utf-8")
    except OSError as exc:
        text = ""
        frontmatter = FrontmatterResult(False, None, False, None, False, [violation("skill-md-readable", str(exc))])
        body = ""
    else:
        frontmatter, body, _parsed = parse_frontmatter(skill_dir, skill_md, text)

    found_headings = headings(body)
    schemas_dir = skill_dir / "schemas"
    scripts_dir = skill_dir / "scripts"
    evals_dir = skill_dir / "evals"
    schemas = sorted(schemas_dir.glob("*.schema.json")) if schemas_dir.is_dir() else []
    validators = sorted(scripts_dir.glob("validate_*.ts")) if scripts_dir.is_dir() else []
    eval_cases = sorted(p for p in evals_dir.iterdir() if p.is_dir()) if evals_dir.is_dir() else []
    extra_top_level = sorted(child.name for child in skill_dir.iterdir() if child.name not in ALLOWED_TOP_LEVEL and not child.name.startswith("."))
    output_contract = infer_output_contract(body)

    missing_sections = section_missing(found_headings)
    if not has_non_goals(found_headings) and not any(v["check"] == "skill-non-goals-section" for v in frontmatter.violations):
        frontmatter.violations.append(violation("skill-non-goals-section", "missing Do not use when / non-goals section"))
        frontmatter.ok = False

    recommendations: list[str] = []
    if output_contract["status"] == "missing":
        recommendations.append("Define a deterministic output artifact path in the Output contract.")
    if not schemas:
        recommendations.append("Add schemas/*.schema.json before prose is considered merge-ready.")
    if not validators:
        recommendations.append("Add scripts/validate_*.ts; triage will not synthesize a validator.")
    if len(eval_cases) < 3:
        recommendations.append("Add at least three eval cases, including one adversarial case.")
    if missing_sections:
        recommendations.append(f"Fill authoring-template sections: {', '.join(missing_sections)}.")

    has_contract_bits = bool(schemas or validators or output_contract["status"] != "missing")
    ready = frontmatter.ok and bool(schemas) and bool(validators) and output_contract["status"] == "present"
    if ready:
        verdict = "ready"
    elif has_contract_bits:
        verdict = "needs-contract"
    else:
        verdict = "advice-only"
        recommendations.append("Treat as advice-only until a gradeable artifact and validator are designed.")


    return {
        "name": frontmatter.name or skill_dir.name,
        "path": rel_to_repo(skill_dir) if REPO_ROOT in skill_dir.resolve().parents else str(skill_dir),
        "source_relative_path": str(skill_dir.relative_to(source_root)) if source_root in skill_dir.parents or skill_dir == source_root else skill_dir.name,
        "verdict": verdict,
        "frontmatter": frontmatter.__dict__,
        "structure": {
            "has_skill_md": skill_md.is_file(),
            "has_schemas": schemas_dir.is_dir(),
            "schemas": sorted_rel(schemas, skill_dir),
            "has_validators": scripts_dir.is_dir(),
            "validators": sorted_rel(validators, skill_dir),
            "has_evals": evals_dir.is_dir(),
            "eval_case_count": len(eval_cases),
            "missing_sections": missing_sections,
            "extra_top_level": extra_top_level,
        },
        "output_contract": output_contract,
        "recommendations": recommendations,
    }


def build_report(source: Path, out_dir: Path) -> dict[str, Any]:
    source = source.resolve()
    skill_dirs = discover_skill_dirs(source)
    skills = [triage_skill(skill_dir.resolve(), source) for skill_dir in skill_dirs]
    counts = {
        "skills": len(skills),
        "ready": sum(1 for skill in skills if skill["verdict"] == "ready"),
        "needs_contract": sum(1 for skill in skills if skill["verdict"] == "needs-contract"),
        "advice_only": sum(1 for skill in skills if skill["verdict"] == "advice-only"),
    }
    return {
        "schema_version": "onboard-triage.v1",
        "source": str(source),
        "out_dir": rel_to_repo(out_dir),
        "counts": counts,
        "skills": skills,
    }


def render_human(report: dict[str, Any], report_path: Path) -> str:
    lines = [f"onboard triage: {report['source']}", f"report: {rel_to_repo(report_path)}", ""]
    for skill in report["skills"]:
        contract = skill["output_contract"]
        artifacts = ", ".join(contract["artifact_paths"]) or "no deterministic artifact"
        validators = ", ".join(skill["structure"]["validators"]) or "no validator"
        lines.append(f"{skill['verdict']:<14} {skill['name']:<32} {artifacts}; {validators}")
        if skill["recommendations"]:
            lines.append(f"  next: {skill['recommendations'][0]}")
    counts = report["counts"]
    lines.extend([
        "",
        f"summary: {counts['skills']} skill(s), {counts['ready']} ready, {counts['needs_contract']} needs-contract, {counts['advice_only']} advice-only",
    ])
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="Skill dir or directory containing skill dirs")
    parser.add_argument("--out-dir", help="Report directory under runs/onboard/")
    parser.add_argument("--json", action="store_true", help="Emit onboard-triage.v1 JSON only")
    ns = parser.parse_args(argv)

    out_dir = resolve_out_dir(ns.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    report = build_report(Path(ns.source), out_dir)
    report_path = out_dir / "report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    if ns.json:
        print(json.dumps(report, indent=2))
    else:
        print(render_human(report, report_path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
