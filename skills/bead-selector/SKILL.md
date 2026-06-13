---
name: bead-selector
description: >-
  Select the right Bead to work on using Beads robot-mode CLI evidence. Use
  when asked what Bead to pick next, which local issue is highest leverage,
  which blocker to clear, or how to choose work from a Beads graph. Produces a
  validator-checked .laguna/bead-selection.json artifact grounded in bv/br
  robot output, never the interactive bv TUI.
metadata:
  version: "0.1.0"
---

# Bead Selector

## Purpose

Choose one Bead from a local Beads graph using machine-readable `bv` and `br`
output. The selection must be auditable: which command was run, what graph or
readiness signal mattered, which tempting candidates were rejected, and what
the next safe command is.

This skill is for triage judgment, not backlog editing. It writes a small
`.laguna/bead-selection.json` artifact and does not claim or close work.

## Use when

- The user asks "what should I work on next?", "which Bead should I pick?", or
  "what is blocking the graph?"
- A task needs the highest-leverage unblocked Bead, a blocker, or a cycle-break
  candidate selected from Beads CLI evidence.
- A Laguna eval needs to test whether a model uses `bv --robot-*` instead of
  guessing from issue titles or priorities.

## Do not use when

- The task is to implement, claim, close, relabel, or rewrite Beads. This skill
  only selects and explains.
- There is no Beads CLI or fixture wrapper available. Do not invent graph
  output.
- The user asks for a full execution plan across many Beads. Use a planning or
  graph-management skill instead.
- The only safe answer is "none": write a selection artifact with
  `selected_bead.id` set to `"none"` only when robot output proves no actionable
  Bead is available.

## Inputs

- A repository or workspace with Beads data and `bv`/`br` available.
- Eval fixtures may provide `bin/bv` and `bin/br` wrappers. If present, use:

  ```sh
  PATH="$PWD/bin:$PATH" bv --robot-triage
  ```

  In normal workspaces, use the real `bv` and `br` on `PATH`.

Runtime expectations: this skill needs local shell execution and file writes
under `.laguna/`. It must never run bare `bv`, because that launches the TUI and
blocks agent execution.

## Procedure

1. Start with robot triage:

   ```sh
   bv --robot-triage
   ```

   In fixtures with `bin/`, prefix with `PATH="$PWD/bin:$PATH"`.
2. If the request asks for a single next task, use `bv --robot-next` when
   available, but still sanity-check blockers/readiness from triage.
3. If triage reports cycles, empty metrics, or a graph-health problem, run:

   ```sh
   bv --robot-insights
   ```

   Pick the cycle-break or graph-repair Bead before ordinary feature work when
   the robot output identifies one.
4. If the request names a label, area, file, or search phrase, use the matching
   robot command (`--robot-plan --label`, `--robot-label-attention`,
   `--robot-file-beads`, or `--robot-search`) and record that command.
5. Prefer ready and unblocked Beads over higher-ranked blocked Beads. A blocked
   high-PageRank Bead belongs in `rejected_candidates` unless the selected task
   is the blocker that clears it.
6. Write the output artifact and validate it.

## Output contract

Write exactly one JSON object to `.laguna/bead-selection.json`, valid against
[`schemas/bead-selection.schema.json`](schemas/bead-selection.schema.json):

- `schema_version`: `"bead-selection.v1"`
- `request`: short summary of the user's selection request
- `mode`: one of `next`, `triage`, `plan`, `search`, `cycle_break`,
  `label_focus`, or `none`
- `selected_bead`: `{id, title, status, reason}`; use `"none"` only when no
  actionable Bead exists
- `commands_used`: non-empty array of `{command, why}`; at least one command
  must be a `bv --robot-*` command and no command may be bare `bv`
- `graph_evidence`: `{primary_signal, signals, blockers, rejected_candidates}`
- `next_action`: `{command, destructive}`; normally a safe claim command such as
  `br update bd-123 --status in_progress`, but never execute it here
- `caveats`: array of short strings

The artifact is the graded output. A chat-only recommendation does not count.

## Validation

Run:

```sh
bun .poolside/skills/bead-selector/scripts/validate_bead_selection.ts \
  --workspace . --out .laguna/validator-result.json
```

Harness replay invokes the same validator with `--case <case_dir>`. The
validator checks schema shape, robot-mode usage, selected Bead id against case
gold when present, and whether expected robot commands/rejections are reflected
in the artifact.

Read `.laguna/validator-result.json`; a zero process exit means the result file
was written, not necessarily that the selection passed.

## Repair

At most one repair attempt. If validation fails, fix only the named problems:
the selected id, missing robot command, bare `bv`, missing evidence, or missing
rejected candidate. Re-run the validator once.

If the Beads CLI is absent, robot output is malformed, or the graph has no
actionable candidate, stop and report that rather than guessing.

## Example

```json
{
  "schema_version": "bead-selection.v1",
  "request": "Pick the next Bead to work on.",
  "mode": "next",
  "selected_bead": {
    "id": "bd-102",
    "title": "Stabilize validator result contract",
    "status": "open",
    "reason": "It is ready, has the highest PageRank among unblocked Beads, and unblocks two downstream tasks."
  },
  "commands_used": [
    {
      "command": "bv --robot-triage",
      "why": "Compared recommendations, blockers, and graph health."
    }
  ],
  "graph_evidence": {
    "primary_signal": "ready_high_pagerank",
    "signals": [
      { "bead_id": "bd-102", "metric": "pagerank", "value": 0.42, "source_command": "bv --robot-triage" },
      { "bead_id": "bd-102", "metric": "unblocks", "value": 2, "source_command": "bv --robot-triage" }
    ],
    "blockers": [],
    "rejected_candidates": [
      { "id": "bd-101", "reason": "Higher priority but blocked by bd-102." }
    ]
  },
  "next_action": { "command": "br update bd-102 --status in_progress", "destructive": false },
  "caveats": []
}
```
