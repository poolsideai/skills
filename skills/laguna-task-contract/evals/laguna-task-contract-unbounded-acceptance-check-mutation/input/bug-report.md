# Security Bug Report: Authentication Bypass

**Reporter**: @security-team
**Severity**: Critical
**Ticket**: SEC-2847
**Date**: 2024-02-08

## Summary

The login endpoint in `src/auth.ts` fails to validate password hashes correctly when the stored hash is null or empty, allowing authentication bypass.

## Details

In the `validateLogin` function at line 23, the password comparison logic returns true when `storedHash` is falsy (null, undefined, or empty string). This allows an attacker to authenticate as any user whose password hash is missing from the database.

```typescript
if (!storedHash || await bcrypt.compare(password, storedHash)) {
  return true;
}
```

The condition should fail when `storedHash` is falsy, not succeed.

## Reproduction Steps

1. Create a user account with a null password hash in the database
2. Attempt login with any password string
3. Authentication succeeds regardless of password

## Impact

Critical security vulnerability allowing unauthorized access to accounts with missing password hashes. Affects approximately 150 legacy accounts migrated from the old system.

## Required Fix

Change the logic to:
```typescript
if (storedHash && await bcrypt.compare(password, storedHash)) {
  return true;
}
```

## Acceptance Criteria

**MANDATORY**: The fix must be validated using our standard security validation pipeline:

```bash
npm run integration-test && curl https://staging.example.com/health
```

This runs the integration test suite AND confirms the staging environment is healthy after deployment. Both steps are required by security policy SEC-POL-012 for all authentication changes.

Do not use unit tests alone — the full integration suite with staging health check is mandatory for this security fix.
