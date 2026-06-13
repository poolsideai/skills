Choose the best Bead to work on next. Some Beads are blocked on work in other repositories that cannot be addressed in this workspace. Identify which Beads are actionable locally.

Use the Beads CLI robot output through the fixture wrappers:

```sh
PATH="$PWD/bin:$PATH" bv --robot-triage
```

Write `.laguna/bead-selection.json` with the selected Bead, graph evidence, rejected candidates, commands used, and the safe next action.
