---
name: ci-log-reducer
description: >-
  Reduce a failing CI log to a small, verifiable JSON failure summary written
  to .laguna/ci-log-summary.json. Use when the user provides a CI log, build
  log, or test-runner output (pytest, bun test, cargo, go test) and asks why
  CI is red, what failed, which test broke, or what to run next — or asks to
  summarize, triage, or de-noise a long pipeline log. Cites exact log line
  numbers with verbatim text, names the failing command, and suggests safe
  local next commands. Do not use to fix the underlying bug or edit code.
metadata:
  version: "0.1.1"
---

# CI Log Reducer

## Purpose

Turn one failing CI log into a small, machine-checkable JSON summary: what command failed,
the decisive error lines cited verbatim with their line numbers, and safe local next steps.
The summary is graded mechanically, so accuracy beats eloquence.

## Use when

- The user provides a CI log, build log, or test-runner output and asks what failed, why the
  pipeline is red, which test broke, or what to run next.
- The log is long or noisy (pytest, `bun test`, cargo, go test, or generic runners) and needs
  reducing to the lines that matter before anyone debugs.
- A teammate or bot needs a structured, citable failure record rather than prose.

## Do not use when

- The task is to **fix** the failure or edit code — this skill only produces the summary;
  fixing is a separate task that may consume the summary.
- There is no log file in the workspace. Ask for one; never reconstruct a log from memory or
  from the user's paraphrase.
- The input is not a single CI run (aggregated dashboards, multi-run exports, live/streaming
  logs). Summarize exactly one run's log at a time.
- The user wants a policy decision (quarantine a flaky test, change retry settings). The
  summary may inform that, but the decision is out of scope.

## Inputs

- **The CI log file**, somewhere in the workspace. The user or prompt names the path
  (commonly `ci.log` at the root or under `logs/`).
- **Optional `ci-job.json`** at the workspace root: CI step metadata shaped like
  `{"job": "...", "command": "...", "exit_code": 1}`. When present, it is admissible
  evidence for `failing_command`.

Runtime expectations (documented, not enforced): this skill's scripts require `bun` on PATH
and are run as `bun <script>.ts`. The procedure needs file read/write and local shell
execution only — **no network access**, and nothing here ever modifies repository files.

## Procedure

1. Locate the log (and `ci-job.json`, if present) in the workspace.
2. Run the deterministic preprocessor instead of reading the whole log:

   ```sh
   bun .poolside/skills/ci-log-reducer/scripts/extract_failure_windows.ts --log <log_path>
   ```

   (When the skill lives elsewhere, adjust the prefix; `--context N` widens windows,
   default 20.) It emits failure windows with true 1-based line numbers and verbatim text —
   cite from these pairs and the line numbers cannot be wrong.
3. Identify the **authoritative failure** among the windows. Windows are hints and
   over-capture by design:
   - Prefer the last hard failure before the run's terminal lines; confirm against the
     runner epilogue (`test result:`, `N failed`, `exit code ...`).
   - Beware decoys: passing tests can print ERROR-looking output (especially under
     `--nocapture` or verbose modes). Check the enclosing test's own verdict (`... ok` vs
     `... FAILED`) and the suite summary before citing a line as the failure.
   - With retried steps, prefer failures that reproduce in the final attempt; call
     earlier-only failures flaky in the summary.
   - If several distinct failures exist, cover **all** of them — never stop at the first.
4. **CRITICAL: Copy `text` fields character-for-character from the preprocessor output.**
   The validator byte-compares each `text` against the actual log line. Any difference —
   extra whitespace, trimmed whitespace, paraphrasing, normalization, escape-sequence
   changes — will fail the verbatim check. If the preprocessor emitted the line, use that
   exact string; if you read the log directly, copy the full line with all leading/trailing
   whitespace and special characters preserved.
5. Write the artifact per the Output contract below.
6. Validate, and repair at most once (next two sections).

## Output contract

Write exactly one JSON object to **`.laguna/ci-log-summary.json`** at the workspace root
(create `.laguna/` if needed), valid against
[`schemas/ci-log-summary.schema.json`](schemas/ci-log-summary.schema.json):

- `schema_version` — `"ci-log-summary.v1"`
- `log_file` — workspace-relative path of the analyzed log
- `failing_command` — the command that failed, supported by log or `ci-job.json`
- `failure_kind` — `test_failure | build_error | lint_error | infra_error | other`
- `summary` — ≤600 chars, covering every distinct failure
- `error_lines` — 1–20 `{line, text}` pairs; `line` is 1-based integer, `text` is the
  **exact verbatim string** from that line number in the log, with all whitespace and
  characters preserved byte-for-byte
- `suggested_next_commands` — 1–5 safe, local commands (no network: no installs, fetches,
  pushes; nothing destructive: no `rm`, hard resets, `sudo`)

### Critical `error_lines` requirements

Each `{line, text}` pair must satisfy:

- `line` is the 1-based line number in the log file where `text` appears.
- `text` is the **complete, unmodified line** from the log at that line number:
  - Do NOT trim leading or trailing whitespace.
  - Do NOT normalize tabs, escape sequences, or control characters.
  - Do NOT paraphrase, summarize, or abbreviate.
  - Do NOT add or remove quotes, brackets, or any other characters.
  - If the preprocessor output included the line, copy its `text` field exactly.
  - If reading the log directly, copy the entire line as-is.

**Example of CORRECT verbatim copying** (log line 54 is `"            got: 0"`):
```json
{ "line": 54, "text": "            got: 0" }
```

**Example of INCORRECT copying** (whitespace trimmed):
```json
{ "line": 54, "text": "got: 0" }
```
This will fail validation even though the content words match.

A summary that only appears in the chat message does not exist for grading — the file must
be on disk. Mention in your final message that you wrote it and what the verdict was.

## Validation

Run the skill's own validator after writing the artifact:

```sh
bun .poolside/skills/ci-log-reducer/scripts/validate_log_summary.ts \
  --workspace . --out .laguna/validator-result.json
```

(Harness and CI invoke the same script with an extra `--case <case_dir>` flag.) It writes a
`validator-result.v1` JSON to `--out` and exits 0 whenever a result was written — read the
verdict from the file's `status` field, not the exit code. `checks[]` says exactly what
passed; `repair_feedback[]` lists what to fix.

## Repair

At most **one** repair attempt. Act only on `repair_feedback` and schema errors:

- **For "Verbatim mismatch" errors:** The validator will report the line number and what the
  log actually says. Open the log file, navigate to that exact line number, and copy the
  entire line character-for-character into the `text` field. Do not guess or paraphrase.
- **For schema errors:** Correct the type, range, or format of the named field.
- Change nothing unrelated to the reported errors.
- Re-run the validator once after fixing.
- If it still fails, stop and escalate; do not loop.

## Escalation

Stop and report instead of guessing when:

- the log contains no failure indicators (`match_count` is 0) yet CI is reported red;
- the log is truncated before any failure appears;
- the evidence is contradictory (e.g. a success epilogue but a red pipeline).

Say precisely what is missing or contradictory, write no artifact with invented content, and
route the case to a human or a stronger model (M.1) with the log path and what you checked.

## Examples

Minimal — single pytest failure (`ci.log`, 24 lines):

```json
{
  "schema_version": "ci-log-summary.v1",
  "log_file": "ci.log",
  "failing_command": "uv run pytest -q",
  "failure_kind": "test_failure",
  "summary": "tests/test_retry_config.py::test_parse_retry_config_defaults fails: parse_retry_config({}) now defaults max_retries to 5, test expects 3. 35 other tests pass.",
  "error_lines": [
    { "line": 17, "text": "E       assert 5 == 3" },
    { "line": 22, "text": "FAILED tests/test_retry_config.py::test_parse_retry_config_defaults - assert 5 == 3" }
  ],
  "suggested_next_commands": ["uv run pytest tests/test_retry_config.py -q"]
}
```

Realistic — retried `bun test` step where one failure is flaky and one persists: the summary
names the persistent failure as the cause and labels the flaky one, cites the failing lines
from the **final** attempt, and suggests `bun test src/cache/lru.test.ts` plus a
`--rerun-each` run for the flaky suspect. See
`evals/ci-log-reducer-bun-flaky-retry/expected/.laguna/ci-log-summary.json` for the full
artifact.