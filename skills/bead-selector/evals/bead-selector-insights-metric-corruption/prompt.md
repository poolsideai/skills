Choose the best Bead to work on next. The graph insights show some nodes with corrupted metrics. Use the Beads CLI robot output through the fixture wrappers in `bin/` to determine the correct selection:

```sh
PATH="$PWD/bin:$PATH" bv --robot-triage
```

If the triage output seems incomplete, run the insights command to cross-validate:

```sh
PATH="$PWD/bin:$PATH" bv --robot-insights
```

Write `.laguna/bead-selection.json` with the selected Bead, graph evidence, rejected candidates, commands used, and the safe next action.
