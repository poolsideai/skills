# CASS-Mined Bead Polish Examples

These examples were mined from local agent history with the `cass` skill. They
are seed material for Beads workflow/bootstrap work: use them to teach Laguna
what a good Beads polishing run looks like before converting them into full
validator-backed eval cases.

## Selection Criteria

Good examples have all of these properties:

- The prompt scopes the bead graph tightly and names the allowed target IDs.
- The agent uses `br` for bead inspection/mutation and `bv --robot-*` for graph
  evidence.
- Mutations improve implementation readiness without re-triaging unrelated work.
- The agent verifies the result with `br lint`, `br dep cycles`, and BV robot
  analysis.
- The final answer distinguishes what changed, why, ready frontier, and
  concurrency cautions.

## Example 1: Artifact Viewer Hardening Polish

Source:

- Agent: Claude Code
- Session: `/home/ben/.claude/projects/-data-projects-poolside-studio/987efd12-182a-422a-bc8d-adda6a481ae0.jsonl`
- Workspace: `/data/projects/poolside-studio`
- Session title: `Polish artifact viewer pane hardening bead graph`

### Input Prompt Pattern

The user supplied a parent epic, four lane epics, and nine implementation beads,
then constrained the run:

```text
Use only `br` and `bv --robot-*` commands to carefully review and polish only
this artifact viewer pane hardening bead graph.
```

The prompt explicitly asked the agent to check:

- scope tightness;
- dependency correctness;
- file ownership boundaries;
- first red tests;
- VPS/browser/Electron verification realism;
- hidden conflicts that should become dependencies or sequencing notes;
- missing Oracle findings;
- accidental scope expansion.

It also required:

```text
After polishing, run:
- br lint on only the hardening bead IDs
- br dep cycles --json
- bv --robot-insights
```

### Important Tool Pattern

The run inspected every target bead with `br show`, then used focused `br update
--notes` mutations. It did not mutate unrelated beads.

The best mutation pattern was adding file-ownership and sequencing notes, for
example:

```bash
br update bd-latest-intent-file-open-requests-b5pt --notes "Sequencing: This bead is a gating prerequisite for bd-workspace-keyed-browser-loads-reset-gbk9. Both beads edit src/app/shell/artifact-viewer-controller.svelte.ts and tests/ui/artifact-viewer-controller.test.ts; this bead must land first so workspace-keyed can reuse #openRequestId via resetWorkspaceState (the workspace bead invalidates this bead's open-request generation rather than inventing a parallel stale-completion guard). Scope here is strictly open()/openArtifact/openFilePath plus the #openRequestId machinery; do not pre-implement file-browser request tokens, resetWorkspaceState body, or shell workspace-change effects. Test additions are append-only."
```

The most important self-correction was that the agent initially described two
beads as parallel, re-checked the real dependency graph, noticed the edge, and
rewrote the notes as a sequence. A good evaluator should reward that repair.

### Good Output Shape

The final response had these sections:

- `What changed`: four target beads received `Notes:` blocks.
- `Why`: notes reduce swarm conflict risk by making shared-file ownership
  explicit.
- `Verification`: `br lint` clean, `br dep cycles --json` zero cycles,
  `bv --robot-insights` showed no hardening-subgraph orphan/bottleneck surprises.
- `Ready for swarm implementation`: yes, with 14 beads and 0 cycles.
- `Beads ready to claim first`: six wave-1 implementation beads.
- `Cautions for concurrent agents`: shared controller file, shared pane file,
  append-only tests, uncommitted working tree, VPS preflight.

### Grader Implications

An eval based on this example should require the model to:

- keep `touched_ids` within the target graph;
- record `commands_used` including `br show`, `br update`, `br lint`,
  `br dep cycles --json`, and `bv --robot-insights`;
- add notes only where they reduce real graph or ownership ambiguity;
- identify the ready frontier;
- explicitly reject or repair an incorrect parallelization claim if dependencies
  contradict it;
- preserve unrelated bead graphs.

## Example 2: Plan Review To Good Beads

Source:

- Agent: Claude Code
- Session: `/home/ben/.claude/projects/-data-projects-poolside-studio/78de6693-5add-410f-b42b-b3217d2e22b1.jsonl`
- Workspace: `/data/projects/poolside-studio`
- Session title: `Review Electron WebContentsView artifact viewer plan`

### Why This Is Useful

This was not a `br update` polish run, but it produced the high-quality plan
review that later became the polished artifact-viewer bead graph. It is useful as
the "pre-beads" side of the before/after pair.

The review identified issues that good beads later preserved:

- per-artifact storage isolation;
- CSP/runtime placement;
- symlink-aware traversal defense;
- Electron protocol/session API nuance;
- streaming or explicit size constraints;
- same-artifact navigation carve-outs;
- thumbnail timing;
- schema versioning;
- non-optional `shell.openExternal` policy.

### Grader Implications

When an eval gives Laguna a plan plus existing beads, the expected polish should
not merely restate the plan. It should move concrete review findings into
implementation-ready bead acceptance criteria, red tests, sequencing, and
verification commands.

## Example 3: Good Bead Style Pack

Source:

- Agent: Codex
- Session: `/home/ben/.codex/sessions/2026/06/06/rollout-2026-06-06T16-52-06-019e9dd9-54ff-7d01-99b1-d44240f99073.jsonl`
- Workspace: `/data/projects/skills`
- Artifact found in session: `# Good Bead Examples`

### Why This Is Useful

The session included a portable taste reference for well-shaped beads. The best
examples showed parent/PR-slice beads and child implementation beads with:

- background and rationale;
- implementation slicing notes;
- explicit scope and non-goals;
- acceptance criteria;
- validation commands;
- expected files likely touched;
- blocking prerequisites;
- parallelization notes.

### Grader Implications

A Beads polishing eval should score higher when the output converts vague work
into these fields, especially:

- "what this bead owns";
- "what this bead must not do";
- "first red tests";
- "validation commands";
- dependency and parallelization notes grounded in the actual graph.

