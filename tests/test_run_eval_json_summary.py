from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import Any

from harness.runner import fixtures as fx
from harness.runner import matrix as mx
from harness.runner import run_eval
from harness.validators.json_schema import validate_instance


REPO_ROOT = Path(__file__).resolve().parents[1]
RUN_EVAL = REPO_ROOT / "harness" / "runner" / "run_eval.py"
SMOKE_SUITE = REPO_ROOT / "evals" / "suites" / "smoke.json"
SUMMARY_SCHEMA = "eval-dry-run-summary.v1"
ERROR_SCHEMA = "eval-error.v1"


class RunEvalJsonSummaryTests(unittest.TestCase):
    def run_eval(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["uv", "run", str(RUN_EVAL), "--suite", str(SMOKE_SUITE), *args],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            check=False,
        )

    def parse_single_stdout_json(self, result: subprocess.CompletedProcess[str]) -> dict[str, Any]:
        self.assertNotEqual(result.stdout, "", result.stderr)
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            self.fail(
                "expected stdout to contain exactly one parseable JSON summary; "
                f"stdout={result.stdout!r}, stderr={result.stderr!r}, error={exc}"
            )
        self.assertIsInstance(payload, dict)
        decoder = json.JSONDecoder()
        _, end = decoder.raw_decode(result.stdout)
        self.assertEqual(result.stdout[end:].strip(), "", result.stdout)
        return payload

    def parse_single_stderr_json(self, result: subprocess.CompletedProcess[str]) -> dict[str, Any]:
        self.assertEqual(result.stdout, "")
        self.assertNotEqual(result.stderr, "")
        try:
            payload = json.loads(result.stderr)
        except json.JSONDecodeError as exc:
            self.fail(
                "expected stderr to contain exactly one parseable JSON error; "
                f"stdout={result.stdout!r}, stderr={result.stderr!r}, error={exc}"
            )
        self.assertIsInstance(payload, dict)
        errors = validate_instance(payload, ERROR_SCHEMA)
        self.assertEqual(errors, [], errors)
        return payload

    def assert_summary_contract(self, payload: dict[str, Any]) -> None:
        errors = validate_instance(payload, SUMMARY_SCHEMA)
        self.assertEqual(errors, [], errors)
        self.assertEqual(payload["schema_version"], SUMMARY_SCHEMA)
        self.assertIsInstance(payload["ok"], bool)
        self.assertEqual(payload["suite"]["path"], "evals/suites/smoke.json")
        self.assertGreaterEqual(payload["counts"]["cases_loaded"], 1)
        self.assertGreaterEqual(payload["counts"]["runs_planned"], 1)
        self.assertEqual(payload["counts"]["failures"], 0)
        self.assertEqual(len(payload["runs"]), payload["counts"]["runs_planned"])
        first_run = payload["runs"][0]
        self.assertIsInstance(first_run["pool_command"]["argv"], list)
        self.assertIsInstance(first_run["validator"]["argv"], list)
        self.assertTrue(first_run["manifest_preview"]["valid"], first_run["manifest_preview"])

    def test_dry_run_json_summary_emits_exactly_one_parseable_summary_on_stdout(self) -> None:
        result = self.run_eval("--dry-run", "--json-summary")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stderr, "")
        payload = self.parse_single_stdout_json(result)
        self.assert_summary_contract(payload)
        self.assertNotIn("DRY-RUN OK", result.stdout)
        self.assertNotIn("[fixture]", result.stdout)
        self.assertNotIn("command:", result.stdout)

    def test_dry_run_json_summary_with_replay_reports_passing_replays(self) -> None:
        result = self.run_eval("--dry-run", "--json-summary", "--replay")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stderr, "")
        payload = self.parse_single_stdout_json(result)
        self.assert_summary_contract(payload)
        self.assertGreater(len(payload["replays"]), 0)
        self.assertTrue(
            all(replay["status"] == "pass" for replay in payload["replays"]),
            payload["replays"],
        )
        self.assertEqual(payload["counts"]["replay_failures"], 0)
        self.assertEqual(payload["counts"]["failures"], 0)

    def test_dry_run_json_summary_with_replay_skips_invalid_fixture_without_replay_failure(self) -> None:
        with tempfile.TemporaryDirectory() as skills_root:
            result = self.run_eval(
                "--dry-run",
                "--json-summary",
                "--replay",
                "--case",
                "ci-log-reducer-pytest-single-failure",
                "--arm",
                "xs_without_skill",
                "--arm",
                "xs_with_skill",
                "--skills-root",
                skills_root,
            )

        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertEqual(result.stderr, "")
        payload = self.parse_single_stdout_json(result)
        errors = validate_instance(payload, SUMMARY_SCHEMA)
        self.assertEqual(errors, [], errors)
        self.assertEqual(len(payload["replays"]), 1)
        self.assertEqual(payload["replays"][0]["case_id"], "ci-log-reducer-pytest-single-failure")
        self.assertEqual(payload["replays"][0]["status"], "skipped")
        self.assertEqual(payload["replays"][0]["reason"], "fixture invalid")
        self.assertEqual(payload["counts"]["run_preview_failures"], 1)
        self.assertEqual(payload["counts"]["replay_failures"], 0)
        self.assertEqual(payload["counts"]["failures"], 1)
        self.assertFalse(payload["ok"])

    def test_robot_dry_run_is_alias_for_dry_run_json_summary(self) -> None:
        explicit = self.run_eval("--dry-run", "--json-summary")
        alias = self.run_eval("--robot-dry-run")

        self.assertEqual(explicit.returncode, 0, explicit.stdout + explicit.stderr)
        self.assertEqual(alias.returncode, 0, alias.stdout + alias.stderr)
        explicit_payload = self.parse_single_stdout_json(explicit)
        alias_payload = self.parse_single_stdout_json(alias)
        self.assert_summary_contract(alias_payload)

        for payload in (explicit_payload, alias_payload):
            for run in payload["runs"]:
                run.pop("run_id", None)
                if run.get("manifest_preview") and run["manifest_preview"].get("manifest"):
                    run["manifest_preview"]["manifest"].pop("run_id", None)
                    run["manifest_preview"]["manifest"].pop("timing", None)
        self.assertEqual(alias_payload, explicit_payload)

    def test_robot_dry_run_keep_workspaces_keeps_dirs_without_leaking_temp_paths(self) -> None:
        with tempfile.TemporaryDirectory(prefix="run-eval-keep-workspaces-test-") as tmp:
            temp_root = Path(tmp)
            env = {**os.environ, "TMPDIR": str(temp_root)}
            result = subprocess.run(
                [
                    "uv",
                    "run",
                    str(RUN_EVAL),
                    "--suite",
                    str(SMOKE_SUITE),
                    "--robot-dry-run",
                    "--keep-workspaces",
                ],
                cwd=REPO_ROOT,
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stderr, "")
            payload = self.parse_single_stdout_json(result)
            self.assert_summary_contract(payload)
            self.assertTrue(any(temp_root.iterdir()), "expected --keep-workspaces to leave test-owned temp dirs")
            self.assertNotIn(str(temp_root), result.stdout)

    def test_robot_dry_run_summary_does_not_depend_on_poolside_token_env(self) -> None:
        base_env = os.environ.copy()
        unset_env = {key: value for key, value in base_env.items() if key != "POOLSIDE_TOKEN"}
        set_env = {**base_env, "POOLSIDE_TOKEN": "test-token"}
        without_token = subprocess.run(
            ["uv", "run", str(RUN_EVAL), "--suite", str(SMOKE_SUITE), "--robot-dry-run"],
            cwd=REPO_ROOT,
            env=unset_env,
            text=True,
            capture_output=True,
            check=False,
        )
        with_token = subprocess.run(
            ["uv", "run", str(RUN_EVAL), "--suite", str(SMOKE_SUITE), "--robot-dry-run"],
            cwd=REPO_ROOT,
            env=set_env,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(without_token.returncode, 0, without_token.stdout + without_token.stderr)
        self.assertEqual(with_token.returncode, 0, with_token.stdout + with_token.stderr)
        without_payload = self.parse_single_stdout_json(without_token)
        with_payload = self.parse_single_stdout_json(with_token)
        self.assert_summary_contract(without_payload)
        self.assert_summary_contract(with_payload)
        self.assertEqual(with_payload, without_payload)

    def test_json_summary_conflicts_with_print_manifest_without_corrupting_stdout(self) -> None:
        result = self.run_eval("--dry-run", "--json-summary", "--print-manifest")

        self.assertNotEqual(result.returncode, 0)
        payload = self.parse_single_stderr_json(result)
        self.assertEqual(payload["schema_version"], "eval-error.v1")
        self.assertEqual(payload["phase"], "args")
        self.assertIn("--print-manifest", payload["error"]["message"])
        self.assertIn("--json-summary", payload["error"]["message"])

    def test_json_summary_unknown_args_emit_machine_readable_error(self) -> None:
        result = self.run_eval("--json-summary", "--badflag")

        self.assertEqual(result.returncode, 2)
        payload = self.parse_single_stderr_json(result)
        self.assertEqual(payload["schema_version"], "eval-error.v1")
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["phase"], "args")
        self.assertEqual(payload["exit_code"], 2)
        self.assertIn("--badflag", payload["error"]["message"])

    def test_robot_dry_run_bad_suite_emits_machine_readable_error(self) -> None:
        result = subprocess.run(
            ["uv", "run", str(RUN_EVAL), "--suite", "__missing_suite__.json", "--robot-dry-run"],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(result.returncode, 2)
        payload = self.parse_single_stderr_json(result)
        self.assertEqual(payload["schema_version"], "eval-error.v1")
        self.assertEqual(payload["phase"], "suite")
        self.assertIn("__missing_suite__.json", payload["error"]["message"])

    def test_robot_dry_run_empty_matrix_emits_machine_readable_error(self) -> None:
        result = self.run_eval("--robot-dry-run", "--case", "__missing_case__")

        self.assertEqual(result.returncode, 2)
        payload = self.parse_single_stderr_json(result)
        self.assertEqual(payload["schema_version"], "eval-error.v1")
        self.assertEqual(payload["phase"], "suite")
        self.assertIn("__missing_case__", payload["error"]["message"])

    def test_human_dry_run_stays_prose_unless_robot_flag_is_used(self) -> None:
        result = self.run_eval("--dry-run")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("DRY-RUN OK", result.stdout)
        with self.assertRaises(json.JSONDecodeError):
            json.loads(result.stdout)

    def test_json_summary_validates_fixtures_per_arm_not_per_case(self) -> None:
        with tempfile.TemporaryDirectory() as skills_root:
            result = self.run_eval(
                "--dry-run",
                "--json-summary",
                "--case",
                "ci-log-reducer-pytest-single-failure",
                "--arm",
                "xs_without_skill",
                "--arm",
                "xs_with_skill",
                "--skills-root",
                skills_root,
            )

        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertEqual(result.stderr, "")
        payload = self.parse_single_stdout_json(result)
        errors = validate_instance(payload, SUMMARY_SCHEMA)
        self.assertEqual(errors, [], errors)
        runs_by_arm = {run["arm"]: run for run in payload["runs"]}
        self.assertTrue(runs_by_arm["xs_without_skill"]["ok"])
        self.assertEqual(runs_by_arm["xs_without_skill"]["fixture"]["status"], "ok")
        self.assertFalse(runs_by_arm["xs_with_skill"]["ok"])
        self.assertEqual(runs_by_arm["xs_with_skill"]["fixture"]["status"], "invalid")
        self.assertEqual(payload["counts"]["fixture_invalid_cases"], 1)
        self.assertEqual(payload["counts"]["run_preview_failures"], 1)
        self.assertEqual(payload["counts"]["failures"], 1)
        self.assertFalse(payload["ok"])

    def test_json_summary_invalid_metadata_missing_skill_uses_null_skill(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            case_dir = Path(tmp) / "ci-log-reducer-missing-skill"
            case_dir.mkdir()
            (case_dir / "prompt.md").write_text("Reduce this CI log.\n", encoding="utf-8")
            (case_dir / "input").mkdir()
            (case_dir / "expected").mkdir()
            (case_dir / "metadata.json").write_text(
                json.dumps(
                    {
                        "id": "ci-log-reducer-missing-skill",
                        "bucket": "edge",
                        "difficulty": "medium",
                        "arms": ["xs_without_skill"],
                        "publishability": "internal",
                        "validator": {"command": ["python", "validator.py"], "expected_status": "pass"},
                    }
                ),
                encoding="utf-8",
            )
            suite_path = Path(tmp) / "suite.json"
            suite_path.write_text(
                json.dumps({"name": "missing-skill", "cases": [str(case_dir)]}),
                encoding="utf-8",
            )

            suite_name, case_dirs = mx.load_suite(suite_path)
            cases = [mx.load_case(path) for path in case_dirs]
            specs = mx.build_matrix(cases, ["ci-log-reducer-missing-skill"], ["xs_without_skill"])
            args = argparse.Namespace(
                cases=["ci-log-reducer-missing-skill"],
                arms=["xs_without_skill"],
                skills_root=fx.DEFAULT_SKILLS_ROOT,
                runs_root=REPO_ROOT / "runs",
                pool_bin="pool",
                api_url="https://api.poolsi.de",
                keep_workspaces=False,
                replay=False,
                validator_timeout=120.0,
            )

            stdout = io.StringIO()
            stderr = io.StringIO()
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                exit_code = run_eval.run_dry_json(suite_name, suite_path, cases, specs, args)

        self.assertEqual(exit_code, 1)
        self.assertEqual(stderr.getvalue(), "")
        payload = json.loads(stdout.getvalue())
        errors = validate_instance(payload, SUMMARY_SCHEMA)
        self.assertEqual(errors, [], errors)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["counts"]["fixture_invalid_cases"], 1)
        self.assertEqual(payload["counts"]["run_preview_failures"], 1)
        self.assertEqual(payload["counts"]["failures"], 1)
        self.assertEqual(len(payload["runs"]), 1)
        self.assertFalse(payload["runs"][0]["ok"])
        self.assertIsNone(payload["runs"][0]["skill"])
        self.assertEqual(payload["runs"][0]["fixture"]["status"], "invalid")
        self.assertTrue(
            any("'skill' is a required property" in problem for problem in payload["fixtures"][0]["problems"]),
            payload["fixtures"][0]["problems"],
        )

    def test_robot_dry_run_keep_workspaces_redacts_temp_paths_in_fixture_problems(self) -> None:
        suite_name, case_dirs = mx.load_suite(SMOKE_SUITE)
        case = mx.load_case(case_dirs[0])
        spec = mx.build_matrix([case], [case.id], ["xs_with_skill"])[0]
        args = argparse.Namespace(
            cases=[case.id],
            arms=["xs_with_skill"],
            skills_root=fx.DEFAULT_SKILLS_ROOT,
            runs_root=REPO_ROOT / "runs",
            pool_bin="pool",
            api_url="https://api.poolsi.de",
            keep_workspaces=True,
            replay=False,
            validator_timeout=120.0,
        )
        original_materialize = run_eval.fx.materialize

        with tempfile.TemporaryDirectory(prefix="laguna-fixture-problem-redaction-test-") as tmp:
            temp_root = Path(tmp)

            def fake_materialize(case: mx.Case, arm: mx.Arm, skills_root: Path, **kwargs: Any) -> fx.MaterializedRun:
                scratch = Path(tempfile.mkdtemp(prefix="laguna-invariant-test-", dir=temp_root))
                workspace = scratch / "workspace"
                home = scratch / "home"
                state = scratch / "state"
                skill_dest = workspace / ".poolside" / "skills" / case.skill
                skill_dest.mkdir(parents=True)
                home.mkdir()
                state.mkdir()
                return fx.MaterializedRun(
                    scratch=scratch,
                    workspace=workspace,
                    home=home,
                    state=state,
                    skill_materialized=True,
                    credentials_copied=False,
                )

            try:
                run_eval.fx.materialize = fake_materialize
                stdout = io.StringIO()
                stderr = io.StringIO()
                with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                    exit_code = run_eval.run_dry_json(suite_name, SMOKE_SUITE, [case], [spec], args)
            finally:
                run_eval.fx.materialize = original_materialize

            self.assertEqual(exit_code, 1, stdout.getvalue() + stderr.getvalue())
            self.assertEqual(stderr.getvalue(), "")
            self.assertTrue(any(temp_root.iterdir()), "expected test-owned kept workspace to remain until context cleanup")
            payload = json.loads(stdout.getvalue())
            errors = validate_instance(payload, SUMMARY_SCHEMA)
            self.assertEqual(errors, [], errors)
            self.assertEqual(payload["counts"]["fixture_invalid_cases"], 0)
            self.assertEqual(payload["counts"]["run_preview_failures"], 1)
            self.assertFalse(payload["ok"])
            problems = payload["runs"][0]["fixture"]["problems"]
            self.assertTrue(problems, payload["runs"][0]["fixture"])
            self.assertNotIn(str(temp_root), json.dumps(problems))

    def test_json_summary_counts_invariant_failures_even_when_fixture_validation_passes(self) -> None:
        suite_name, case_dirs = mx.load_suite(SMOKE_SUITE)
        case = mx.load_case(case_dirs[0])
        spec = mx.build_matrix([case], [case.id], ["xs_without_skill"])[0]
        args = argparse.Namespace(
            cases=[case.id],
            arms=["xs_without_skill"],
            skills_root=fx.DEFAULT_SKILLS_ROOT,
            runs_root=REPO_ROOT / "runs",
            pool_bin="pool",
            api_url="https://api.poolsi.de",
            keep_workspaces=False,
            replay=False,
            validator_timeout=120.0,
        )
        original_materialize = run_eval.fx.materialize

        def fake_materialize(case: mx.Case, arm: mx.Arm, skills_root: Path, **kwargs: Any) -> fx.MaterializedRun:
            scratch = Path(tempfile.mkdtemp(prefix="laguna-invariant-test-"))
            workspace = scratch / "workspace"
            home = scratch / "home"
            state = scratch / "state"
            skill_dest = workspace / ".poolside" / "skills" / case.skill
            skill_dest.mkdir(parents=True)
            (skill_dest / "SKILL.md").write_text("# leaked baseline skill\n", encoding="utf-8")
            home.mkdir()
            state.mkdir()
            return fx.MaterializedRun(
                scratch=scratch,
                workspace=workspace,
                home=home,
                state=state,
                skill_materialized=True,
                credentials_copied=False,
            )

        try:
            run_eval.fx.materialize = fake_materialize
            stdout = io.StringIO()
            stderr = io.StringIO()
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                exit_code = run_eval.run_dry_json(suite_name, SMOKE_SUITE, [case], [spec], args)
        finally:
            run_eval.fx.materialize = original_materialize

        self.assertEqual(exit_code, 1, stdout.getvalue() + stderr.getvalue())
        self.assertEqual(stderr.getvalue(), "")
        payload = json.loads(stdout.getvalue())
        errors = validate_instance(payload, SUMMARY_SCHEMA)
        self.assertEqual(errors, [], errors)
        self.assertEqual(payload["counts"]["fixture_invalid_cases"], 0)
        self.assertEqual(payload["counts"]["run_preview_failures"], 1)
        self.assertEqual(payload["counts"]["failures"], 1)
        self.assertFalse(payload["ok"])
        self.assertFalse(payload["runs"][0]["ok"])
        self.assertEqual(payload["runs"][0]["fixture"]["status"], "invalid")


if __name__ == "__main__":
    unittest.main()
