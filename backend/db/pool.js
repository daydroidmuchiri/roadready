/**
 * RoadReady — PostgreSQL Connection Pool
 *
 * Uses node-postgres (pg) with connection pooling.
 * All queries go through this module — never create raw Client instances elsewhere.
 */

const { Pool } = require('pg');
const { resolveSslConfig } = require('./connectionConfig');

// ─── Pool configuration ───────────────────────────────────────────────────────

const connectionString = process.env.DATABASE_URL;
const connectionTimeoutMillis = Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000);

const pool = new Pool({
  connectionString,

  // SSL: auto-enable for managed remote hosts like Railway, or via DATABASE_SSL=true
  ssl: resolveSslConfig(connectionString),

  // Pool sizing
  max:              10,     // max concurrent connections
  min:              2,      // keep at least 2 connections warm
  idleTimeoutMillis:  30000,  // close idle connections after 30s
  connectionTimeoutMillis,  // remote managed DBs can take longer than localhost
  allowExitOnIdle:  false,
});

// ─── Event listeners ─────────────────────────────────────────────────────────

pool.on('connect', (client) => {
  // Set the timezone on every new connection
  client.query("SET timezone = 'Africa/Nairobi'");
});

pool.on('error', (err) => {
  console.error(JSON.stringify({
    level: 'ERROR', event: 'pg_pool_error',
    message: err.message, code: err.code,
    timestamp: new Date().toISOString(),
  }));
  // Don't exit — the pool will attempt to reconnect automatically
});

// ─── Query helper ─────────────────────────────────────────────────────────────
// Wraps pool.query with structured logging.

async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;

    // Log slow queries (> 1 second) in production
    if (duration > 1000) {
      console.warn(JSON.stringify({
        level: 'WARN', event: 'slow_query',
        duration, rows: result.rowCount,
        query: text.slice(0, 100),
        timestamp: new Date().toISOString(),
      }));
    }

    return result;
  } catch (err) {
    console.error(JSON.stringify({
      level: 'ERROR', event: 'query_error',
      message: err.message, code: err.code,
      query: text.slice(0, 100),
      timestamp: new Date().toISOString(),
    }));
    throw err;
  }
}

// ─── Transaction helper ───────────────────────────────────────────────────────
// Usage:
//   const result = await transaction(async (client) => {
//     await client.query('INSERT INTO ...');
//     await client.query('UPDATE ...');
//     return something;
//   });

async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Health check ─────────────────────────────────────────────────────────────

async function checkConnection() {
  try {
    const result = await query('SELECT NOW() AS now, current_database() AS db');
    console.log(JSON.stringify({
      level: 'INFO', event: 'db_connected',
      db: result.rows[0].db,
      serverTime: result.rows[0].now,
      timestamp: new Date().toISOString(),
    }));
    return true;
  } catch (err) {
    console.error(JSON.stringify({
      level: 'ERROR', event: 'db_connection_failed',
      message: err.message,
      timestamp: new Date().toISOString(),
    }));
    return false;
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// Call this from your SIGTERM handler to drain the pool cleanly.

async function closePool() {
  await pool.end();
  console.log(JSON.stringify({ level: 'INFO', event: 'pg_pool_closed' }));
}

module.exports = { query, transaction, checkConnection, closePool, pool };
