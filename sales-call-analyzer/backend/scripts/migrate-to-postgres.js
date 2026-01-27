#!/usr/bin/env node
/**
 * Migration Script: SQLite to PostgreSQL
 *
 * This script exports data from your local SQLite database and imports it
 * into a PostgreSQL database.
 *
 * Usage:
 *   1. Set DATABASE_URL environment variable to your PostgreSQL connection string
 *   2. Run: node scripts/migrate-to-postgres.js
 *
 * The script will:
 *   - Read all data from local SQLite database
 *   - Create tables in PostgreSQL (if they don't exist)
 *   - Insert all data into PostgreSQL
 */

require('dotenv').config();
const { Pool } = require('pg');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const sqliteDbPath = path.join(__dirname, '..', 'database.sqlite');

// Check for DATABASE_URL
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is not set.');
  console.error('');
  console.error('Set it to your PostgreSQL connection string, e.g.:');
  console.error('  export DATABASE_URL="postgresql://user:password@host:5432/database"');
  console.error('');
  console.error('You can get this from Railway after adding a PostgreSQL service.');
  process.exit(1);
}

// Check if SQLite database exists
if (!fs.existsSync(sqliteDbPath)) {
  console.error('ERROR: SQLite database not found at:', sqliteDbPath);
  console.error('Make sure you have local data to migrate.');
  process.exit(1);
}

const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function createPostgresTables(client) {
  console.log('Creating PostgreSQL tables...');

  // Transcripts table
  await client.query(`
    CREATE TABLE IF NOT EXISTS transcripts (
      id TEXT PRIMARY KEY,
      fireflies_id TEXT UNIQUE NOT NULL,
      call_title TEXT,
      call_datetime TIMESTAMP,
      duration_seconds INTEGER,
      rep_name TEXT,
      rep_email TEXT,
      participants TEXT,
      transcript_text TEXT,
      source_url TEXT,
      analysis_json TEXT,
      analysis_version INTEGER DEFAULT 0,
      analyzed_at TIMESTAMP,
      stripe_data TEXT,
      stripe_enriched_at TIMESTAMP,
      classification_override TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Sync log table
  await client.query(`
    CREATE TABLE IF NOT EXISTS sync_log (
      id SERIAL PRIMARY KEY,
      sync_type TEXT,
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      calls_fetched INTEGER DEFAULT 0,
      calls_new INTEGER DEFAULT 0,
      calls_updated INTEGER DEFAULT 0,
      status TEXT DEFAULT 'in_progress',
      error_message TEXT
    )
  `);

  // Users table
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'rep',
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_login TIMESTAMP,
      password_hash TEXT,
      password_set_at TIMESTAMP
    )
  `);

  // Magic links table
  await client.query(`
    CREATE TABLE IF NOT EXISTS magic_links (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP
    )
  `);

  // Sessions table
  await client.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Access requests table
  await client.query(`
    CREATE TABLE IF NOT EXISTS access_requests (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      decided_at TIMESTAMP,
      decided_by TEXT,
      notes TEXT,
      last_requested_at TIMESTAMP,
      password_hash TEXT
    )
  `);

  // Manual closes table
  await client.query(`
    CREATE TABLE IF NOT EXISTS manual_closes (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      company TEXT,
      website TEXT,
      rep TEXT NOT NULL DEFAULT 'Phil',
      close_date DATE NOT NULL,
      amount REAL,
      notes TEXT,
      linked_call_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Manual lifecycle overrides table
  await client.query(`
    CREATE TABLE IF NOT EXISTS manual_lifecycle_overrides (
      id TEXT PRIMARY KEY,
      call_id TEXT NOT NULL,
      prospect_email TEXT,
      status TEXT NOT NULL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Closing rate inclusions table
  await client.query(`
    CREATE TABLE IF NOT EXISTS closing_rate_inclusions (
      call_id TEXT PRIMARY KEY,
      included BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_by TEXT
    )
  `);

  // Changelog entries table
  await client.query(`
    CREATE TABLE IF NOT EXISTS changelog_entries (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      details TEXT,
      tag TEXT,
      is_published BOOLEAN NOT NULL DEFAULT FALSE,
      show_as_new_until DATE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      published_at TIMESTAMP
    )
  `);

  // Old analyzed_calls table
  await client.query(`
    CREATE TABLE IF NOT EXISTS analyzed_calls (
      id TEXT PRIMARY KEY,
      fireflies_id TEXT UNIQUE,
      title TEXT,
      date DATE,
      duration INTEGER,
      prospect_name TEXT,
      sales_rep TEXT,
      outcome TEXT,
      offer_pitched TEXT,
      overall_score INTEGER,
      pain_level INTEGER,
      analysis_json TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Pain points table
  await client.query(`
    CREATE TABLE IF NOT EXISTS pain_points (
      id SERIAL PRIMARY KEY,
      call_id TEXT,
      category TEXT,
      quote TEXT,
      intensity TEXT
    )
  `);

  // Customer language table
  await client.query(`
    CREATE TABLE IF NOT EXISTS customer_language (
      id SERIAL PRIMARY KEY,
      call_id TEXT,
      type TEXT,
      phrase TEXT,
      context TEXT
    )
  `);

  // DFY mentions table
  await client.query(`
    CREATE TABLE IF NOT EXISTS dfy_mentions (
      id SERIAL PRIMARY KEY,
      call_id TEXT,
      mentioned BOOLEAN,
      who_initiated TEXT,
      timestamp TEXT,
      reason TEXT,
      classification TEXT
    )
  `);

  // Objections table
  await client.query(`
    CREATE TABLE IF NOT EXISTS objections (
      id SERIAL PRIMARY KEY,
      call_id TEXT,
      type TEXT,
      quote TEXT,
      resolution_attempted TEXT,
      outcome TEXT
    )
  `);

  console.log('Tables created successfully.');
}

async function readSqliteTable(db, tableName) {
  try {
    const result = db.exec(`SELECT * FROM ${tableName}`);
    if (!result.length) return [];

    const columns = result[0].columns;
    const rows = result[0].values.map(row => {
      const obj = {};
      columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj;
    });

    return rows;
  } catch (err) {
    console.log(`  Table ${tableName} not found or empty`);
    return [];
  }
}

async function insertIntoPostgres(client, tableName, rows, columns) {
  if (!rows.length) {
    console.log(`  ${tableName}: No data to migrate`);
    return 0;
  }

  let insertedCount = 0;

  for (const row of rows) {
    try {
      const values = columns.map(col => {
        let val = row[col];
        // Handle boolean conversion for PostgreSQL
        if (typeof val === 'number' && (col === 'is_active' || col === 'included' || col === 'mentioned' || col === 'is_published')) {
          val = val === 1;
        }
        return val;
      });

      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
      const columnList = columns.join(', ');

      await client.query(
        `INSERT INTO ${tableName} (${columnList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
        values
      );
      insertedCount++;
    } catch (err) {
      console.error(`  Error inserting row into ${tableName}:`, err.message);
    }
  }

  console.log(`  ${tableName}: Migrated ${insertedCount} of ${rows.length} rows`);
  return insertedCount;
}

async function migrate() {
  console.log('');
  console.log('='.repeat(60));
  console.log('SQLite to PostgreSQL Migration');
  console.log('='.repeat(60));
  console.log('');

  // Initialize SQLite
  console.log('Loading SQLite database...');
  const SQL = await initSqlJs();
  const fileBuffer = fs.readFileSync(sqliteDbPath);
  const sqliteDb = new SQL.Database(fileBuffer);

  // Connect to PostgreSQL
  console.log('Connecting to PostgreSQL...');
  const pgClient = await pgPool.connect();

  try {
    // Create tables
    await createPostgresTables(pgClient);

    console.log('');
    console.log('Migrating data...');

    // Define tables and their columns
    const tablesToMigrate = [
      {
        name: 'users',
        columns: ['id', 'email', 'name', 'role', 'is_active', 'created_at', 'last_login', 'password_hash', 'password_set_at']
      },
      {
        name: 'transcripts',
        columns: ['id', 'fireflies_id', 'call_title', 'call_datetime', 'duration_seconds', 'rep_name', 'rep_email', 'participants', 'transcript_text', 'source_url', 'analysis_json', 'analysis_version', 'analyzed_at', 'stripe_data', 'stripe_enriched_at', 'classification_override', 'created_at', 'updated_at']
      },
      {
        name: 'sync_log',
        columns: ['sync_type', 'started_at', 'completed_at', 'calls_fetched', 'calls_new', 'calls_updated', 'status', 'error_message'],
        skipId: true
      },
      {
        name: 'sessions',
        columns: ['id', 'user_id', 'expires_at', 'created_at']
      },
      {
        name: 'magic_links',
        columns: ['token', 'user_id', 'expires_at', 'used_at']
      },
      {
        name: 'access_requests',
        columns: ['id', 'email', 'name', 'status', 'created_at', 'decided_at', 'decided_by', 'notes', 'last_requested_at', 'password_hash']
      },
      {
        name: 'manual_closes',
        columns: ['id', 'email', 'company', 'website', 'rep', 'close_date', 'amount', 'notes', 'linked_call_id', 'created_at', 'created_by', 'updated_at']
      },
      {
        name: 'manual_lifecycle_overrides',
        columns: ['id', 'call_id', 'prospect_email', 'status', 'notes', 'created_at', 'created_by', 'updated_at']
      },
      {
        name: 'closing_rate_inclusions',
        columns: ['call_id', 'included', 'updated_at', 'updated_by']
      },
      {
        name: 'changelog_entries',
        columns: ['id', 'title', 'summary', 'details', 'tag', 'is_published', 'show_as_new_until', 'created_at', 'created_by', 'updated_at', 'published_at']
      },
      {
        name: 'analyzed_calls',
        columns: ['id', 'fireflies_id', 'title', 'date', 'duration', 'prospect_name', 'sales_rep', 'outcome', 'offer_pitched', 'overall_score', 'pain_level', 'analysis_json', 'created_at', 'updated_at']
      },
      {
        name: 'pain_points',
        columns: ['call_id', 'category', 'quote', 'intensity'],
        skipId: true
      },
      {
        name: 'customer_language',
        columns: ['call_id', 'type', 'phrase', 'context'],
        skipId: true
      },
      {
        name: 'dfy_mentions',
        columns: ['call_id', 'mentioned', 'who_initiated', 'timestamp', 'reason', 'classification'],
        skipId: true
      },
      {
        name: 'objections',
        columns: ['call_id', 'type', 'quote', 'resolution_attempted', 'outcome'],
        skipId: true
      }
    ];

    let totalMigrated = 0;

    for (const table of tablesToMigrate) {
      const rows = await readSqliteTable(sqliteDb, table.name);
      const count = await insertIntoPostgres(pgClient, table.name, rows, table.columns);
      totalMigrated += count;
    }

    console.log('');
    console.log('='.repeat(60));
    console.log(`Migration complete! Total rows migrated: ${totalMigrated}`);
    console.log('='.repeat(60));

  } finally {
    pgClient.release();
    sqliteDb.close();
    await pgPool.end();
  }
}

// Run migration
migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
