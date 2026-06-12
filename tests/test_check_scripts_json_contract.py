from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[1]
INVALID_SCHEMA_FIXTURE = REPO_ROOT / "schemas" / "common" / "__contract_test_invalid.schema.json"


class CheckScriptsJsonContractTests(unittest.TestCase):
    def setUp(self) -> None:
        INVALID_SCHEMA_FIXTURE.unlink(missing_ok=True)
        self.addCleanup(lambda: INVALID_SCHEMA_FIXTURE.unlink(missing_ok=True))

    def run_check_schemas(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["uv", "run", "scripts/check_schemas.py", "--json"],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            check=False,
        )

    def parse_stdout_json(self, result: subprocess.CompletedProcess[str]) -> dict[str, object]:
        self.assertEqual(result.stderr, "")
        self.assertNotEqual(result.stdout, "")
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            self.fail(f"expected stdout JSON; stdout={result.stdout!r}, stderr={result.stderr!r}, error={exc}")
        self.assertIsInstance(payload, dict)
        return payload

    def test_check_schemas_json_success_uses_repo_check_result_contract(self) -> None:
        result = self.run_check_schemas()

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = self.parse_stdout_json(result)
        self.assertEqual(payload["schema_version"], "repo-check-result.v1")
        self.assertEqual(payload["tool"], "check_schemas")
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["violation_count"], 0)
        self.assertEqual(payload["violations"], [])
        self.assertIsInstance(payload["counts"], dict)

    def test_check_schemas_json_failure_uses_repo_check_result_contract(self) -> None:
        INVALID_SCHEMA_FIXTURE.write_text('{"$schema":"https://json-schema.org/draft/2020-12/schema","type":123}\n')
        try:
            result = self.run_check_schemas()
        finally:
            INVALID_SCHEMA_FIXTURE.unlink(missing_ok=True)

        self.assertNotEqual(result.returncode, 0)
        payload = self.parse_stdout_json(result)
        self.assertEqual(payload["schema_version"], "repo-check-result.v1")
        self.assertEqual(payload["tool"], "check_schemas")
        self.assertEqual(payload["status"], "fail")
        self.assertGreaterEqual(payload["violation_count"], 1)
        violations = payload["violations"]
        self.assertIsInstance(violations, list)
        self.assertTrue(
            any(
                isinstance(violation, dict)
                and violation.get("path") == "schemas/common/__contract_test_invalid.schema.json"
                and violation.get("check") == "schema-valid"
                for violation in violations
            ),
            payload,
        )

    def test_check_schemas_json_failure_requires_all_shared_contract_schemas(self) -> None:
        scripts_dir = REPO_ROOT / "scripts"
        sys.path.insert(0, str(scripts_dir))
        self.addCleanup(lambda: sys.path.remove(str(scripts_dir)))
        spec = importlib.util.spec_from_file_location(
            "check_schemas_under_test",
            scripts_dir / "check_schemas.py",
        )
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        check_schemas = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(check_schemas)

        required_names = (
            "validator-result.v1.schema.json",
            "eval-case.v1.schema.json",
            "run-manifest.v0.schema.json",
            "case-generation-result.v1.schema.json",
            "eval-error.v1.schema.json",
            "eval-dry-run-summary.v1.schema.json",
        )
        valid_schema = '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object"}\n'

        for missing_name in (
            "case-generation-result.v1.schema.json",
            "eval-error.v1.schema.json",
            "eval-dry-run-summary.v1.schema.json",
        ):
            with self.subTest(missing_name=missing_name), tempfile.TemporaryDirectory() as temp_dir:
                temp_repo = Path(temp_dir)
                common_dir = temp_repo / "schemas" / "common"
                common_dir.mkdir(parents=True)
                for name in required_names:
                    if name != missing_name:
                        (common_dir / name).write_text(valid_schema)

                stdout = io.StringIO()
                with (
                    mock.patch.object(check_schemas, "REPO_ROOT", temp_repo),
                    mock.patch.object(check_schemas, "COMMON_SCHEMAS_DIR", common_dir),
                    mock.patch("checklib.REPO_ROOT", temp_repo),
                    contextlib.redirect_stdout(stdout),
                ):
                    exit_code = check_schemas.main(["--json"])

                self.assertNotEqual(exit_code, 0)
                payload = json.loads(stdout.getvalue())
                self.assertEqual(payload["schema_version"], "repo-check-result.v1")
                self.assertEqual(payload["tool"], "check_schemas")
                self.assertEqual(payload["status"], "fail")
                self.assertTrue(
                    any(
                        str(violation.get("path", "")).endswith(f"schemas/common/{missing_name}")
                        and violation.get("check") == "common-contract-exists"
                        for violation in payload["violations"]
                    ),
                    payload,
                )


if __name__ == "__main__":
    unittest.main()
