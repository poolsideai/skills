Select the right Bead to work on next. Use robot-mode CLI evidence through the fixture wrappers in `bin/`:

```sh
PATH="$PWD/bin:$PATH" bv --robot-triage
```

Write `.laguna/bead-selection.json` with the selected Bead, graph evidence, rejected candidates, commands used, and the safe next action. Handle any malformed output gracefully and do not mutate the backlog.
