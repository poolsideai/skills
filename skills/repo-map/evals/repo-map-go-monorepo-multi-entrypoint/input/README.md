# Platform Services

Monorepo for the core platform backend services:

- **api-server**: HTTP API gateway, routes requests to workers
- **worker**: Background job processor, pulls tasks from queue
- **migrate**: Database schema migration tool

All three binaries share the `internal/` packages for database access, logging,
and configuration.

## Development

Build all binaries:

```sh
go build -o bin/api-server ./cmd/api-server
go build -o bin/worker ./cmd/worker
go build -o bin/migrate ./cmd/migrate
```

Run tests:

```sh
make test
```

The migrate tool applies schema changes:

```sh
./bin/migrate up
```
