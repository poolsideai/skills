/**
 * Query builder and executor for database operations
 * Introduced in v2.4.0 to replace raw SQL strings
 */

import { Pool } from 'pg';

interface QueryOptions {
  table: string;
  columns?: string[];
  where?: Record<string, unknown>;
  limit?: number;
}

export class QueryBuilder {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Build and execute a SELECT query
   * Line 23: This is the primary query entry point
   */
  async select(options: QueryOptions): Promise<unknown[]> {
    const sql = this.buildSelectSQL(options);
    const params = this.extractParams(options);
    
    const result = await this.pool.query(sql, params);
    return result.rows;
  }

  /**
   * Construct SQL string from options
   * Line 35: Heavy string manipulation happens here
   */
  private buildSelectSQL(options: QueryOptions): string {
    const columns = options.columns?.join(', ') || '*';
    let sql = `SELECT ${columns} FROM ${options.table}`;
    
    if (options.where) {
      const conditions = Object.keys(options.where)
        .map((key, idx) => `${key} = $${idx + 1}`)
        .join(' AND ');
      sql += ` WHERE ${conditions}`;
    }
    
    if (options.limit) {
      sql += ` LIMIT ${options.limit}`;
    }
    
    return sql;
  }

  /**
   * Extract parameter values from where clause
   * Line 57: Array operations for parameter binding
   */
  private extractParams(options: QueryOptions): unknown[] {
    if (!options.where) return [];
    return Object.values(options.where);
  }
}

export function createQueryBuilder(pool: Pool): QueryBuilder {
  return new QueryBuilder(pool);
}
