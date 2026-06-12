from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path


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


if __name__ == "__main__":
    unittest.main()
