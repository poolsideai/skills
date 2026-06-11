# User Service API

A simple user management service.

## Installation

```bash
npm install
npm run dev
```

## API Endpoints

### POST /users

Create a new user account.

**Request body:**
```json
{
  "email": "user@example.com",
  "password": "secret123"
}
```

**Response (201 Created):**
```json
{
  "id": "abc123",
  "email": "user@example.com",
  "passwordHash": "...",
  "createdAt": "2024-01-15T10:30:00Z"
}
```

### GET /users/:id

Retrieve a user by ID.

**Response (200 OK):**
```json
{
  "id": "abc123",
  "email": "user@example.com",
  "passwordHash": "...",
  "createdAt": "2024-01-15T10:30:00Z"
}
```

**Response (404 Not Found):**
```json
{
  "error": "User not found"
}
```

## Error Handling

All errors return a 500 status with a generic error message.
