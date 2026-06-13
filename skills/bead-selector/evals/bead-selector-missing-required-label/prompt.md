Select a Bead to work on for the 'critical-bug' label. Use the Beads CLI robot output through the fixture wrappers in `bin/`:

```sh
PATH="$PWD/bin:$PATH" bv --robot-triage
```

Write `.laguna/bead-selection.json` with the selected Bead, graph evidence, rejected candidates, commands used, and the safe next action. Do not mutate the backlog.
