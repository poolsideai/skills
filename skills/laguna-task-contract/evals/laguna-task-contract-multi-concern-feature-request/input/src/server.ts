// HTTP server and request handling

import { createUser, getUser } from './user.ts';

export function handleCreateUser(req: Request): Response {
  try {
    const body = req.json();
    const user = createUser(body.email, body.password);
    return new Response(JSON.stringify(user), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    // Generic error handler - needs improvement
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export function handleGetUser(req: Request, userId: string): Response {
  const user = getUser(userId);
  if (!user) {
    return new Response(JSON.stringify({ error: 'User not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify(user), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
