/**
 * Application entry point
 * Starts HTTP server and database connection pool
 */

const http = require('http');
const { Pool } = require('pg');
const { createQueryBuilder } = require('./db/query');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'appdb',
  max: 20,
});

const queryBuilder = createQueryBuilder(pool);

const server = http.createServer(async (req, res) => {
  if (req.url === '/users') {
    try {
      const users = await queryBuilder.select({
        table: 'users',
        columns: ['id', 'name', 'email'],
        limit: 100,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(users));
    } catch (error) {
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

process.on('SIGINT', () => {
  pool.end();
  server.close();
  process.exit(0);
});
