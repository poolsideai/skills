Review the Beads graph and determine what to work on next. Run the Beads CLI robot output through the fixture wrappers in `bin/`:

```sh
PATH="$PWD/bin:$PATH" bv --robot-triage
```

Write your selection to `.laguna/bead-selection.json` with the selected Bead (or 'none'), graph evidence, commands used, and a safe next action. Do not mutate the backlog.
