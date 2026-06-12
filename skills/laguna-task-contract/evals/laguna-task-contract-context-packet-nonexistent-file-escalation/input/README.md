# Database Service

Core database access layer for the application.

## Structure

- `src/db/` - database connection and query management
- `src/models/` - data models and schemas
- `tests/` - unit and integration tests

## Running Tests

```bash
npm test
```

## Configuration

Connection pool settings are configured via environment variables:
- `DB_POOL_MAX` - maximum pool size (default: 10)
- `DB_POOL_IDLE_TIMEOUT` - idle connection timeout in ms (default: 30000)
