# Beads

Beads are optional in this checkout. The skills repo does not initialize a
repo-local Beads tracker, and there is no `.beads/` directory here.

Do not run `br init` or copy `.beads` from another checkout as part of ordinary
skills work. If this repo ever needs to own Beads state, decide that explicitly
first.

Beads appears in this repo in two bounded places:

- [`skills/bead-selector`](../skills/bead-selector/SKILL.md) is a gradeable
  skill for selecting a Bead from synthesized `bv`/`br` robot-mode output. Its
  eval suite builds fixture Beads graphs and does not need a live `.beads/`
  directory.
- The workbench onboarding page checks external Beads source skills under
  `~/.codex/skills/beads-bv` and `~/.codex/skills/beads-workflow`. Those paths
  live outside this checkout; missing paths should report as onboarding
  readiness failures, not repo-local Beads state.

For normal skill authoring, evals, bootstrap, and GEPA optimization, ignore
Beads unless you are working directly on `bead-selector` or onboarding checks.
