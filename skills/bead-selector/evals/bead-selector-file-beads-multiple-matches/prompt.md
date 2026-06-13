Identify Beads related to src/utils/format.ts. Multiple Beads reference the same file with different scopes - one is a direct edit, another is an indirect usage. Use the Beads CLI to find the right one:

```sh
PATH="$PWD/bin:$PATH" bv --robot-file-beads --path src/utils/format.ts
```

Write `.laguna/bead-selection.json` with your selection, evidence, rejected candidates, commands used, and safe next action. Do not mutate the backlog.
