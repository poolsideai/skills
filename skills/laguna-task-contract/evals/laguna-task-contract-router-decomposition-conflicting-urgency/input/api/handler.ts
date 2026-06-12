/**
 * Main API request handler
 * Routes incoming requests to appropriate service endpoints
 */

import { Request, Response } from 'express';
import { validateAuth } from './auth';
import { queryDatabase } from './database';
import { checkRateLimit } from './rate-limiter';

export function handleRequest(req: Request, res: Response) {
  // TODO: This handler has grown organically and needs refactoring
  // Nested callbacks make error handling inconsistent
  validateAuth(req.headers.authorization, (authErr: Error | null, user: any) => {
    if (authErr) {
      console.log('Auth failed:', authErr.message);
      return res.status(401).json({ error: 'Unauthorized' });
    }
    checkRateLimit(user.id, (rateLimitErr: Error | null, allowed: boolean) => {
      if (rateLimitErr) {
        console.log('Rate limit check failed:', rateLimitErr);
        return res.status(500).json({ error: 'Internal error' });
      }
      if (!allowed) {
        return res.status(429).json({ error: 'Rate limit exceeded' });
      }
      if (req.method === 'GET') {
        queryDatabase('SELECT * FROM resources WHERE user_id = $1', [user.id], (dbErr: Error | null, rows: any[]) => {
          if (dbErr) {
            console.error('DB query failed:', dbErr);
            return res.status(500).json({ error: 'Database error' });
          }
          res.json({ data: rows });
        });
      } else if (req.method === 'POST') {
        const payload = req.body;
        queryDatabase('INSERT INTO resources (user_id, data) VALUES ($1, $2)', [user.id, payload], (dbErr: Error | null, result: any) => {
          if (dbErr) {
            console.error('DB insert failed:', dbErr);
            return res.status(500).json({ error: 'Database error' });
          }
          res.status(201).json({ id: result.insertId });
        });
      } else {
        res.status(405).json({ error: 'Method not allowed' });
      }
    });
  });
}

export function handleHealthCheck(req: Request, res: Response) {
  res.json({ status: 'ok', timestamp: Date.now() });
}
