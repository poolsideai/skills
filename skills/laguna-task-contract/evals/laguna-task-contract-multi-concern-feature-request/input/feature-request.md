# Feature Request: Improve Error Handling Across User Flow

**From:** Product Team  
**Priority:** Medium  
**Target Release:** v2.3

## Description

We need to improve error handling across the user registration and authentication flow to provide better feedback to end users and reduce support tickets.

Specifically, we should add input validation to the user creation logic in `user.ts` to catch malformed email addresses and weak passwords before they hit the database. The error handler in `server.ts` needs to be refactored to properly propagate validation errors to the client with appropriate HTTP status codes instead of generic 500 errors. Finally, update the API documentation in `README.md` to reflect the new error response format and validation rules so frontend developers know what to expect.

This will make the user experience much smoother and reduce confusion when sign-ups fail.

## Acceptance Criteria

- Email validation rejects invalid formats
- Password strength requirements are enforced (min 8 chars, at least one number)
- Validation errors return 400 status with descriptive messages
- Server errors still return 500 for unexpected failures
- API docs describe error response schema and validation rules

## Files to Modify

- `src/user.ts`
- `src/server.ts`
- `README.md`
