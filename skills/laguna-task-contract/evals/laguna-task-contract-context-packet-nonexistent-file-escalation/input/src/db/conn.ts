/**
 * Database connection manager
 * Handles connection pooling and query execution
 */

import { Pool, PoolClient } from 'pg';

const pool = new Pool({
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

export class ConnectionManager {
  async executeQuery(query: string, params: unknown[] = []): Promise<unknown> {
    const client: PoolClient = await pool.connect();
    try {
      const result = await client.query(query, params);
      client.release();
      return result.rows;
    } catch (error) {
      // BUG: connection not released on error path
      console.error('Query failed:', error);
      throw error;
    }
  }

  async getPoolStats() {
    return {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    };
  }
}

export const connectionManager = new ConnectionManager();
