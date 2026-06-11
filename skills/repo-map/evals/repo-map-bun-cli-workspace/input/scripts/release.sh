#!/usr/bin/env bash
# Cut a release tarball into dist/. Local only; CI handles publishing.
set -euo pipefail

version="$(bun -e 'console.log(JSON.parse(await Bun.file("package.json").text()).version)')"
mkdir -p dist
tar -czf "dist/tidy-csv-${version}.tar.gz" src package.json README.md
echo "wrote dist/tidy-csv-${version}.tar.gz"
