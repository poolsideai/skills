---
name: repo-map
description: >-
  Map an unfamiliar repository into a small, evidence-backed JSON repo map
  written to .laguna/repo-map.json. Use when asked to orient in a new or
  unfamiliar codebase, summarize repository structure, identify the languages,
  frameworks, entrypoints, or key directories, figure out how to run the
  tests, or produce an onboarding or handover map for a teammate or agent.
  Every claim is mechanically checked: all paths must exist in the tree,
  framework claims cite a dependency manifest (never prose), and test
  commands must be supported by repo files. Do not use to modify code, review
  code quality, or write deep architecture analysis.
metadata:
  version: "0.1.0"
---

# Repo Map

## Purpose

Turn one repository into a small, machine-checkable JSON map: what it is, the languages in
the tree, the frameworks it actually depends on, where execution starts, which directories
matter, and how to run the tests. Every claim must survive a mechanical audit against the
tree, so evidence beats narrative.

## Use when

- Someone (or an agent) needs to orient in a new, unfamiliar, or inherited codebase: "what
  is this repo", "where does it start", "how do I run the tests".
- An onboarding or handover doc is needed in a structured, citable form rather than prose.
- A downstream task (planning, routing, automation) needs a trustworthy structural summary
  of the repository it is about to work in.

## Do not use when

- The task is to **change** the repo — fix bugs, refactor, add features. This skill only
  observes; it writes nothing outside `.laguna/`.
- The user wants architecture critique, code review, or design recommendations. The map
  records what exists, not what should.
- There is no repository in the workspace, or only documentation. Never build a map from a
  README, a paraphrase, or memory — the tree is the only admissible source.
- The target is many repositories at once. Map exactly one repository (one workspace root)
  per artifact.
- The question is about dependency health (upgrades, vulnerabilities, license audits) —
  that needs different evidence than this map carries.

## Inputs

- **The repository tree** at the workspace root. That tree is the entire ground truth.
- Documentation in the tree (README, docs/) may *suggest* what to look for, but is never
  evidence: docs go stale and sometimes describe components that no longer exist.

Evidence rules this skill defines (enforced by the validator):

- **Language claims** cite one representative source file; its extension (or basename, for
  `Dockerfile`/`Makefile`) must match the language, and the name must be a canonical
  lowercase one (`python`, `typescript`, `javascript`, `rust`, `go`, `shell`, ... — the full
  table is `KNOWN_LANGUAGES` in `scripts/validate_repo_map.ts`).
- **Framework claims** cite a dependency manifest or framework config file that names the
  framework — `package.json`, `pyproject.toml`, `requirements*.txt`, `Cargo.toml`,
  `go.mod`, `Gemfile`, `pom.xml`, `*.config.{js,ts,mjs,cjs}`, and similar. Prose files are
  never admissible evidence.
- **Test commands** must be supported by repo files: a pytest command needs pytest
  config/test files, `bun test` needs `*.test.*` files or a package.json test script,
  `cargo test` needs `Cargo.toml`, `go test` needs `go.mod` or `*_test.go`, `make <target>`
  needs that Makefile target — or the verbatim command appears in package.json scripts, a
  Makefile, or a justfile.

Runtime expectations (documented, not enforced): this skill's scripts require `bun` on PATH
and are run as `bun <script>.ts`. The procedure needs file read/write and local shell
execution only — **no network access**, and nothing here ever modifies repository files;
the only writes are under `.laguna/`.

## Procedure

1. Run the deterministic fact collector instead of wandering the tree:

   ```sh
   bun .poolside/skills/repo-map/scripts/collect_repo_facts.ts --root .
   ```

   (When the skill lives elsewhere, adjust the prefix; `--out <path>` writes the JSON to a
   file.) It emits languages by file count, manifests, framework mentions found *inside
   manifests*, candidate entrypoints, test evidence, and top-level directories.
2. Treat the facts as hints, not the answer. They over-capture (a framework mention may be
   a dev-only tool; a `main.py` may be dead code) and under-capture (the fixed framework
   list misses niche libraries — read the manifests directly for anything significant the
   collector did not surface).
3. Cross-check documentation against the tree and **trust the tree**. If a README describes
   a directory, framework, or command that the tree does not support, leave it out of the
   map's claims — and note the discrepancy in `summary` so the reader is warned.
4. Choose the entries deliberately: entrypoints where execution actually starts (mains,
   `bin` targets, server app objects), key directories someone must know (not every
   folder), and test commands phrased the way this repo runs them (e.g. `uv run pytest -q`
   in a uv project) while staying inside the support rules above.
5. Write the artifact per the Output contract. Cover every major component the tree shows;
   use the empty array for `frameworks`/`test_commands` when the repo genuinely has none —
   never pad.
6. Validate, and repair at most once (next two sections).

## Output contract

Write exactly one JSON object to **`.laguna/repo-map.json`** at the workspace root (create
`.laguna/` if needed), valid against
[`schemas/repo-map.schema.json`](schemas/repo-map.schema.json):

- `schema_version` — `"repo-map.v1"`
- `summary` — ≤500 chars: what the repo is and does, per the tree
- `languages` — 1–10 `{name, evidence}` pairs; evidence is an existing file of that language
- `frameworks` — 0–15 `{name, evidence}` pairs; evidence is an existing manifest that names
  the framework
- `entrypoints` — 1–10 `{path, description}` pairs; every path an existing file
- `key_directories` — 1–15 `{path, role}` pairs; every path an existing directory
- `test_commands` — 0–5 commands, each supported by repo files

A map that only appears in the chat message does not exist for grading — the file must be
on disk. Mention in your final message that you wrote it and what the validator said.

## Validation

Run the skill's own validator after writing the artifact:

```sh
bun .poolside/skills/repo-map/scripts/validate_repo_map.ts \
  --workspace . --out .laguna/validator-result.json
```

(Harness and CI invoke the same script with an extra `--case <case_dir>` flag.) It writes a
`validator-result.v1` JSON to `--out` and exits 0 whenever a result was written — read the
verdict from the file's `status` field, not the exit code. `checks[]` says exactly what
passed; `repair_feedback[]` lists what to fix.

## Repair

At most **one** repair attempt. Act only on `repair_feedback` and schema errors: correct
the named claims in `.laguna/repo-map.json` (fix the path, cite a real manifest, drop the
unsupported command), change nothing unrelated, re-run the validator once. If it still
fails, stop and escalate; do not loop.

## Escalation

Stop and report instead of guessing when:

- the workspace is empty, has no source files, or is plainly not a repository;
- the collector reports `truncated: true` and the visible slice is not representative;
- the tree contradicts itself in ways you cannot resolve (e.g. a workspace manifest lists
  members that do not exist).

Say precisely what is missing or contradictory, write no artifact with invented content,
and route the case to a human or a stronger model (M.1) with what you observed.

## Examples

Minimal — single-language Python service:

```json
{
  "schema_version": "repo-map.v1",
  "summary": "shortlinks is a small internal URL shortener: a FastAPI HTTP API over an in-memory store. Tests run with pytest.",
  "languages": [{ "name": "python", "evidence": "src/shortlinks/main.py" }],
  "frameworks": [{ "name": "fastapi", "evidence": "pyproject.toml" }],
  "entrypoints": [
    { "path": "src/shortlinks/main.py", "description": "FastAPI app; `uv run uvicorn shortlinks.main:app`" }
  ],
  "key_directories": [
    { "path": "src/shortlinks", "role": "application source" },
    { "path": "tests", "role": "pytest suite" }
  ],
  "test_commands": ["uv run pytest -q"]
}
```

Realistic — mixed-language CLI with no frameworks and colocated tests: the map names the
`bin`-declared entrypoint, both languages with matching evidence files, `frameworks: []`
(no padding), and `bun test` supported by `package.json` and `src/lib/parse.test.ts`. See
`evals/repo-map-bun-cli-workspace/expected/.laguna/repo-map.json` for the full artifact.
