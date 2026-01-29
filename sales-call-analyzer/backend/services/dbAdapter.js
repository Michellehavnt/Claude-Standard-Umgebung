/**
 * Database Adapter
 * Provides a unified interface for both SQLite (local dev) and PostgreSQL (production)
 *
 * Usage:
 * - Local development: Uses sql.js (SQLite) with file persistence
 * - Production (Railway): Uses PostgreSQL via DATABASE_URL environment variable
 */

const { Pool } = require('pg');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

// Determine which database to use
const isPostgres = !!process.env.DATABASE_URL;

// PostgreSQL pool (only created if DATABASE_URL is set)
let pgPool = null;

// SQLite database (only created if no DATABASE_URL)
let sqliteDb = null;
let SQL = null;
const sqliteDbPath = path.join(__dirname, '..', 'database.sqlite');

/**
 * Initialize the database connection
 */
async function initDb() {
  if (isPostgres) {
    console.log('[DbAdapter] Using PostgreSQL database');
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    // Test connection
    try {
      const client = await pgPool.connect();
      console.log('[DbAdapter] PostgreSQL connection established');
      client.release();
    } catch (err) {
      console.error('[DbAdapter] PostgreSQL connection error:', err.message);
      throw err;
    }
  } else {
    console.log('[DbAdapter] Using SQLite database (local development)');
    SQL = await initSqlJs();
    if (fs.existsSync(sqliteDbPath)) {
      const fileBuffer = fs.readFileSync(sqliteDbPath);
      sqliteDb = new SQL.Database(fileBuffer);
    } else {
      sqliteDb = new SQL.Database();
    }
  }
}

/**
 * Save SQLite database to disk (no-op for PostgreSQL)
 */
function saveDatabase() {
  if (!isPostgres && sqliteDb) {
    const data = sqliteDb.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(sqliteDbPath, buffer);
  }
}

/**
 * Execute a query and return results
 *
 * @param {string} sql - SQL query (use $1, $2 for PostgreSQL params)
 * @param {Array} params - Query parameters
 * @returns {Object} - { rows: Array, rowCount: number }
 */
async function query(sql, params = []) {
  if (isPostgres) {
    // PostgreSQL uses $1, $2, etc for params
    const result = await pgPool.query(sql, params);
    return { rows: result.rows, rowCount: result.rowCount };
  } else {
    // SQLite uses ? for params - convert $1, $2 to ?
    const sqliteSql = sql.replace(/\$(\d+)/g, '?');

    try {
      const result = sqliteDb.exec(sqliteSql, params);
      if (!result.length) {
        return { rows: [], rowCount: 0 };
      }

      // Convert SQLite result format to PostgreSQL-like format
      const columns = result[0].columns;
      const rows = result[0].values.map(row => {
        const obj = {};
        columns.forEach((col, i) => {
          obj[col] = row[i];
        });
        return obj;
      });

      return { rows, rowCount: rows.length };
    } catch (err) {
      // SQLite exec doesn't return results for INSERT/UPDATE/DELETE
      if (err.message && err.message.includes('no SQL')) {
        return { rows: [], rowCount: 0 };
      }
      throw err;
    }
  }
}

/**
 * Execute a statement (INSERT, UPDATE, DELETE) without returning results
 *
 * @param {string} sql - SQL statement
 * @param {Array} params - Query parameters
 * @returns {Object} - { rowCount: number }
 */
async function execute(sql, params = []) {
  if (isPostgres) {
    const result = await pgPool.query(sql, params);
    return { rowCount: result.rowCount };
  } else {
    // SQLite uses ? for params - convert $1, $2 to ?
    const sqliteSql = sql.replace(/\$(\d+)/g, '?');
    sqliteDb.run(sqliteSql, params);
    saveDatabase();
    return { rowCount: sqliteDb.getRowsModified ? sqliteDb.getRowsModified() : 0 };
  }
}

/**
 * Execute a query and return a single row
 *
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {Object|null} - Single row or null
 */
async function queryOne(sql, params = []) {
  const result = await query(sql, params);
  return result.rows[0] || null;
}

/**
 * Execute a query and return a single scalar value
 *
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {any} - Scalar value or null
 */
async function queryScalar(sql, params = []) {
  const row = await queryOne(sql, params);
  if (!row) return null;
  const keys = Object.keys(row);
  return keys.length > 0 ? row[keys[0]] : null;
}

/**
 * Begin a transaction
 * Note: For SQLite, transactions are simulated since sql.js doesn't support them well
 */
async function beginTransaction() {
  if (isPostgres) {
    await pgPool.query('BEGIN');
  }
  // SQLite: no-op (single-threaded, auto-commits)
}

/**
 * Commit a transaction
 */
async function commitTransaction() {
  if (isPostgres) {
    await pgPool.query('COMMIT');
  } else {
    saveDatabase();
  }
}

/**
 * Rollback a transaction
 */
async function rollbackTransaction() {
  if (isPostgres) {
    await pgPool.query('ROLLBACK');
  }
  // SQLite: reload from disk would be needed for true rollback
}

/**
 * Check if using PostgreSQL
 */
function isUsingPostgres() {
  return isPostgres;
}

/**
 * Get the raw database connection (for advanced use cases)
 */
function getRawDb() {
  return isPostgres ? pgPool : sqliteDb;
}

/**
 * Close the database connection
 */
async function closeDb() {
  if (isPostgres && pgPool) {
    await pgPool.end();
    pgPool = null;
  } else if (sqliteDb) {
    saveDatabase();
    sqliteDb.close();
    sqliteDb = null;
  }
}

/**
 * Create tables with PostgreSQL-compatible schema
 * This is called during initialization
 */
async function createTables() {
  // Use TEXT for IDs (UUIDs) - works in both SQLite and PostgreSQL
  // Use TIMESTAMP for dates - works in both
  // Use BOOLEAN for booleans in PostgreSQL, INTEGER in SQLite (both accept 0/1)

  const booleanType = isPostgres ? 'BOOLEAN' : 'INTEGER';
  const serialType = isPostgres ? 'SERIAL' : 'INTEGER';
  const autoIncrement = isPostgres ? '' : 'AUTOINCREMENT';

  // Transcripts table
  await execute(`
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
      deleted_at TIMESTAMP,
      deleted_reason TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration: Add deleted_at and deleted_reason columns to existing transcripts table
  const addColumnSafely = async (table, column, type) => {
    try {
      await execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      console.log(`[DbAdapter] Added column ${column} to ${table}`);
    } catch (err) {
      // Column already exists - this is expected for existing databases
      if (err.message && (err.message.includes('duplicate column') || err.message.includes('already exists'))) {
        // Silently ignore - column exists
      } else {
        console.warn(`[DbAdapter] Column ${column} migration warning:`, err.message);
      }
    }
  };

  await addColumnSafely('transcripts', 'deleted_at', 'TIMESTAMP');
  await addColumnSafely('transcripts', 'deleted_reason', 'TEXT');

  // Sync log table
  await execute(`
    CREATE TABLE IF NOT EXISTS sync_log (
      id ${serialType} PRIMARY KEY ${autoIncrement},
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
  await execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'rep',
      is_active ${booleanType} DEFAULT ${isPostgres ? 'TRUE' : '1'},
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_login TIMESTAMP,
      password_hash TEXT,
      password_set_at TIMESTAMP
    )
  `);

  // Magic links table
  await execute(`
    CREATE TABLE IF NOT EXISTS magic_links (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP
    )
  `);

  // Sessions table
  await execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Access requests table
  await execute(`
    CREATE TABLE IF NOT EXISTS access_requests (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      decided_at TIMESTAMP,
      decided_by TEXT REFERENCES users(id),
      notes TEXT,
      last_requested_at TIMESTAMP,
      password_hash TEXT
    )
  `);

  // Manual closes table
  await execute(`
    CREATE TABLE IF NOT EXISTS manual_closes (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      company TEXT,
      website TEXT,
      rep TEXT NOT NULL DEFAULT 'Phil',
      close_date DATE NOT NULL,
      amount REAL,
      notes TEXT,
      linked_call_id TEXT REFERENCES transcripts(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT REFERENCES users(id),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Manual lifecycle overrides table
  await execute(`
    CREATE TABLE IF NOT EXISTS manual_lifecycle_overrides (
      id TEXT PRIMARY KEY,
      call_id TEXT NOT NULL REFERENCES transcripts(id),
      prospect_email TEXT,
      status TEXT NOT NULL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT REFERENCES users(id),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Closing rate inclusions table
  await execute(`
    CREATE TABLE IF NOT EXISTS closing_rate_inclusions (
      call_id TEXT PRIMARY KEY REFERENCES transcripts(id),
      included ${booleanType} NOT NULL DEFAULT ${isPostgres ? 'TRUE' : '1'},
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_by TEXT REFERENCES users(id)
    )
  `);

  // Changelog entries table
  await execute(`
    CREATE TABLE IF NOT EXISTS changelog_entries (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      details TEXT,
      tag TEXT,
      is_published ${booleanType} NOT NULL DEFAULT ${isPostgres ? 'FALSE' : '0'},
      show_as_new_until DATE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT REFERENCES users(id),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      published_at TIMESTAMP
    )
  `);

  // Old analyzed_calls table (for backward compatibility)
  await execute(`
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
  await execute(`
    CREATE TABLE IF NOT EXISTS pain_points (
      id ${serialType} PRIMARY KEY ${autoIncrement},
      call_id TEXT,
      category TEXT,
      quote TEXT,
      intensity TEXT,
      FOREIGN KEY (call_id) REFERENCES analyzed_calls(id)
    )
  `);

  // Customer language table
  await execute(`
    CREATE TABLE IF NOT EXISTS customer_language (
      id ${serialType} PRIMARY KEY ${autoIncrement},
      call_id TEXT,
      type TEXT,
      phrase TEXT,
      context TEXT,
      FOREIGN KEY (call_id) REFERENCES analyzed_calls(id)
    )
  `);

  // DFY mentions table
  await execute(`
    CREATE TABLE IF NOT EXISTS dfy_mentions (
      id ${serialType} PRIMARY KEY ${autoIncrement},
      call_id TEXT,
      mentioned ${booleanType},
      who_initiated TEXT,
      timestamp TEXT,
      reason TEXT,
      classification TEXT,
      FOREIGN KEY (call_id) REFERENCES analyzed_calls(id)
    )
  `);

  // Objections table
  await execute(`
    CREATE TABLE IF NOT EXISTS objections (
      id ${serialType} PRIMARY KEY ${autoIncrement},
      call_id TEXT,
      type TEXT,
      quote TEXT,
      resolution_attempted TEXT,
      outcome TEXT,
      FOREIGN KEY (call_id) REFERENCES analyzed_calls(id)
    )
  `);

  // Create indexes
  const createIndexSafely = async (indexSql) => {
    try {
      await execute(indexSql);
    } catch (err) {
      // Index might already exist
      if (!err.message || !err.message.includes('already exists')) {
        console.warn('[DbAdapter] Index creation warning:', err.message);
      }
    }
  };

  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_transcripts_fireflies_id ON transcripts(fireflies_id)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_transcripts_datetime ON transcripts(call_datetime DESC)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_transcripts_rep ON transcripts(rep_name)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_transcripts_deleted ON transcripts(deleted_at)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_sync_log_started ON sync_log(started_at DESC)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_magic_links_user ON magic_links(user_id)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_magic_links_expires ON magic_links(expires_at)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_access_requests_email ON access_requests(email)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_manual_closes_email ON manual_closes(email)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_manual_closes_rep ON manual_closes(rep)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_manual_closes_date ON manual_closes(close_date)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_manual_lifecycle_call ON manual_lifecycle_overrides(call_id)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_manual_lifecycle_email ON manual_lifecycle_overrides(prospect_email)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_changelog_published ON changelog_entries(is_published)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_changelog_created ON changelog_entries(created_at DESC)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_calls_date ON analyzed_calls(date)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_calls_sales_rep ON analyzed_calls(sales_rep)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_pain_points_call ON pain_points(call_id)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_language_call ON customer_language(call_id)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_dfy_call ON dfy_mentions(call_id)');

  // Lead quality scores table
  await execute(`
    CREATE TABLE IF NOT EXISTS lead_quality_scores (
      id TEXT PRIMARY KEY,
      calendly_event_id TEXT,
      invitee_email TEXT NOT NULL,
      invitee_name TEXT,
      company_name TEXT,
      website TEXT,
      calendly_challenge TEXT,
      calendly_country TEXT,
      calendly_booking_time TIMESTAMP,
      calendly_form_responses TEXT,
      perplexity_response_json TEXT,
      enriched_at TIMESTAMP,
      company_strength_score INTEGER,
      company_strength_rationale TEXT,
      affiliate_readiness_score INTEGER,
      affiliate_readiness_rationale TEXT,
      buyer_authority_score INTEGER,
      buyer_authority_rationale TEXT,
      inbound_quality_score INTEGER,
      inbound_quality_rationale TEXT,
      total_score INTEGER,
      research_links TEXT,
      calendly_booking_owner TEXT,
      prompt_version TEXT,
      manual_override_score INTEGER,
      manual_override_notes TEXT,
      manual_override_at TIMESTAMP,
      manual_override_by TEXT REFERENCES users(id),
      transcript_id TEXT REFERENCES transcripts(id),
      transcript_analysis_json TEXT,
      transcript_analyzed_at TIMESTAMP,
      post_call_score INTEGER,
      post_call_rationale TEXT,
      linkedin_url TEXT,
      linkedin_company_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add new columns if they don't exist (for existing databases)
  // SQLite doesn't support IF NOT EXISTS, so we try each and catch errors
  const columnsToAdd = [
    { name: 'calendly_form_responses', type: 'TEXT' },
    { name: 'transcript_analysis_json', type: 'TEXT' },
    { name: 'transcript_analyzed_at', type: 'TIMESTAMP' },
    { name: 'post_call_score', type: 'INTEGER' },
    { name: 'post_call_rationale', type: 'TEXT' },
    { name: 'linkedin_url', type: 'TEXT' },
    { name: 'linkedin_company_url', type: 'TEXT' }
  ];

  for (const col of columnsToAdd) {
    try {
      await execute(`ALTER TABLE lead_quality_scores ADD COLUMN ${col.name} ${col.type}`);
    } catch (e) {
      // Column already exists - ignore
    }
  }

  // Lead quality settings table
  await execute(`
    CREATE TABLE IF NOT EXISTS lead_quality_settings (
      id TEXT PRIMARY KEY,
      setting_key TEXT UNIQUE NOT NULL,
      setting_value TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_by TEXT REFERENCES users(id)
    )
  `);

  // Lead quality indexes
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_lead_quality_email ON lead_quality_scores(invitee_email)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_lead_quality_owner ON lead_quality_scores(calendly_booking_owner)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_lead_quality_score ON lead_quality_scores(total_score)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_lead_quality_booking_time ON lead_quality_scores(calendly_booking_time DESC)');
  await createIndexSafely('CREATE INDEX IF NOT EXISTS idx_lead_quality_settings_key ON lead_quality_settings(setting_key)');

  console.log('[DbAdapter] Tables created successfully');
}

module.exports = {
  initDb,
  saveDatabase,
  query,
  execute,
  queryOne,
  queryScalar,
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
  isUsingPostgres,
  getRawDb,
  closeDb,
  createTables
};
