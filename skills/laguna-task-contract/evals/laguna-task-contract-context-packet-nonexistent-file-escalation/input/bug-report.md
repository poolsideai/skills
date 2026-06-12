# Bug Report: Database Connection Timeout

**Reporter**: @alex (backend-team)
**Priority**: P0
**Timestamp**: 2024-01-15 14:32 UTC

## Summary

Production database connections are timing out after 30 seconds when the connection pool is exhausted. This started happening after yesterday's deploy of the query optimization changes.

## Details

The connection manager in `src/database/connection.ts` is not properly releasing connections back to the pool when queries complete. This causes the pool to drain over time until all connections are held and new requests time out.

Full error log is available at `logs/query-error.log` showing the sequence of timeout failures.

## Reproduction

1. Start the application with default connection pool settings (max 10 connections)
2. Run concurrent query workload (>10 simultaneous requests)
3. Observe connection pool exhaustion within 2-3 minutes
4. New requests begin timing out with "connection pool exhausted" errors

## Expected Behavior

Connections should be released back to the pool immediately after query completion, regardless of whether the query succeeded or failed.

## Actual Behavior

Connections are released only on successful queries. Failed queries leave the connection in a held state, never returning it to the pool.

## Impact

Critical: production API is degraded, 30% of requests timing out during peak hours.

## Suspected Root Cause

The error handling path in the connection manager's `executeQuery` method is missing a `finally` block to ensure connection release.
