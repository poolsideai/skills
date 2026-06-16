from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


class CheckScriptsCliTests(unittest.TestCase):
    def test_check_schemas_json_bad_flag_emits_stable_json_on_stdout(self) -> None:
        result = subprocess.run(
            ["uv", "run", "scripts/check_schemas.py", "--json", "--bad-flag"],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertNotEqual(result.returncode, 0)
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            self.fail(
                "expected stdout to be stable JSON for --json parse errors; "
                f"stdout={result.stdout!r}, stderr={result.stderr!r}, error={exc}"
            )

        self.assertEqual(payload["schema_version"], "repo-check-result.v1")
        self.assertEqual(payload["tool"], "check_schemas")
        self.assertEqual(payload["status"], "fail")
        self.assertEqual(payload["failure_kind"], "usage_error")
        self.assertEqual(payload["exit_code"], 2)
        self.assertEqual(
            payload["next_commands"][:2],
            ["uv run scripts/check_schemas.py --help", "uv run scripts/check_schemas.py --json"],
        )
        self.assertGreaterEqual(payload["violation_count"], 1)
        self.assertTrue(
            any("--bad-flag" in violation["message"] for violation in payload["violations"]),
            payload,
        )


if __name__ == "__main__":
    unittest.main()
