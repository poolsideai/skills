# Validation Service

A lightweight validation library for TypeScript/JavaScript with schema-based type enforcement.

## Features

- Schema validation with type checking
- Required field enforcement
- Automatic type coercion
- Nested object support

## Development

This project uses Bun as the runtime and test framework.

```bash
# Install dependencies
bun install

# Run tests
bun test

# Type check
bun run typecheck

# Lint
bun run lint
```

## Testing

Tests are written using Bun's built-in test runner. See `tests/` directory for test suites.

## CI

GitHub Actions workflow runs tests on every push and PR. See `.github/workflows/ci.yml` for configuration.
