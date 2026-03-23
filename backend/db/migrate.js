/**
 * RoadReady — Database Migration Runner
 *
 * Usage:
 *   node db/migrate.js          — run all pending migrations
 *   node db/migrate.js --reset  — DROP and recreate everything (dev only)
 *   node db/migrate.js --status — show migration status
 */

require('dotenv').config();
const fs      = require('fs');
const path    = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// ─── Bootstrap migrations table ──────────────────────────────

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id           SERIAL      PRIMARY KEY,
      filename     VARCHAR(255) NOT NULL UNIQUE,
      applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checksum     VARCHAR(64)
    )
  `);
}

// ─── Get applied migrations ───────────────────────────────────

async function getApplied(client) {
  const result = await client.query('SELECT filename FROM _migrations ORDER BY id');
  return new Set(result.rows.map(r => r.filename));
}

// ─── Get all migration files ──────────────────────────────────

function getMigrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();    // alphabetical = chronological (001_, 002_, etc.)
}

// ─── Run pending migrations ───────────────────────────────────

async function migrate() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getApplied(client);
    const files   = getMigrationFiles();
    const pending = files.filter(f => !applied.has(f));

    if (pending.length === 0) {
      console.log('✓ No pending migrations — database is up to date.');
      return;
    }

    console.log(`Running ${pending.length} migration(s)...\n`);

    for (const filename of pending) {
      const filepath = path.join(MIGRATIONS_DIR, filename);
      const sql      = fs.readFileSync(filepath, 'utf8');

      console.log(`  → ${filename}`);
      const start = Date.now();

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO _migrations (filename) VALUES ($1)',
          [filename]
        );
        await client.query('COMMIT');
        console.log(`    ✓ Done in ${Date.now() - start}ms`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`    ✗ FAILED: ${err.message}`);
        console.error(`\n    Migration rolled back. Fix the error and run again.`);
        process.exit(1);
      }
    }

    console.log('\n✓ All migrations applied successfully.');
  } finally {
    client.release();
    await pool.end();
  }
}

// ─── Status ───────────────────────────────────────────────────

async function status() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getApplied(client);
    const files   = getMigrationFiles();

    console.log('\nMigration status:\n');
    for (const file of files) {
      const mark = applied.has(file) ? '✓' : '○';
      const label = applied.has(file) ? 'applied' : 'PENDING';
      console.log(`  ${mark} ${file}  [${label}]`);
    }
    console.log('');
  } finally {
    client.release();
    await pool.end();
  }
}

// ─── Reset (dev only) ─────────────────────────────────────────

async function reset() {
  if (process.env.NODE_ENV === 'production') {
    console.error('✗ Cannot reset in production. Aborting.');
    process.exit(1);
  }

  console.log('⚠️  Dropping all tables and re-running migrations...\n');
  const client = await pool.connect();
  try {
    // Drop everything in reverse dependency order
    await client.query(`
      DROP TABLE IF EXISTS payouts CASCADE;
      DROP TABLE IF EXISTS payments CASCADE;
      DROP TABLE IF EXISTS job_status_history CASCADE;
      DROP TABLE IF EXISTS jobs CASCADE;
      DROP TABLE IF EXISTS provider_profiles CASCADE;
      DROP TABLE IF EXISTS refresh_tokens CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
      DROP TABLE IF EXISTS services CASCADE;
      DROP TABLE IF EXISTS _migrations CASCADE;
      DROP TYPE IF EXISTS user_role CASCADE;
      DROP TYPE IF EXISTS user_status CASCADE;
      DROP TYPE IF EXISTS job_status CASCADE;
      DROP TYPE IF EXISTS payment_status CASCADE;
      DROP TYPE IF EXISTS onboard_status CASCADE;
      DROP SEQUENCE IF EXISTS job_seq CASCADE;
      DROP VIEW IF EXISTS job_details CASCADE;
      DROP VIEW IF EXISTS analytics_today CASCADE;
    `);
    console.log('✓ All tables dropped.\n');
  } finally {
    client.release();
    await pool.end();
  }

  // Re-create pool and run migrations fresh
  const pool2 = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  const client2 = await pool2.connect();
  try {
    await ensureMigrationsTable(client2);
    for (const filename of getMigrationFiles()) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
      console.log(`  → ${filename}`);
      await client2.query('BEGIN');
      try {
        await client2.query(sql);
        await client2.query('INSERT INTO _migrations (filename) VALUES ($1)', [filename]);
        await client2.query('COMMIT');
        console.log('    ✓');
      } catch (err) {
        await client2.query('ROLLBACK');
        console.error(`    ✗ FAILED: ${err.message}`);
        process.exit(1);
      }
    }
    console.log('\n✓ Reset complete.');
  } finally {
    client2.release();
    await pool2.end();
  }
}

// ─── CLI entry ────────────────────────────────────────────────

const arg = process.argv[2];
if (arg === '--reset')  reset().catch(err => { console.error(err); process.exit(1); });
else if (arg === '--status') status().catch(err => { console.error(err); process.exit(1); });
else migrate().catch(err => { console.error(err); process.exit(1); });
