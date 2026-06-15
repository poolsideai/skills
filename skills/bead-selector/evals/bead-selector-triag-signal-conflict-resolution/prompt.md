Select the best Bead to work on next from the local Beads graph. Use the fixture wrappers in `bin/` to run robot commands and gather evidence:

```sh
PATH="$PWD/bin:$PATH" bv --robot-triage
```

Write the selection to `.laguna/bead-selection.json` with the selected Bead, graph evidence, rejected candidates, commands used, and the safe next action. Do not mutate the backlog.
