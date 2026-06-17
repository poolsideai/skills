from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from harness.validators.json_schema import validate_instance


REPO_ROOT = Path(__file__).resolve().parents[1]
GEN_EVAL_CASES = REPO_ROOT / "harness" / "generate" / "gen_eval_cases.py"
VALID_CASE = REPO_ROOT / "skills" / "ci-log-reducer" / "evals" / "ci-log-reducer-pytest-single-failure"
RESULT_SCHEMA = "case-generation-result.v1"


class GenEvalCasesCliContractTests(unittest.TestCase):
    def run_generator(self, *args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["uv", "run", str(GEN_EVAL_CASES), *args],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            check=False,
            env=env,
        )

    def make_workspace_inventory_candidate(
        self,
        parent: Path,
        *,
        case_id: str = "workspace-inventory-bootstrap-unit-test",
        readme_text: str = "# Sample\n",
        src_file_name: str = "main.ts",
        src_file_text: str = "export const ok = true;\n",
        bucket: str = "easy",
    ) -> Path:
        case_dir = parent / case_id
        (case_dir / "input" / "src").mkdir(parents=True)
        (case_dir / "expected" / ".laguna").mkdir(parents=True)
        (case_dir / "input" / "README.md").write_text(readme_text, encoding="utf-8")
        (case_dir / "input" / "src" / src_file_name).write_text(src_file_text, encoding="utf-8")
        (case_dir / "prompt.md").write_text(
            "Inspect the workspace and write `.laguna/workspace-inventory.json`.\n",
            encoding="utf-8",
        )
        (case_dir / "metadata.json").write_text(
            json.dumps(
                {
                    "id": case_id,
                    "skill": "workspace-inventory",
                    "bucket": bucket,
                    "difficulty": "easy",
                    "arms": ["xs_with_skill"],
                    "publishability": "internal",
                    "validator": {
                        "command": ["bun", "skills/workspace-inventory/scripts/validate_workspace_inventory.ts"],
                        "expected_status": "pass",
                    },
                    "notes": "Synthetic fixture; no customer data. Generated case.",
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        (case_dir / "expected" / ".laguna" / "workspace-inventory.json").write_text(
            json.dumps(
                {
                    "schema_version": "workspace-inventory.v1",
                    "total_files": 2,
                    "entries": [
                        {"name": "README.md", "kind": "file"},
                        {"name": "src", "kind": "directory", "file_count": 1},
                    ],
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        return case_dir

    def make_zero_case_bootstrap_skill(self, skill: str, parent: Path | None = None) -> Path:
        skill_dir = (parent or REPO_ROOT / "skills") / skill
        self.assertFalse(skill_dir.exists(), f"refusing to delete pre-existing fixture: {skill_dir}")
        (skill_dir / "schemas").mkdir(parents=True)
        (skill_dir / "scripts").mkdir(parents=True)
        (skill_dir / "references").mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            f"""---
name: {skill}
description: Tiny temporary bootstrap test skill.
metadata:
  version: "0.1.0"
---

# Zero Case Bootstrap Test

## Purpose

Exercise eval-case generation bootstrap behavior in tests.

## Do not use when

Do not use outside the generator CLI contract test.

## Output contract

Write `.laguna/zero-case-bootstrap.json` with:

- `schema_version`: `"zero-case-bootstrap.v1"`
- `ok`: `true`
""",
            encoding="utf-8",
        )
        (skill_dir / "schemas" / "zero-case-bootstrap.schema.json").write_text(
            json.dumps(
                {
                    "$schema": "https://json-schema.org/draft/2020-12/schema",
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["schema_version", "ok"],
                    "properties": {
                        "schema_version": {"const": "zero-case-bootstrap.v1"},
                        "ok": {"const": True},
                    },
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        (skill_dir / "references" / "guide.md").write_text(
            "# Bootstrap Guide\n\nSupporting skill files must be imported with the skill directory.\n",
            encoding="utf-8",
        )
        (skill_dir / "scripts" / "validate_zero_case_bootstrap.ts").write_text(
            """#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const valueAfter = (flag: string): string | null => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] ?? null;
};

const workspace = valueAfter("--workspace") ?? ".";
const out = valueAfter("--out");
if (!out) throw new Error("missing --out");

let status: "pass" | "fail" = "fail";
let detail = "artifact missing or invalid";
try {
  const artifact = JSON.parse(readFileSync(join(workspace, ".laguna", "zero-case-bootstrap.json"), "utf8"));
  if (artifact.schema_version === "zero-case-bootstrap.v1" && artifact.ok === true) {
    status = "pass";
    detail = "artifact matches expected bootstrap contract";
  }
} catch {
  // fall through to fail result
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({
  schema_version: "validator-result.v1",
  case_id: "zero-case-bootstrap",
  status,
  score: status === "pass" ? 1 : 0,
  checks: [{ id: "artifact-valid", status, detail }],
  repair_feedback: status === "pass" ? [] : [detail],
  duration_ms: 0,
}, null, 2) + "\\n");
""",
            encoding="utf-8",
        )
        return skill_dir

    def make_zero_case_bootstrap_candidate(self, parent: Path, skill: str, case_id: str | None = None) -> Path:
        case_id = case_id or f"{skill}-first-case"
        case_dir = parent / case_id
        (case_dir / "input").mkdir(parents=True)
        (case_dir / "expected" / ".laguna").mkdir(parents=True)
        (case_dir / "prompt.md").write_text(
            "Write `.laguna/zero-case-bootstrap.json` for the bootstrap test.\n",
            encoding="utf-8",
        )
        (case_dir / "metadata.json").write_text(
            json.dumps(
                {
                    "id": case_id,
                    "skill": skill,
                    "bucket": "easy",
                    "difficulty": "easy",
                    "arms": ["xs_with_skill"],
                    "publishability": "internal",
                    "validator": {
                        "command": ["bun", f"skills/{skill}/scripts/validate_zero_case_bootstrap.ts"],
                        "expected_status": "pass",
                    },
                    "notes": "Synthetic bootstrap fixture for generator CLI contract tests.",
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        (case_dir / "expected" / ".laguna" / "zero-case-bootstrap.json").write_text(
            json.dumps({"schema_version": "zero-case-bootstrap.v1", "ok": True}, indent=2) + "\n",
            encoding="utf-8",
        )
        return case_dir

    def make_prompt_style_external_skill(self, parent: Path, skill: str) -> Path:
        skill_dir = parent / skill
        self.assertFalse(skill_dir.exists(), f"refusing to delete pre-existing fixture: {skill_dir}")
        (skill_dir / ".beads").mkdir(parents=True)
        (skill_dir / "agent_ergonomics_audit" / "audit").mkdir(parents=True)
        (skill_dir / "references").mkdir(parents=True)
        (skill_dir / "scripts").mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            f"""---
name: {skill}
description: Temporary prompt-style skill with support files but no Laguna validator.
metadata:
  version: "0.1.0"
---

# Prompt Style Skill

## Purpose

Exercise path import for real-world prompt-style skills.

## Do not use when

Do not use outside generator CLI contract tests.
""",
            encoding="utf-8",
        )
        (skill_dir / "references" / "guide.md").write_text(
            "# Guide\n\nThis support file must survive path import.\n",
            encoding="utf-8",
        )
        (skill_dir / ".beads" / "issues.jsonl").write_text(
            '{"id":"external-local-state","title":"must not be imported"}\n',
            encoding="utf-8",
        )
        (skill_dir / "agent_ergonomics_audit" / "audit" / "HANDOFF.md").write_text(
            "# External audit state\n\nMust not be imported with the skill contract.\n",
            encoding="utf-8",
        )
        (skill_dir / "scripts" / "helper.mjs").write_text(
            "console.log('helper script');\n",
            encoding="utf-8",
        )
        return skill_dir

    def make_prompt_style_external_skill_without_repo_authoring_fields(self, parent: Path, skill: str) -> Path:
        skill_dir = parent / skill
        self.assertFalse(skill_dir.exists(), f"refusing to delete pre-existing fixture: {skill_dir}")
        (skill_dir / "references").mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            f"""---
name: {skill}
description: Temporary prompt-style skill missing repo-only Laguna authoring fields.
argument-hint: "[task]"
---

# Prompt Style Skill

## Purpose

Exercise import normalization for prompt-style skills that are valid platform skills
but do not yet satisfy this repo's GEPA/structure gates.
""",
            encoding="utf-8",
        )
        (skill_dir / "references" / "guide.md").write_text(
            "# Guide\n\nThis support file must survive path import.\n",
            encoding="utf-8",
        )
        return skill_dir

    def make_synthetic_laguna_candidate(self, parent: Path, skill: str, case_id: str | None = None) -> Path:
        case_id = case_id or f"{skill}-synthetic-bootstrap-case"
        case_dir = parent / case_id
        artifact_rel = Path(".laguna") / f"{skill}.json"
        (case_dir / "input").mkdir(parents=True)
        (case_dir / "expected" / artifact_rel.parent).mkdir(parents=True)
        (case_dir / "prompt.md").write_text(
            f"Complete the task and write `{artifact_rel.as_posix()}` with summary and evidence.\n",
            encoding="utf-8",
        )
        (case_dir / "metadata.json").write_text(
            json.dumps(
                {
                    "id": case_id,
                    "skill": skill,
                    "bucket": "easy",
                    "difficulty": "easy",
                    "arms": ["xs_with_skill"],
                    "publishability": "internal",
                    "validator": {
                        "command": [
                            "bun",
                            f"skills/{skill}/scripts/validate_{skill.replace('-', '_')}_synthetic_bootstrap.ts",
                        ],
                        "expected_status": "pass",
                    },
                    "notes": "Synthetic bootstrap fixture for prompt-style skill import tests.",
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        (case_dir / "expected" / artifact_rel).write_text(
            json.dumps(
                {
                    "schema_version": f"{skill}.synthetic-bootstrap.v1",
                    "summary": "Documented the requested behavior from local evidence.",
                    "evidence": ["SKILL.md", "references/guide.md"],
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        return case_dir

    def parse_json_objects(self, stdout: str) -> list[dict]:
        decoder = json.JSONDecoder()
        idx = 0
        objects = []
        while idx < len(stdout):
            while idx < len(stdout) and stdout[idx].isspace():
                idx += 1
            if idx >= len(stdout):
                break
            obj, idx = decoder.raw_decode(stdout, idx)
            self.assertIsInstance(obj, dict)
            objects.append(obj)
        return objects

    def test_case_generation_result_schema_is_available_as_common_contract(self) -> None:
        schema_path = REPO_ROOT / "schemas" / "common" / "case-generation-result.v1.schema.json"
        self.assertTrue(schema_path.is_file())
        errors = validate_instance(
            {
                "schema_version": "case-generation-result.v1",
                "operation": "validate-only",
                "case_id": "example",
                "case_dir": "/tmp/example",
                "ok": False,
                "violations": ["example violation"],
            },
            RESULT_SCHEMA,
        )
        self.assertEqual(errors, [], errors)

    def test_validate_only_result_has_stable_schema_version(self) -> None:
        result = self.run_generator("--skill", "ci-log-reducer", "--validate-only", str(VALID_CASE))

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stderr, "")
        payload = json.loads(result.stdout)
        errors = validate_instance(payload, RESULT_SCHEMA)
        self.assertEqual(errors, [], errors)
        self.assertEqual(payload["schema_version"], "case-generation-result.v1")
        self.assertEqual(payload["operation"], "validate-only")
        self.assertEqual(payload["case_id"], VALID_CASE.name)
        self.assertNotIn("counts", payload)
        self.assertNotIn("results", payload)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["violations"], [])

    def test_validate_only_multiple_cases_emit_one_aggregate_json_document(self) -> None:
        case_a = VALID_CASE
        case_b = REPO_ROOT / "skills" / "ci-log-reducer" / "evals" / "ci-log-reducer-bun-flaky-retry"
        result = self.run_generator("--skill", "ci-log-reducer", "--validate-only", str(case_a), str(case_b))

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stderr, "")
        payloads = self.parse_json_objects(result.stdout)
        self.assertEqual(len(payloads), 1, "multi-case validate-only must emit exactly one JSON document")
        payload = json.loads(result.stdout)
        self.assertEqual(payloads[0], payload)
        errors = validate_instance(payload, RESULT_SCHEMA)
        self.assertEqual(errors, [], errors)
        self.assertEqual(
            set(payload),
            {"schema_version", "operation", "case_id", "case_dir", "ok", "violations", "counts", "results"},
        )
        self.assertEqual(payload["schema_version"], "case-generation-result.v1")
        self.assertEqual(payload["operation"], "validate-only")
        self.assertEqual(payload["case_id"], "aggregate")
        self.assertEqual(payload["case_dir"], "aggregate")
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["violations"], [])
        self.assertEqual(payload["counts"], {"cases": 2, "ok": 2, "failed": 0})
        self.assertEqual(len(payload["results"]), 2)
        self.assertEqual([entry["case_id"] for entry in payload["results"]], [case_a.name, case_b.name])
        for entry, case_dir in zip(payload["results"], [case_a, case_b], strict=True):
            self.assertEqual(entry["schema_version"], "case-generation-result.v1")
            self.assertEqual(entry["operation"], "validate-only")
            self.assertEqual(entry["case_id"], case_dir.name)
            self.assertEqual(entry["case_dir"], str(case_dir))
            self.assertTrue(entry["ok"])
            self.assertEqual(entry["violations"], [])
            self.assertNotIn("counts", entry)
            self.assertNotIn("results", entry)

    def test_validate_only_multiple_cases_aggregates_missing_case_failure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            missing_case = Path(tmp) / "ci-log-reducer-missing-case"
            result = self.run_generator(
                "--skill",
                "ci-log-reducer",
                "--validate-only",
                str(VALID_CASE),
                str(missing_case),
            )

        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertEqual(result.stderr, "")
        payloads = self.parse_json_objects(result.stdout)
        self.assertEqual(len(payloads), 1, "multi-case validate-only failures must emit one aggregate JSON document")
        payload = json.loads(result.stdout)
        self.assertEqual(payloads[0], payload)
        errors = validate_instance(payload, RESULT_SCHEMA)
        self.assertEqual(errors, [], errors)
        self.assertEqual(
            set(payload),
            {"schema_version", "operation", "case_id", "case_dir", "ok", "violations", "counts", "results"},
        )
        self.assertEqual(payload["schema_version"], "case-generation-result.v1")
        self.assertEqual(payload["operation"], "validate-only")
        self.assertEqual(payload["case_id"], "aggregate")
        self.assertEqual(payload["case_dir"], "aggregate")
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["counts"]["cases"], 2)
        self.assertEqual(payload["counts"]["ok"], 1)
        self.assertEqual(payload["counts"]["failed"], 1)
        self.assertEqual(len(payload["results"]), 2)
        self.assertEqual([entry["case_id"] for entry in payload["results"]], [VALID_CASE.name, missing_case.name])
        passing_results = [entry for entry in payload["results"] if entry["ok"]]
        self.assertEqual(len(passing_results), 1)
        self.assertEqual(passing_results[0]["case_id"], VALID_CASE.name)
        self.assertEqual(passing_results[0]["violations"], [])
        failing_results = [entry for entry in payload["results"] if not entry["ok"]]
        self.assertEqual(len(failing_results), 1)
        failing = failing_results[0]
        self.assertEqual(failing["case_id"], missing_case.name)
        self.assertEqual(failing["case_dir"], str(missing_case))
        self.assertGreater(len(failing["violations"]), 0)
        self.assertGreater(len(payload["violations"]), 0)
        for violation in payload["violations"]:
            self.assertTrue(
                violation.startswith(f"{missing_case.name}: "),
                f"top-level violation lacks failing case_id prefix: {violation}",
            )

    def test_argument_shape_errors_are_reported_before_skill_context_loading(self) -> None:
        result = self.run_generator(
            "--skill",
            "__missing_skill__",
            "--validate-only",
            "__missing_case__",
            "--promote",
            "__missing_candidate__",
        )

        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertIn("--validate-only and --promote are mutually exclusive", result.stderr)
        self.assertNotIn("no such skill", result.stderr)

    def test_invalid_numeric_args_fail_before_generation(self) -> None:
        result = self.run_generator("--skill", "ci-log-reducer", "--n", "0", "--spec", "simple case")

        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertIn("--n must be at least 1", result.stderr)

    def test_validate_only_infers_bootstrap_for_zero_case_skill(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            case_dir = self.make_workspace_inventory_candidate(Path(tmp))
            result = self.run_generator("--skill", "workspace-inventory", "--validate-only", str(case_dir))

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertNotIn("no loadable eval cases", result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        errors = validate_instance(payload, RESULT_SCHEMA)
        self.assertEqual(errors, [], errors)
        self.assertEqual(payload["schema_version"], "case-generation-result.v1")
        self.assertEqual(payload["operation"], "validate-only")
        self.assertEqual(payload["case_id"], "workspace-inventory-bootstrap-unit-test")
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["violations"], [])

    def test_promote_infers_bootstrap_and_defers_corpus_minimum(self) -> None:
        case_id = "workspace-inventory-bootstrap-unit-test"
        dest = REPO_ROOT / "skills" / "workspace-inventory" / "evals" / case_id
        suite_path = REPO_ROOT / "evals" / "suites" / "skill-workspace-inventory.json"
        self.assertFalse(dest.exists(), f"refusing to delete pre-existing fixture: {dest}")
        suite_original = suite_path.read_text(encoding="utf-8") if suite_path.is_file() else None

        try:
            with tempfile.TemporaryDirectory() as tmp:
                case_dir = self.make_workspace_inventory_candidate(Path(tmp))
                result = self.run_generator("--skill", "workspace-inventory", "--promote", str(case_dir))

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stderr, "")
            self.assertNotIn("skill-min-cases", result.stdout + result.stderr)
            self.assertNotIn("no loadable eval cases", result.stdout + result.stderr)
            payload = json.loads(result.stdout)
            errors = validate_instance(payload, RESULT_SCHEMA)
            self.assertEqual(errors, [], errors)
            self.assertEqual(payload["schema_version"], "case-generation-result.v1")
            self.assertEqual(payload["operation"], "promote")
            self.assertEqual(payload["case_id"], case_id)
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["violations"], [])
            self.assertEqual(payload["dest"], f"skills/workspace-inventory/evals/{case_id}")
            self.assertEqual(payload["suite"], "evals/suites/skill-workspace-inventory.json")
            self.assertTrue(dest.is_dir())
            suite = json.loads(suite_path.read_text(encoding="utf-8"))
            self.assertIn(f"skills/workspace-inventory/evals/{case_id}", suite["cases"])
        finally:
            shutil.rmtree(dest, ignore_errors=True)
            if suite_original is None:
                suite_path.unlink(missing_ok=True)
            else:
                suite_path.write_text(suite_original, encoding="utf-8")

    def test_promote_batch_started_from_true_zero_defers_corpus_checks_for_all_candidates(self) -> None:
        case_ids = [
            "workspace-inventory-bootstrap-unit-test-a",
            "workspace-inventory-bootstrap-unit-test-b",
        ]
        dests = [REPO_ROOT / "skills" / "workspace-inventory" / "evals" / case_id for case_id in case_ids]
        suite_path = REPO_ROOT / "evals" / "suites" / "skill-workspace-inventory.json"
        for dest in dests:
            self.assertFalse(dest.exists(), f"refusing to delete pre-existing fixture: {dest}")
        suite_original = suite_path.read_text(encoding="utf-8") if suite_path.is_file() else None

        try:
            with tempfile.TemporaryDirectory() as tmp:
                tmp_path = Path(tmp)
                case_a = self.make_workspace_inventory_candidate(
                    tmp_path,
                    case_id=case_ids[0],
                    readme_text="# Sample A\n",
                    src_file_name="main-a.ts",
                    src_file_text="export const caseA = true;\n",
                )
                case_b = self.make_workspace_inventory_candidate(
                    tmp_path,
                    case_id=case_ids[1],
                    readme_text="# Sample B\n",
                    src_file_name="main-b.ts",
                    src_file_text="export const caseB = true;\n",
                )
                result = self.run_generator("--skill", "workspace-inventory", "--promote", str(case_a), str(case_b))

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stderr, "")
            self.assertNotIn("skill-min-cases", result.stdout + result.stderr)
            self.assertNotIn("skill-adversarial-case", result.stdout + result.stderr)
            self.assertNotIn("no loadable eval cases", result.stdout + result.stderr)
            payloads = self.parse_json_objects(result.stdout)
            self.assertEqual(len(payloads), 2)
            for payload, case_id in zip(payloads, case_ids, strict=True):
                errors = validate_instance(payload, RESULT_SCHEMA)
                self.assertEqual(errors, [], errors)
                self.assertEqual(payload["schema_version"], "case-generation-result.v1")
                self.assertEqual(payload["operation"], "promote")
                self.assertEqual(payload["case_id"], case_id)
                self.assertTrue(payload["ok"])
                self.assertEqual(payload["violations"], [])
                self.assertEqual(payload["dest"], f"skills/workspace-inventory/evals/{case_id}")
                self.assertEqual(payload["suite"], "evals/suites/skill-workspace-inventory.json")
            for dest in dests:
                self.assertTrue(dest.is_dir())
            suite = json.loads(suite_path.read_text(encoding="utf-8"))
            for case_id in case_ids:
                self.assertIn(f"skills/workspace-inventory/evals/{case_id}", suite["cases"])
        finally:
            for dest in dests:
                shutil.rmtree(dest, ignore_errors=True)
            if suite_original is None:
                suite_path.unlink(missing_ok=True)
            else:
                suite_path.write_text(suite_original, encoding="utf-8")

    def test_promote_batch_can_complete_existing_partial_bootstrap_corpus(self) -> None:
        case_ids = [
            "workspace-inventory-bootstrap-partial-a",
            "workspace-inventory-bootstrap-partial-b",
            "workspace-inventory-bootstrap-partial-c",
        ]
        dests = [REPO_ROOT / "skills" / "workspace-inventory" / "evals" / case_id for case_id in case_ids]
        suite_path = REPO_ROOT / "evals" / "suites" / "skill-workspace-inventory.json"
        for dest in dests:
            self.assertFalse(dest.exists(), f"refusing to delete pre-existing fixture: {dest}")
        suite_original = suite_path.read_text(encoding="utf-8") if suite_path.is_file() else None

        try:
            with tempfile.TemporaryDirectory() as tmp:
                tmp_path = Path(tmp)
                case_a = self.make_workspace_inventory_candidate(
                    tmp_path,
                    case_id=case_ids[0],
                    readme_text="# Partial A\n",
                    src_file_name="partial-a.ts",
                    src_file_text="export const partialA = true;\n",
                )
                case_b = self.make_workspace_inventory_candidate(
                    tmp_path,
                    case_id=case_ids[1],
                    readme_text="# Partial B\n",
                    src_file_name="partial-b.ts",
                    src_file_text="export const partialB = true;\n",
                )
                case_c = self.make_workspace_inventory_candidate(
                    tmp_path,
                    case_id=case_ids[2],
                    readme_text="# Partial C\n",
                    src_file_name="partial-c.ts",
                    src_file_text="export const partialC = true;\n",
                    bucket="adversarial",
                )
                first = self.run_generator("--skill", "workspace-inventory", "--promote", str(case_a))
                batch = self.run_generator("--skill", "workspace-inventory", "--promote", str(case_b), str(case_c))

            self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
            self.assertEqual(batch.returncode, 0, batch.stdout + batch.stderr)
            self.assertNotIn("skill-min-cases", batch.stdout + batch.stderr)
            self.assertNotIn("skill-adversarial-case", batch.stdout + batch.stderr)
            payloads = self.parse_json_objects(batch.stdout)
            self.assertEqual(len(payloads), 2)
            self.assertTrue(all(payload["ok"] for payload in payloads))
            self.assertIn("commit", payloads[-1]["next"])
            self.assertNotIn("add remaining bootstrap cases", payloads[-1]["next"])
            for dest in dests:
                self.assertTrue(dest.is_dir())
            suite = json.loads(suite_path.read_text(encoding="utf-8"))
            for case_id in case_ids:
                self.assertIn(f"skills/workspace-inventory/evals/{case_id}", suite["cases"])
        finally:
            for dest in dests:
                shutil.rmtree(dest, ignore_errors=True)
            if suite_original is None:
                suite_path.unlink(missing_ok=True)
            else:
                suite_path.write_text(suite_original, encoding="utf-8")

    def test_promote_rolls_back_when_existing_suite_json_is_malformed(self) -> None:
        case_id = "workspace-inventory-rollback-malformed-suite"
        dest = REPO_ROOT / "skills" / "workspace-inventory" / "evals" / case_id
        suite_path = REPO_ROOT / "evals" / "suites" / "skill-workspace-inventory.json"
        self.assertFalse(dest.exists(), f"refusing to delete pre-existing fixture: {dest}")
        suite_original = suite_path.read_text(encoding="utf-8") if suite_path.is_file() else None

        try:
            suite_path.parent.mkdir(parents=True, exist_ok=True)
            suite_path.write_text("{not json}\n", encoding="utf-8")
            with tempfile.TemporaryDirectory() as tmp:
                case_dir = self.make_workspace_inventory_candidate(Path(tmp), case_id=case_id)
                result = self.run_generator("--skill", "workspace-inventory", "--promote", str(case_dir))

            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stderr, "")
            payload = json.loads(result.stdout)
            errors = validate_instance(payload, RESULT_SCHEMA)
            self.assertEqual(errors, [], errors)
            self.assertEqual(payload["operation"], "promote")
            self.assertFalse(payload["ok"])
            self.assertTrue(payload["rolled_back"])
            self.assertIn("suite-json", "\n".join(payload["violations"]))
            self.assertFalse(dest.exists())
            self.assertEqual(suite_path.read_text(encoding="utf-8"), "{not json}\n")
        finally:
            shutil.rmtree(dest, ignore_errors=True)
            if suite_original is None:
                suite_path.unlink(missing_ok=True)
            else:
                suite_path.write_text(suite_original, encoding="utf-8")

    def test_promote_rolls_back_when_existing_suite_cases_shape_is_bad(self) -> None:
        case_id = "workspace-inventory-rollback-bad-suite-shape"
        dest = REPO_ROOT / "skills" / "workspace-inventory" / "evals" / case_id
        suite_path = REPO_ROOT / "evals" / "suites" / "skill-workspace-inventory.json"
        self.assertFalse(dest.exists(), f"refusing to delete pre-existing fixture: {dest}")
        suite_original = suite_path.read_text(encoding="utf-8") if suite_path.is_file() else None
        bad_suite = json.dumps({"name": "skill-workspace-inventory", "cases": "not-a-list"}, indent=2) + "\n"

        try:
            suite_path.parent.mkdir(parents=True, exist_ok=True)
            suite_path.write_text(bad_suite, encoding="utf-8")
            with tempfile.TemporaryDirectory() as tmp:
                case_dir = self.make_workspace_inventory_candidate(Path(tmp), case_id=case_id)
                result = self.run_generator("--skill", "workspace-inventory", "--promote", str(case_dir))

            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stderr, "")
            payload = json.loads(result.stdout)
            errors = validate_instance(payload, RESULT_SCHEMA)
            self.assertEqual(errors, [], errors)
            self.assertEqual(payload["operation"], "promote")
            self.assertFalse(payload["ok"])
            self.assertTrue(payload["rolled_back"])
            self.assertIn("suite-shape", "\n".join(payload["violations"]))
            self.assertFalse(dest.exists())
            self.assertEqual(suite_path.read_text(encoding="utf-8"), bad_suite)
        finally:
            shutil.rmtree(dest, ignore_errors=True)
            if suite_original is None:
                suite_path.unlink(missing_ok=True)
            else:
                suite_path.write_text(suite_original, encoding="utf-8")

    def test_promote_ignores_unrelated_broken_suite_when_checking_scoped_suite(self) -> None:
        case_id = "workspace-inventory-scoped-suite-unit-test"
        dest = REPO_ROOT / "skills" / "workspace-inventory" / "evals" / case_id
        suite_path = REPO_ROOT / "evals" / "suites" / "skill-workspace-inventory.json"
        unrelated_suite = REPO_ROOT / "evals" / "suites" / "skill-unrelated-broken-test.json"
        self.assertFalse(dest.exists(), f"refusing to delete pre-existing fixture: {dest}")
        self.assertFalse(unrelated_suite.exists(), f"refusing to overwrite pre-existing fixture: {unrelated_suite}")
        suite_original = suite_path.read_text(encoding="utf-8") if suite_path.is_file() else None

        try:
            unrelated_suite.write_text("{not json}\n", encoding="utf-8")
            with tempfile.TemporaryDirectory() as tmp:
                case_dir = self.make_workspace_inventory_candidate(Path(tmp), case_id=case_id)
                result = self.run_generator("--skill", "workspace-inventory", "--promote", str(case_dir))

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stderr, "")
            self.assertNotIn(str(unrelated_suite), result.stdout + result.stderr)
            payload = json.loads(result.stdout)
            errors = validate_instance(payload, RESULT_SCHEMA)
            self.assertEqual(errors, [], errors)
            self.assertEqual(payload["operation"], "promote")
            self.assertTrue(payload["ok"])
            self.assertTrue(dest.is_dir())
            suite = json.loads(suite_path.read_text(encoding="utf-8"))
            self.assertIn(f"skills/workspace-inventory/evals/{case_id}", suite["cases"])
            self.assertEqual(unrelated_suite.read_text(encoding="utf-8"), "{not json}\n")
        finally:
            shutil.rmtree(dest, ignore_errors=True)
            unrelated_suite.unlink(missing_ok=True)
            if suite_original is None:
                suite_path.unlink(missing_ok=True)
            else:
                suite_path.write_text(suite_original, encoding="utf-8")

    def test_validate_only_infers_bootstrap_for_true_zero_case_skill(self) -> None:
        skill = "zero-case-bootstrap-contract-test"
        skill_dir = self.make_zero_case_bootstrap_skill(skill)

        try:
            with tempfile.TemporaryDirectory() as tmp:
                case_dir = self.make_zero_case_bootstrap_candidate(Path(tmp), skill)
                result = self.run_generator("--skill", skill, "--validate-only", str(case_dir))

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stderr, "")
            payload = json.loads(result.stdout)
            errors = validate_instance(payload, RESULT_SCHEMA)
            self.assertEqual(errors, [], errors)
            self.assertEqual(payload["schema_version"], "case-generation-result.v1")
            self.assertEqual(payload["operation"], "validate-only")
            self.assertEqual(payload["case_id"], f"{skill}-first-case")
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["violations"], [])
            self.assertEqual(payload["replay_status"], "pass")
            self.assertEqual(payload["sensitivity_status"], "fail")
        finally:
            shutil.rmtree(skill_dir, ignore_errors=True)

    def test_validate_only_does_not_infer_bootstrap_when_only_existing_case_dir_is_unloadable(self) -> None:
        skill = "zero-case-broken-existing-contract-test"
        skill_dir = self.make_zero_case_bootstrap_skill(skill)
        broken_dir = skill_dir / "evals" / f"{skill}-broken-existing"
        self.assertFalse(broken_dir.exists(), f"refusing to delete pre-existing fixture: {broken_dir}")

        try:
            broken_dir.mkdir(parents=True)
            (broken_dir / "metadata.json").write_text("{not json}\n", encoding="utf-8")
            with tempfile.TemporaryDirectory() as tmp:
                case_dir = self.make_zero_case_bootstrap_candidate(Path(tmp), skill)
                result = self.run_generator("--skill", skill, "--validate-only", str(case_dir))
                explicit = self.run_generator(
                    "--skill",
                    skill,
                    "--bootstrap",
                    "--validate-only",
                    str(case_dir),
                )

            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("no loadable eval cases to seed from", result.stdout + result.stderr)
            self.assertEqual(explicit.returncode, 0, explicit.stdout + explicit.stderr)
            self.assertEqual(explicit.stderr, "")
            payload = json.loads(explicit.stdout)
            errors = validate_instance(payload, RESULT_SCHEMA)
            self.assertEqual(errors, [], errors)
            self.assertEqual(payload["schema_version"], "case-generation-result.v1")
            self.assertEqual(payload["operation"], "validate-only")
            self.assertEqual(payload["case_id"], f"{skill}-first-case")
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["violations"], [])
        finally:
            shutil.rmtree(skill_dir, ignore_errors=True)

    def test_validate_only_imports_external_zero_case_skill_path(self) -> None:
        skill = "zero-case-path-import-contract-test"
        repo_skill_dir = REPO_ROOT / "skills" / skill
        self.assertFalse(repo_skill_dir.exists(), f"refusing to delete pre-existing fixture: {repo_skill_dir}")

        try:
            with tempfile.TemporaryDirectory() as tmp:
                tmp_path = Path(tmp)
                source_skill = self.make_zero_case_bootstrap_skill(skill, tmp_path / "external-skills")
                case_dir = self.make_zero_case_bootstrap_candidate(tmp_path, skill)
                result = self.run_generator("--skill", str(source_skill), "--validate-only", str(case_dir))

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stderr, "")
            self.assertTrue(repo_skill_dir.is_dir())
            self.assertTrue((repo_skill_dir / "SKILL.md").is_file())
            self.assertTrue((repo_skill_dir / "references" / "guide.md").is_file())
            payload = json.loads(result.stdout)
            errors = validate_instance(payload, RESULT_SCHEMA)
            self.assertEqual(errors, [], errors)
            self.assertEqual(payload["schema_version"], "case-generation-result.v1")
            self.assertEqual(payload["operation"], "validate-only")
            self.assertEqual(payload["case_id"], f"{skill}-first-case")
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["violations"], [])
        finally:
            shutil.rmtree(repo_skill_dir, ignore_errors=True)

    def test_generation_infers_bootstrap_for_external_zero_case_skill_path(self) -> None:
        skill = "zero-case-path-generate-contract-test"
        repo_skill_dir = REPO_ROOT / "skills" / skill
        self.assertFalse(repo_skill_dir.exists(), f"refusing to delete pre-existing fixture: {repo_skill_dir}")

        try:
            with tempfile.TemporaryDirectory() as tmp:
                source_skill = self.make_zero_case_bootstrap_skill(skill, Path(tmp) / "external-skills")
                result = self.run_generator(
                    "--skill",
                    str(source_skill),
                    "--n",
                    "1",
                    "--api-key-env",
                    "__GEN_EVAL_CASES_MISSING_KEY__",
                )

            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(repo_skill_dir.is_dir())
            self.assertNotIn("no loadable eval cases to seed from", result.stdout + result.stderr)
            self.assertIn("__GEN_EVAL_CASES_MISSING_KEY__", result.stdout + result.stderr)
            self.assertNotIn("Traceback", result.stdout + result.stderr)
            self.assertIn("LM setup failed", result.stderr)
        finally:
            shutil.rmtree(repo_skill_dir, ignore_errors=True)

    def test_external_prompt_style_skill_imports_and_adds_synthetic_laguna_contract(self) -> None:
        skill = "prompt-style-path-import-contract-test"
        repo_skill_dir = REPO_ROOT / "skills" / skill
        self.assertFalse(repo_skill_dir.exists(), f"refusing to delete pre-existing fixture: {repo_skill_dir}")

        try:
            with tempfile.TemporaryDirectory() as tmp:
                tmp_path = Path(tmp)
                source_skill = self.make_prompt_style_external_skill(tmp_path / "external-skills", skill)
                case_dir = self.make_synthetic_laguna_candidate(tmp_path, skill)
                result = self.run_generator("--skill", str(source_skill), "--validate-only", str(case_dir))

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stderr, "")
            self.assertTrue(repo_skill_dir.is_dir())
            self.assertTrue((repo_skill_dir / "references" / "guide.md").is_file())
            self.assertTrue((repo_skill_dir / "scripts" / "helper.mjs").is_file())
            self.assertFalse((repo_skill_dir / ".beads").exists())
            self.assertFalse((repo_skill_dir / "agent_ergonomics_audit").exists())
            self.assertTrue((repo_skill_dir / "schemas" / f"{skill}-synthetic-bootstrap.schema.json").is_file())
            self.assertTrue(
                (repo_skill_dir / "scripts" / f"validate_{skill.replace('-', '_')}_synthetic_bootstrap.ts").is_file()
            )
            self.assertIn(".laguna/prompt-style-path-import-contract-test.json", (repo_skill_dir / "SKILL.md").read_text(encoding="utf-8"))
            payload = json.loads(result.stdout)
            errors = validate_instance(payload, RESULT_SCHEMA)
            self.assertEqual(errors, [], errors)
            self.assertEqual(payload["schema_version"], "case-generation-result.v1")
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["violations"], [])
        finally:
            shutil.rmtree(repo_skill_dir, ignore_errors=True)

    def test_external_prompt_style_import_adds_gepa_structure_fields(self) -> None:
        skill = "prompt-style-gepa-structure-contract-test"
        repo_skill_dir = REPO_ROOT / "skills" / skill
        self.assertFalse(repo_skill_dir.exists(), f"refusing to delete pre-existing fixture: {repo_skill_dir}")

        try:
            with tempfile.TemporaryDirectory() as tmp:
                tmp_path = Path(tmp)
                source_skill = self.make_prompt_style_external_skill_without_repo_authoring_fields(
                    tmp_path / "external-skills",
                    skill,
                )
                case_dir = self.make_synthetic_laguna_candidate(tmp_path, skill)
                result = self.run_generator("--skill", str(source_skill), "--validate-only", str(case_dir))

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            imported = (repo_skill_dir / "SKILL.md").read_text(encoding="utf-8")
            self.assertIn('metadata:\n  version: "0.1.0"', imported)
            self.assertIn("## Do not use when", imported)
            self.assertLess(imported.index("# Prompt Style Skill"), imported.index("## Do not use when"))
            self.assertTrue((repo_skill_dir / "schemas" / f"{skill}-synthetic-bootstrap.schema.json").is_file())
            self.assertTrue(
                (repo_skill_dir / "scripts" / f"validate_{skill.replace('-', '_')}_synthetic_bootstrap.ts").is_file()
            )
            structure = subprocess.run(
                ["uv", "run", "scripts/check_skill_structure.py", "--json"],
                cwd=REPO_ROOT,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(structure.returncode, 0, structure.stdout + structure.stderr)
        finally:
            shutil.rmtree(repo_skill_dir, ignore_errors=True)

    def test_no_lm_skeleton_for_external_prompt_style_skill_creates_valid_promotable_candidate(self) -> None:
        skill = "prompt-style-no-lm-skeleton-contract-test"
        repo_skill_dir = REPO_ROOT / "skills" / skill
        suite_path = REPO_ROOT / "evals" / "suites" / f"skill-{skill}.json"
        self.assertFalse(repo_skill_dir.exists(), f"refusing to delete pre-existing fixture: {repo_skill_dir}")
        self.assertFalse(suite_path.exists(), f"refusing to overwrite pre-existing fixture: {suite_path}")

        try:
            with tempfile.TemporaryDirectory() as tmp:
                tmp_path = Path(tmp)
                out_dir = tmp_path / "generated"
                source_skill = self.make_prompt_style_external_skill(tmp_path / "external-skills", skill)
                result = self.run_generator(
                    "--skill",
                    str(source_skill),
                    "--n",
                    "1",
                    "--no-lm-skeleton",
                    "--out-dir",
                    str(out_dir),
                )

                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(result.stderr, "")
                self.assertTrue(repo_skill_dir.is_dir())
                self.assertFalse((repo_skill_dir / ".beads").exists())
                self.assertFalse((repo_skill_dir / "agent_ergonomics_audit").exists())
                report = json.loads(result.stdout)
                self.assertEqual(report["schema_version"], "case-generation.v1")
                self.assertTrue(report["generated_without_lm"])
                self.assertTrue(report["synthetic_laguna_bootstrap"])
                self.assertEqual(report["n_survivors"], 1)
                self.assertEqual(len(report["results"]), 1)
                candidate = Path(report["results"][0]["case_dir"])
                self.assertTrue(candidate.is_dir())
                self.assertTrue((candidate / "expected" / ".laguna" / f"{skill}.json").is_file())

                validate = self.run_generator("--skill", skill, "--validate-only", str(candidate))
                self.assertEqual(validate.returncode, 0, validate.stdout + validate.stderr)
                self.assertEqual(validate.stderr, "")
                validate_payload = json.loads(validate.stdout)
                errors = validate_instance(validate_payload, RESULT_SCHEMA)
                self.assertEqual(errors, [], errors)
                self.assertTrue(validate_payload["ok"])
                self.assertEqual(validate_payload["replay_status"], "pass")
                self.assertEqual(validate_payload["sensitivity_status"], "fail")

                promote = self.run_generator("--skill", skill, "--promote", str(candidate))
                self.assertEqual(promote.returncode, 0, promote.stdout + promote.stderr)
                self.assertEqual(promote.stderr, "")
                promote_payload = json.loads(promote.stdout)
                errors = validate_instance(promote_payload, RESULT_SCHEMA)
                self.assertEqual(errors, [], errors)
                self.assertTrue(promote_payload["ok"])
                self.assertEqual(promote_payload["dest"], f"skills/{skill}/evals/{candidate.name}")
                self.assertEqual(promote_payload["suite"], f"evals/suites/skill-{skill}.json")
                self.assertTrue((repo_skill_dir / "evals" / candidate.name).is_dir())
                self.assertTrue(suite_path.is_file())
        finally:
            shutil.rmtree(repo_skill_dir, ignore_errors=True)
            suite_path.unlink(missing_ok=True)

    def test_missing_lm_key_auto_falls_back_to_skeleton_for_bootstrap_context(self) -> None:
        skill = "prompt-style-missing-key-skeleton-contract-test"
        repo_skill_dir = REPO_ROOT / "skills" / skill
        self.assertFalse(repo_skill_dir.exists(), f"refusing to delete pre-existing fixture: {repo_skill_dir}")

        try:
            with tempfile.TemporaryDirectory() as tmp:
                tmp_path = Path(tmp)
                out_dir = tmp_path / "generated"
                source_skill = self.make_prompt_style_external_skill(tmp_path / "external-skills", skill)
                result = self.run_generator(
                    "--skill",
                    str(source_skill),
                    "--n",
                    "1",
                    "--api-key-env",
                    "__GEN_EVAL_CASES_MISSING_KEY_AUTO_SKELETON__",
                    "--out-dir",
                    str(out_dir),
                )

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("writing no-LM bootstrap skeleton instead", result.stderr)
            self.assertNotIn("Traceback", result.stdout + result.stderr)
            report = json.loads(result.stdout)
            self.assertTrue(report["generated_without_lm"])
            self.assertIn("__GEN_EVAL_CASES_MISSING_KEY_AUTO_SKELETON__", report["no_lm_reason"])
            self.assertEqual(report["n_survivors"], 1)
        finally:
            shutil.rmtree(repo_skill_dir, ignore_errors=True)

    def test_lm_call_failure_auto_falls_back_to_skeleton_for_bootstrap_context(self) -> None:
        skill = "prompt-style-lm-call-failure-skeleton-contract-test"
        repo_skill_dir = REPO_ROOT / "skills" / skill
        self.assertFalse(repo_skill_dir.exists(), f"refusing to delete pre-existing fixture: {repo_skill_dir}")

        try:
            with tempfile.TemporaryDirectory() as tmp:
                tmp_path = Path(tmp)
                out_dir = tmp_path / "generated"
                source_skill = self.make_prompt_style_external_skill(tmp_path / "external-skills", skill)
                env = {
                    key: value
                    for key, value in os.environ.items()
                    if key not in {"OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"}
                }
                result = self.run_generator(
                    "--skill",
                    str(source_skill),
                    "--n",
                    "1",
                    "--out-dir",
                    str(out_dir),
                    env=env,
                )

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("writing no-LM bootstrap skeleton instead", result.stderr)
            self.assertIn("LM call failed during spec proposal", result.stderr)
            self.assertNotIn("Traceback", result.stdout + result.stderr)
            report = json.loads(result.stdout)
            self.assertTrue(report["generated_without_lm"])
            self.assertIn("LM call failed during spec proposal", report["no_lm_reason"])
            self.assertEqual(report["n_survivors"], 1)
        finally:
            shutil.rmtree(repo_skill_dir, ignore_errors=True)

    def test_repeated_external_skill_path_reuses_existing_repo_copy(self) -> None:
        skill = "prompt-style-repeated-path-contract-test"
        repo_skill_dir = REPO_ROOT / "skills" / skill
        self.assertFalse(repo_skill_dir.exists(), f"refusing to delete pre-existing fixture: {repo_skill_dir}")

        try:
            with tempfile.TemporaryDirectory() as tmp:
                tmp_path = Path(tmp)
                source_skill = self.make_prompt_style_external_skill(tmp_path / "external-skills", skill)
                first = self.run_generator(
                    "--skill",
                    str(source_skill),
                    "--n",
                    "1",
                    "--no-lm-skeleton",
                    "--out-dir",
                    str(tmp_path / "first"),
                )
                second = self.run_generator(
                    "--skill",
                    str(source_skill),
                    "--n",
                    "1",
                    "--no-lm-skeleton",
                    "--out-dir",
                    str(tmp_path / "second"),
                )

            self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
            self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
            self.assertNotIn("already exists", second.stdout + second.stderr)
            first_payload = json.loads(first.stdout)
            second_payload = json.loads(second.stdout)
            self.assertTrue(first_payload["skill_imported"])
            self.assertFalse(first_payload["skill_import_reused"])
            self.assertFalse(second_payload["skill_imported"])
            self.assertTrue(second_payload["skill_import_reused"])
            self.assertEqual(second_payload["imported_skill_dir"], f"skills/{skill}")
            self.assertEqual(second_payload["n_survivors"], 1)
        finally:
            shutil.rmtree(repo_skill_dir, ignore_errors=True)

    def test_repeated_no_lm_skeleton_after_promote_uses_unique_case_id(self) -> None:
        skill = "prompt-style-repeated-skeleton-contract-test"
        repo_skill_dir = REPO_ROOT / "skills" / skill
        suite_path = REPO_ROOT / "evals" / "suites" / f"skill-{skill}.json"
        self.assertFalse(repo_skill_dir.exists(), f"refusing to delete pre-existing fixture: {repo_skill_dir}")
        self.assertFalse(suite_path.exists(), f"refusing to overwrite pre-existing fixture: {suite_path}")

        try:
            with tempfile.TemporaryDirectory() as tmp:
                tmp_path = Path(tmp)
                source_skill = self.make_prompt_style_external_skill(tmp_path / "external-skills", skill)
                first = self.run_generator(
                    "--skill",
                    str(source_skill),
                    "--n",
                    "1",
                    "--no-lm-skeleton",
                    "--out-dir",
                    str(tmp_path / "first"),
                )
                self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
                first_payload = json.loads(first.stdout)
                first_case = Path(first_payload["results"][0]["case_dir"])
                promote = self.run_generator("--skill", skill, "--promote", str(first_case))
                self.assertEqual(promote.returncode, 0, promote.stdout + promote.stderr)

                second = self.run_generator(
                    "--skill",
                    str(source_skill),
                    "--n",
                    "1",
                    "--no-lm-skeleton",
                    "--out-dir",
                    str(tmp_path / "second"),
                )

            self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
            self.assertNotIn("dedup:", second.stdout + second.stderr)
            second_payload = json.loads(second.stdout)
            self.assertTrue(second_payload["skill_import_reused"])
            self.assertEqual(second_payload["n_survivors"], 1)
            second_case = Path(second_payload["results"][0]["case_dir"]).name
            self.assertNotEqual(second_case, first_case.name)
            self.assertTrue(second_case.endswith("-2"))
        finally:
            shutil.rmtree(repo_skill_dir, ignore_errors=True)
            suite_path.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
