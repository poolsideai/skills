# tidy-csv

Command-line tool for cleaning up CSV files: dedupe rows, compute per-column
stats, normalize line endings.

```sh
bun src/cli.ts dedupe data.csv
bun src/cli.ts stats data.csv
```

Releases are cut with `scripts/release.sh`.
