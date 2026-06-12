from __future__ import annotations

import json
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
    def run_generator(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["uv", "run", str(GEN_EVAL_CASES), *args],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            check=False,
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

    def test_validate_only_does_not_infer_bootstrap_when_existing_case_dir_is_unloadable(self) -> None:
        broken_dir = REPO_ROOT / "skills" / "workspace-inventory" / "evals" / "workspace-inventory-broken-existing"
        self.assertFalse(broken_dir.exists(), f"refusing to delete pre-existing fixture: {broken_dir}")

        try:
            broken_dir.mkdir(parents=True)
            (broken_dir / "metadata.json").write_text("{not json}\n", encoding="utf-8")
            with tempfile.TemporaryDirectory() as tmp:
                case_dir = self.make_workspace_inventory_candidate(Path(tmp))
                result = self.run_generator("--skill", "workspace-inventory", "--validate-only", str(case_dir))
                explicit = self.run_generator(
                    "--skill",
                    "workspace-inventory",
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
            self.assertEqual(payload["case_id"], "workspace-inventory-bootstrap-unit-test")
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["violations"], [])
        finally:
            shutil.rmtree(broken_dir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
