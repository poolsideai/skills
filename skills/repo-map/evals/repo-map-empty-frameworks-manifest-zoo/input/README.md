# polyglot-demos

A collection of "hello world" style demonstrations in five languages:
TypeScript, Python, Rust, Go, and Ruby. Each language has a simple main
program that prints a greeting.

This repository exists to showcase build and lint configurations across
multiple ecosystems. No frameworks are used—just standard library I/O.

## Running

```sh
# TypeScript
bun src/typescript/main.ts

# Python
python src/python/main.py

# Rust
cargo run --bin rust-demo

# Go
go run src/go/main.go

# Ruby
ruby src/ruby/main.rb
```

## Development

Each language has its own linter and formatter configured:

- TypeScript: ESLint + Prettier
- Python: Black + mypy
- Rust: rustfmt + clippy
- Go: gofmt + go vet
- Ruby: RuboCop

## Testing

Run `bun test` for the TypeScript test, `pytest` for Python tests, and
`make test` for the full suite.
