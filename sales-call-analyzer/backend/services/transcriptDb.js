/**
 * Transcript Database Service
 * Handles storage and retrieval of raw call transcripts from Fireflies
 *
 * Updated to use dbAdapter for PostgreSQL/SQLite dual support
 */

const dbAdapter = require('./dbAdapter');
const { v4: uuidv4 } = require('uuid');

/**
 * Initialize the transcripts table and sync_log table
 */
async function initTranscriptsTable() {
  await dbAdapter.initDb();
  await dbAdapter.createTables();
  console.log('[TranscriptDB] Tables initialized');
}

/**
 * Normalize a datetime value to ISO string format
 * Handles: ISO strings, numeric timestamps (milliseconds or seconds), Date objects
 * @param {any} datetime - The datetime value to normalize
 * @returns {string|null} - ISO string or null
 */
function normalizeDatetime(datetime) {
  if (!datetime) return null;

  // Already an ISO string
  if (typeof datetime === 'string') {
    // Validate it's a valid date
    const d = new Date(datetime);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Numeric timestamp
  if (typeof datetime === 'number') {
    // If the number is too large, it's in milliseconds
    // Unix timestamps in seconds are around 1.7 billion (year 2023)
    // Millisecond timestamps are around 1.7 trillion
    const ms = datetime > 10000000000 ? datetime : datetime * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Date object
  if (datetime instanceof Date) {
    return isNaN(datetime.getTime()) ? null : datetime.toISOString();
  }

  return null;
}

/**
 * Parse JSON fields in a row object
 */
function parseJsonFields(obj) {
  if (!obj) return obj;

  if (obj.participants && typeof obj.participants === 'string') {
    try {
      obj.participants = JSON.parse(obj.participants);
    } catch (e) {
      obj.participants = [];
    }
  }
  if (obj.analysis_json && typeof obj.analysis_json === 'string') {
    try {
      obj.analysis = JSON.parse(obj.analysis_json);
    } catch (e) {
      obj.analysis = null;
    }
  }
  if (obj.stripe_data && typeof obj.stripe_data === 'string') {
    try {
      obj.stripeData = JSON.parse(obj.stripe_data);
    } catch (e) {
      obj.stripeData = null;
    }
  }
  return obj;
}

/**
 * Check if a call title matches auto-delete rules
 * Returns the reason if should be auto-deleted, null otherwise
 *
 * Rules (case-insensitive, trimmed):
 * 1) If title contains "weekly" anywhere → auto-delete (reason: "auto-filter:weekly")
 * 2) If title contains "AF ads jour fixe" anywhere → auto-delete (reason: "auto-filter:jour-fixe")
 * 3) For dev calls: ONLY auto-delete if title is exactly "dev" (reason: "auto-filter:dev")
 *    - Do NOT auto-delete titles that merely contain "dev" (e.g. "dev call", "dev sync")
 *
 * @param {string} title - Call title
 * @returns {string|null} - Delete reason if should auto-delete, null otherwise
 */
function shouldAutoDelete(title) {
  if (!title) return null;

  const normalizedTitle = title.trim().toLowerCase();
  // Normalize whitespace (collapse multiple spaces to single space)
  const normalizedWhitespace = normalizedTitle.replace(/\s+/g, ' ');

  // Rule 1: Contains "weekly" anywhere
  if (normalizedWhitespace.includes('weekly')) {
    return 'auto-filter:weekly';
  }

  // Rule 2: Contains "AF ads jour fixe" anywhere (case-insensitive, whitespace-normalized)
  if (normalizedWhitespace.includes('af ads jour fixe')) {
    return 'auto-filter:jour-fixe';
  }

  // Rule 3: Exactly "dev" (after trimming, case-insensitive)
  if (normalizedTitle === 'dev') {
    return 'auto-filter:dev';
  }

  return null;
}

/**
 * Soft delete a transcript (set deleted_at timestamp)
 * @param {string} transcriptId - Internal transcript ID
 * @param {string} reason - Deletion reason (e.g., 'manual', 'auto-filter:weekly')
 * @returns {Object} - { success: boolean, deleted: boolean }
 */
async function softDeleteTranscript(transcriptId, reason = 'manual') {
  const existing = await getTranscriptById(transcriptId);
  if (!existing) {
    return { success: false, deleted: false, error: 'Transcript not found' };
  }

  const now = new Date().toISOString();
  await dbAdapter.execute(
    'UPDATE transcripts SET deleted_at = $1, deleted_reason = $2, updated_at = $3 WHERE id = $4',
    [now, reason, now, transcriptId]
  );

  return { success: true, deleted: true };
}

/**
 * Soft delete multiple transcripts
 * @param {Array<string>} transcriptIds - Array of transcript IDs to delete
 * @param {string} reason - Deletion reason
 * @returns {Object} - { success: boolean, deletedCount: number, errors: Array }
 */
async function softDeleteTranscripts(transcriptIds, reason = 'manual') {
  if (!Array.isArray(transcriptIds) || transcriptIds.length === 0) {
    return { success: false, deletedCount: 0, errors: ['No transcript IDs provided'] };
  }

  let deletedCount = 0;
  const errors = [];

  for (const id of transcriptIds) {
    try {
      const result = await softDeleteTranscript(id, reason);
      if (result.deleted) {
        deletedCount++;
      } else if (result.error) {
        errors.push({ id, error: result.error });
      }
    } catch (error) {
      errors.push({ id, error: error.message });
    }
  }

  return {
    success: errors.length === 0,
    deletedCount,
    errors
  };
}

/**
 * Restore a soft-deleted transcript
 * @param {string} transcriptId - Internal transcript ID
 * @returns {Object} - { success: boolean, restored: boolean }
 */
async function restoreTranscript(transcriptId) {
  const existing = await getTranscriptById(transcriptId);
  if (!existing) {
    return { success: false, restored: false, error: 'Transcript not found' };
  }

  if (!existing.deleted_at) {
    return { success: false, restored: false, error: 'Transcript is not deleted' };
  }

  const now = new Date().toISOString();
  await dbAdapter.execute(
    'UPDATE transcripts SET deleted_at = NULL, deleted_reason = NULL, updated_at = $1 WHERE id = $2',
    [now, transcriptId]
  );

  return { success: true, restored: true };
}

/**
 * Get deleted transcripts
 * @param {number} limit - Maximum number to return
 * @param {number} offset - Offset for pagination
 * @param {Object} filters - Optional filters (startDate, endDate, repFilter)
 */
async function getDeletedTranscripts(limit = 100, offset = 0, filters = {}) {
  const { startDate, endDate, repFilter } = filters;

  const conditions = ['deleted_at IS NOT NULL'];
  const params = [];
  let paramIndex = 1;

  if (startDate) {
    conditions.push(`DATE(call_datetime) >= $${paramIndex}`);
    params.push(startDate);
    paramIndex++;
  }
  if (endDate) {
    conditions.push(`DATE(call_datetime) <= $${paramIndex}`);
    params.push(endDate);
    paramIndex++;
  }
  if (repFilter && repFilter !== 'all') {
    conditions.push(`LOWER(rep_name) LIKE $${paramIndex}`);
    params.push(`%${repFilter.toLowerCase()}%`);
    paramIndex++;
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  params.push(limit, offset);
  const result = await dbAdapter.query(
    `SELECT * FROM transcripts ${whereClause} ORDER BY deleted_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );

  return result.rows.map(parseJsonFields);
}

/**
 * Get count of deleted transcripts
 * @param {Object} filters - Optional filters
 */
async function getDeletedTranscriptCount(filters = {}) {
  const { startDate, endDate, repFilter } = filters;

  const conditions = ['deleted_at IS NOT NULL'];
  const params = [];
  let paramIndex = 1;

  if (startDate) {
    conditions.push(`DATE(call_datetime) >= $${paramIndex}`);
    params.push(startDate);
    paramIndex++;
  }
  if (endDate) {
    conditions.push(`DATE(call_datetime) <= $${paramIndex}`);
    params.push(endDate);
    paramIndex++;
  }
  if (repFilter && repFilter !== 'all') {
    conditions.push(`LOWER(rep_name) LIKE $${paramIndex}`);
    params.push(`%${repFilter.toLowerCase()}%`);
    paramIndex++;
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const count = await dbAdapter.queryScalar(
    `SELECT COUNT(*) as count FROM transcripts ${whereClause}`,
    params
  );

  return parseInt(count) || 0;
}

/**
 * Save a transcript to the database
 * Respects deleted state: if a transcript is already deleted, it stays deleted on re-sync.
 * Applies auto-delete rules for new transcripts.
 * @param {Object} transcript - Transcript data from Fireflies
 * @param {Object} options - Options { skipAutoDelete: boolean }
 * @returns {Object} - Saved transcript with ID
 */
async function saveTranscript(transcript, options = {}) {
  const { skipAutoDelete = false } = options;
  const id = transcript.id || uuidv4();
  const now = new Date().toISOString();

  // Normalize call_datetime to ISO string format
  const normalizedDatetime = normalizeDatetime(transcript.call_datetime);

  // Check if transcript already exists
  const existing = await getTranscriptByFirefliesId(transcript.fireflies_id);

  if (existing) {
    // If already deleted, keep it deleted (don't resurrect on re-sync)
    // Just update metadata but preserve deleted state
    await dbAdapter.execute(`
      UPDATE transcripts SET
        call_title = $1,
        call_datetime = $2,
        duration_seconds = $3,
        rep_name = $4,
        rep_email = $5,
        participants = $6,
        transcript_text = $7,
        source_url = $8,
        updated_at = $9
      WHERE fireflies_id = $10
    `, [
      transcript.call_title || null,
      normalizedDatetime,
      transcript.duration_seconds || 0,
      transcript.rep_name || null,
      transcript.rep_email || null,
      JSON.stringify(transcript.participants || []),
      transcript.transcript_text || null,
      transcript.source_url || null,
      now,
      transcript.fireflies_id
    ]);

    // Return with existing deleted state preserved
    return {
      ...existing,
      ...transcript,
      updated: true,
      deleted_at: existing.deleted_at,
      deleted_reason: existing.deleted_reason,
      wasAlreadyDeleted: !!existing.deleted_at
    };
  }

  // For new transcripts, check if should be auto-deleted
  const autoDeleteReason = skipAutoDelete ? null : shouldAutoDelete(transcript.call_title);

  // Insert new transcript (with auto-delete fields if applicable)
  await dbAdapter.execute(`
    INSERT INTO transcripts (
      id, fireflies_id, call_title, call_datetime, duration_seconds,
      rep_name, rep_email, participants, transcript_text, source_url,
      deleted_at, deleted_reason,
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
  `, [
    id,
    transcript.fireflies_id,
    transcript.call_title || null,
    normalizedDatetime,
    transcript.duration_seconds || 0,
    transcript.rep_name || null,
    transcript.rep_email || null,
    JSON.stringify(transcript.participants || []),
    transcript.transcript_text || null,
    transcript.source_url || null,
    autoDeleteReason ? now : null,          // deleted_at
    autoDeleteReason || null,                // deleted_reason
    now,
    now
  ]);

  return {
    ...transcript,
    id,
    created: true,
    autoDeleted: !!autoDeleteReason,
    deleted_reason: autoDeleteReason
  };
}

/**
 * Get a transcript by its Fireflies ID
 */
async function getTranscriptByFirefliesId(firefliesId) {
  const row = await dbAdapter.queryOne(
    'SELECT * FROM transcripts WHERE fireflies_id = $1',
    [firefliesId]
  );
  return parseJsonFields(row);
}

/**
 * Get a transcript by its internal ID
 */
async function getTranscriptById(id) {
  const row = await dbAdapter.queryOne(
    'SELECT * FROM transcripts WHERE id = $1',
    [id]
  );
  return parseJsonFields(row);
}

/**
 * Get all Fireflies IDs that exist in the database
 */
async function getExistingFirefliesIds() {
  const result = await dbAdapter.query('SELECT fireflies_id FROM transcripts');
  return result.rows.map(row => row.fireflies_id);
}

/**
 * Get recent transcripts (excludes deleted calls by default)
 * @param {number} limit - Maximum number of transcripts to return
 * @param {number} offset - Offset for pagination
 * @param {Object} filters - Optional filters (startDate, endDate, repFilter, includeDeleted)
 */
async function getRecentTranscripts(limit = 20, offset = 0, filters = {}) {
  const { startDate, endDate, repFilter, includeDeleted = false } = filters;

  // Build WHERE clause based on filters
  // Always exclude deleted calls unless explicitly requested
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (!includeDeleted) {
    conditions.push('deleted_at IS NULL');
  }

  if (startDate) {
    conditions.push(`DATE(call_datetime) >= $${paramIndex}`);
    params.push(startDate);
    paramIndex++;
  }
  if (endDate) {
    conditions.push(`DATE(call_datetime) <= $${paramIndex}`);
    params.push(endDate);
    paramIndex++;
  }
  if (repFilter && repFilter !== 'all') {
    conditions.push(`LOWER(rep_name) LIKE $${paramIndex}`);
    params.push(`%${repFilter.toLowerCase()}%`);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(limit, offset);
  const result = await dbAdapter.query(
    `SELECT * FROM transcripts ${whereClause} ORDER BY call_datetime DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );

  return result.rows.map(parseJsonFields);
}

/**
 * Get transcript count (excludes deleted calls by default)
 * @param {Object} filters - Optional filters (startDate, endDate, repFilter, includeDeleted)
 */
async function getTranscriptCount(filters = {}) {
  const { startDate, endDate, repFilter, includeDeleted = false } = filters;

  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (!includeDeleted) {
    conditions.push('deleted_at IS NULL');
  }

  if (startDate) {
    conditions.push(`DATE(call_datetime) >= $${paramIndex}`);
    params.push(startDate);
    paramIndex++;
  }
  if (endDate) {
    conditions.push(`DATE(call_datetime) <= $${paramIndex}`);
    params.push(endDate);
    paramIndex++;
  }
  if (repFilter && repFilter !== 'all') {
    conditions.push(`LOWER(rep_name) LIKE $${paramIndex}`);
    params.push(`%${repFilter.toLowerCase()}%`);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const count = await dbAdapter.queryScalar(
    `SELECT COUNT(*) as count FROM transcripts ${whereClause}`,
    params
  );

  return parseInt(count) || 0;
}

/**
 * Start a sync log entry
 */
async function startSyncLog(syncType = 'manual') {
  const now = new Date().toISOString();

  await dbAdapter.execute(`
    INSERT INTO sync_log (sync_type, started_at, status)
    VALUES ($1, $2, 'in_progress')
  `, [syncType, now]);

  // Get the ID of the inserted row
  const id = await dbAdapter.queryScalar('SELECT MAX(id) FROM sync_log');
  return id;
}

/**
 * Complete a sync log entry
 */
async function completeSyncLog(syncId, stats, error = null) {
  const now = new Date().toISOString();

  await dbAdapter.execute(`
    UPDATE sync_log SET
      completed_at = $1,
      calls_fetched = $2,
      calls_new = $3,
      calls_updated = $4,
      status = $5,
      error_message = $6
    WHERE id = $7
  `, [
    now,
    stats.fetched || 0,
    stats.new || 0,
    stats.updated || 0,
    error ? 'error' : 'completed',
    error,
    syncId
  ]);
}

/**
 * Get the last sync timestamp
 */
async function getLastSyncTime() {
  const result = await dbAdapter.queryScalar(`
    SELECT completed_at FROM sync_log
    WHERE status = 'completed'
    ORDER BY completed_at DESC
    LIMIT 1
  `);

  return result;
}

/**
 * Get sync history
 */
async function getSyncHistory(limit = 10) {
  const result = await dbAdapter.query(
    'SELECT * FROM sync_log ORDER BY started_at DESC LIMIT $1',
    [limit]
  );
  return result.rows;
}

/**
 * Save analysis results for a transcript
 * @param {string} transcriptId - Internal transcript ID
 * @param {Object} analysis - Analysis results object
 * @param {number} version - Analysis version number
 */
async function saveAnalysis(transcriptId, analysis, version = 1) {
  const now = new Date().toISOString();

  await dbAdapter.execute(`
    UPDATE transcripts SET
      analysis_json = $1,
      analysis_version = $2,
      analyzed_at = $3,
      updated_at = $4
    WHERE id = $5
  `, [
    JSON.stringify(analysis),
    version,
    now,
    now,
    transcriptId
  ]);

  return { success: true, analyzedAt: now };
}

/**
 * Get analysis for a transcript
 * @param {string} transcriptId - Internal transcript ID
 */
async function getAnalysis(transcriptId) {
  const row = await dbAdapter.queryOne(
    'SELECT analysis_json, analysis_version, analyzed_at FROM transcripts WHERE id = $1',
    [transcriptId]
  );

  if (!row || !row.analysis_json) return null;

  try {
    return {
      analysis: JSON.parse(row.analysis_json),
      version: row.analysis_version,
      analyzedAt: row.analyzed_at
    };
  } catch (e) {
    return null;
  }
}

/**
 * Check if a transcript has been analyzed
 * @param {string} transcriptId - Internal transcript ID
 * @param {number} minVersion - Minimum required analysis version (optional)
 */
async function hasAnalysis(transcriptId, minVersion = 1) {
  const result = await dbAdapter.queryOne(
    'SELECT analysis_version FROM transcripts WHERE id = $1 AND analysis_version >= $2',
    [transcriptId, minVersion]
  );
  return !!result;
}

/**
 * Get transcripts that need analysis (excludes deleted calls)
 * @param {number} limit - Maximum number to return
 * @param {number} minVersion - Minimum analysis version (transcripts below this need re-analysis)
 */
async function getTranscriptsNeedingAnalysis(limit = 10, minVersion = 1) {
  const result = await dbAdapter.query(`
    SELECT * FROM transcripts
    WHERE (analysis_version IS NULL OR analysis_version < $1)
    AND transcript_text IS NOT NULL AND transcript_text != ''
    AND deleted_at IS NULL
    ORDER BY call_datetime DESC
    LIMIT $2
  `, [minVersion, limit]);

  return result.rows.map(parseJsonFields);
}

/**
 * Get transcript with full details including analysis
 * @param {string} transcriptId - Internal transcript ID
 */
async function getTranscriptWithAnalysis(transcriptId) {
  const row = await dbAdapter.queryOne(
    'SELECT * FROM transcripts WHERE id = $1',
    [transcriptId]
  );

  if (!row) return null;

  return parseJsonFields(row);
}

/**
 * Update Stripe enrichment data for a transcript
 * @param {string} transcriptId - Internal transcript ID
 * @param {Object} stripeData - Stripe enrichment data
 */
async function updateStripeData(transcriptId, stripeData) {
  const now = new Date().toISOString();

  await dbAdapter.execute(`
    UPDATE transcripts SET
      stripe_data = $1,
      stripe_enriched_at = $2,
      updated_at = $3
    WHERE id = $4
  `, [
    JSON.stringify(stripeData),
    now,
    now,
    transcriptId
  ]);

  return { success: true, enrichedAt: now };
}

/**
 * Get transcripts that need Stripe enrichment
 * @param {number} limit - Maximum number to return
 */
async function getTranscriptsNeedingStripeEnrichment(limit = 10) {
  const result = await dbAdapter.query(`
    SELECT * FROM transcripts
    WHERE (stripe_data IS NULL OR stripe_data = '')
    AND analysis_json IS NOT NULL
    ORDER BY call_datetime DESC
    LIMIT $1
  `, [limit]);

  return result.rows.map(parseJsonFields);
}

// ========================================
// User Management Functions
// ========================================

/**
 * Create a new user
 * @param {Object} user - User data
 * @returns {Object} - Created user
 */
async function createUser(user) {
  const id = user.id || uuidv4();
  const now = new Date().toISOString();
  const passwordSetAt = user.password_hash ? now : null;
  const isActive = user.is_active !== undefined ? user.is_active : 1;

  await dbAdapter.execute(`
    INSERT INTO users (id, email, name, role, is_active, created_at, password_hash, password_set_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [
    id,
    user.email.toLowerCase(),
    user.name,
    user.role || 'rep',
    dbAdapter.isUsingPostgres() ? (isActive ? true : false) : isActive,
    now,
    user.password_hash || null,
    passwordSetAt
  ]);

  return {
    id,
    email: user.email.toLowerCase(),
    name: user.name,
    role: user.role || 'rep',
    is_active: isActive,
    created_at: now,
    last_login: null,
    password_hash: user.password_hash || null,
    password_set_at: passwordSetAt
  };
}

/**
 * Get user by ID
 * @param {string} id - User ID
 * @returns {Object|null} - User or null
 */
async function getUserById(id) {
  return dbAdapter.queryOne('SELECT * FROM users WHERE id = $1', [id]);
}

/**
 * Get user by email
 * @param {string} email - User email
 * @returns {Object|null} - User or null
 */
async function getUserByEmail(email) {
  return dbAdapter.queryOne('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
}

/**
 * Get all users
 * @param {Object} options - Filter options
 * @returns {Array} - List of users
 */
async function getUsers(options = {}) {
  let query = 'SELECT * FROM users';
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (options.activeOnly) {
    conditions.push(dbAdapter.isUsingPostgres() ? 'is_active = TRUE' : 'is_active = 1');
  }

  if (options.role) {
    conditions.push(`role = $${paramIndex}`);
    params.push(options.role);
    paramIndex++;
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY created_at DESC';

  const result = await dbAdapter.query(query, params);
  return result.rows;
}

/**
 * Update user
 * @param {string} id - User ID
 * @param {Object} updates - Fields to update
 * @returns {Object|null} - Updated user or null
 */
async function updateUser(id, updates) {
  const allowedFields = ['name', 'role', 'is_active', 'last_login', 'password_hash', 'password_set_at'];
  const setClause = [];
  const params = [];
  let paramIndex = 1;

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      setClause.push(`${field} = $${paramIndex}`);
      params.push(updates[field]);
      paramIndex++;
    }
  }

  if (setClause.length === 0) return null;

  params.push(id);
  await dbAdapter.execute(
    `UPDATE users SET ${setClause.join(', ')} WHERE id = $${paramIndex}`,
    params
  );

  return getUserById(id);
}

/**
 * Update user's password hash
 * @param {string} id - User ID
 * @param {string} passwordHash - New password hash
 * @returns {Object} - Updated user
 */
async function updateUserPassword(id, passwordHash) {
  const now = new Date().toISOString();
  await dbAdapter.execute(
    'UPDATE users SET password_hash = $1, password_set_at = $2 WHERE id = $3',
    [passwordHash, now, id]
  );
  return getUserById(id);
}

/**
 * Deactivate user (soft delete)
 * @param {string} id - User ID
 * @returns {boolean} - Success
 */
async function deactivateUser(id) {
  const value = dbAdapter.isUsingPostgres() ? false : 0;
  await dbAdapter.execute('UPDATE users SET is_active = $1 WHERE id = $2', [value, id]);
  return true;
}

/**
 * Update user's last login timestamp
 * @param {string} id - User ID
 */
async function updateUserLastLogin(id) {
  const now = new Date().toISOString();
  await dbAdapter.execute('UPDATE users SET last_login = $1 WHERE id = $2', [now, id]);
}

/**
 * Check if any admin user exists
 * @returns {boolean} - True if at least one admin exists
 */
async function hasAdminUser() {
  const activeCondition = dbAdapter.isUsingPostgres() ? 'is_active = TRUE' : 'is_active = 1';
  const count = await dbAdapter.queryScalar(
    `SELECT COUNT(*) as count FROM users WHERE role = $1 AND ${activeCondition}`,
    ['admin']
  );
  return parseInt(count) > 0;
}

// ========================================
// Magic Link Management Functions
// ========================================

/**
 * Create a magic link token for a user
 * @param {string} userId - User ID
 * @param {number} expiresInMinutes - Expiration time in minutes (default 15)
 * @returns {Object} - Created magic link with token
 */
async function createMagicLink(userId, expiresInMinutes = 15) {
  const crypto = require('crypto');
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();

  await dbAdapter.execute(`
    INSERT INTO magic_links (token, user_id, expires_at)
    VALUES ($1, $2, $3)
  `, [token, userId, expiresAt]);

  return {
    token,
    user_id: userId,
    expires_at: expiresAt,
    used_at: null
  };
}

/**
 * Get magic link by token
 * @param {string} token - Magic link token
 * @returns {Object|null} - Magic link or null
 */
async function getMagicLinkByToken(token) {
  return dbAdapter.queryOne('SELECT * FROM magic_links WHERE token = $1', [token]);
}

/**
 * Validate and use a magic link token
 * Returns the user if valid, null if invalid/expired/used
 * @param {string} token - Magic link token
 * @returns {Object|null} - User object if valid, null otherwise
 */
async function validateAndUseMagicLink(token) {
  // Get the magic link
  const magicLink = await getMagicLinkByToken(token);
  if (!magicLink) return null;

  // Check if already used
  if (magicLink.used_at) return null;

  // Check if expired
  const now = new Date();
  const expiresAt = new Date(magicLink.expires_at);
  if (now > expiresAt) return null;

  // Mark as used
  const usedAt = now.toISOString();
  await dbAdapter.execute(
    'UPDATE magic_links SET used_at = $1 WHERE token = $2',
    [usedAt, token]
  );

  // Get and return the user
  const user = await getUserById(magicLink.user_id);
  return user;
}

/**
 * Check if a magic link is valid (not used and not expired)
 * @param {string} token - Magic link token
 * @returns {boolean} - True if valid
 */
async function isMagicLinkValid(token) {
  const magicLink = await getMagicLinkByToken(token);
  if (!magicLink) return false;
  if (magicLink.used_at) return false;

  const now = new Date();
  const expiresAt = new Date(magicLink.expires_at);
  return now <= expiresAt;
}

/**
 * Delete expired magic links (cleanup)
 * @returns {number} - Number of deleted links
 */
async function deleteExpiredMagicLinks() {
  const now = new Date().toISOString();

  // Get count before deletion
  const count = await dbAdapter.queryScalar(
    'SELECT COUNT(*) FROM magic_links WHERE expires_at < $1',
    [now]
  );

  // Delete expired links
  await dbAdapter.execute('DELETE FROM magic_links WHERE expires_at < $1', [now]);

  return parseInt(count) || 0;
}

/**
 * Get all magic links for a user (for admin/debugging)
 * @param {string} userId - User ID
 * @returns {Array} - List of magic links
 */
async function getMagicLinksByUserId(userId) {
  const result = await dbAdapter.query(
    'SELECT * FROM magic_links WHERE user_id = $1 ORDER BY expires_at DESC',
    [userId]
  );
  return result.rows;
}

/**
 * Delete all magic links for a user (useful when user is deactivated)
 * @param {string} userId - User ID
 */
async function deleteMagicLinksForUser(userId) {
  await dbAdapter.execute('DELETE FROM magic_links WHERE user_id = $1', [userId]);
}

// ========================================
// Session Management Functions
// ========================================

/**
 * Create a new session for a user
 * @param {string} userId - User ID
 * @param {number} expiresInDays - Expiration time in days (default 7)
 * @returns {Object} - Created session
 */
async function createSession(userId, expiresInDays = 7) {
  const id = uuidv4();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  const createdAt = now.toISOString();

  await dbAdapter.execute(`
    INSERT INTO sessions (id, user_id, expires_at, created_at)
    VALUES ($1, $2, $3, $4)
  `, [id, userId, expiresAt, createdAt]);

  return {
    id,
    user_id: userId,
    expires_at: expiresAt,
    created_at: createdAt
  };
}

/**
 * Get session by ID
 * @param {string} sessionId - Session ID
 * @returns {Object|null} - Session or null
 */
async function getSessionById(sessionId) {
  return dbAdapter.queryOne('SELECT * FROM sessions WHERE id = $1', [sessionId]);
}

/**
 * Validate a session and return the user if valid
 * Returns null if session doesn't exist or is expired
 * @param {string} sessionId - Session ID
 * @returns {Object|null} - User object if valid session, null otherwise
 */
async function validateSession(sessionId) {
  const session = await getSessionById(sessionId);
  if (!session) return null;

  // Check if expired
  const now = new Date();
  const expiresAt = new Date(session.expires_at);
  if (now > expiresAt) return null;

  // Get and return the user
  const user = await getUserById(session.user_id);

  // Check if user is active
  if (!user || !user.is_active) return null;

  return user;
}

/**
 * Check if a session is valid (exists and not expired)
 * @param {string} sessionId - Session ID
 * @returns {boolean} - True if valid
 */
async function isSessionValid(sessionId) {
  const session = await getSessionById(sessionId);
  if (!session) return false;

  const now = new Date();
  const expiresAt = new Date(session.expires_at);
  return now <= expiresAt;
}

/**
 * Delete a session (logout)
 * @param {string} sessionId - Session ID
 */
async function deleteSession(sessionId) {
  await dbAdapter.execute('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

/**
 * Delete all sessions for a user (logout from all devices)
 * @param {string} userId - User ID
 */
async function deleteSessionsForUser(userId) {
  await dbAdapter.execute('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

/**
 * Delete expired sessions (cleanup)
 * @returns {number} - Number of deleted sessions
 */
async function deleteExpiredSessions() {
  const now = new Date().toISOString();

  // Get count before deletion
  const count = await dbAdapter.queryScalar(
    'SELECT COUNT(*) FROM sessions WHERE expires_at < $1',
    [now]
  );

  // Delete expired sessions
  await dbAdapter.execute('DELETE FROM sessions WHERE expires_at < $1', [now]);

  return parseInt(count) || 0;
}

/**
 * Get all sessions for a user
 * @param {string} userId - User ID
 * @returns {Array} - List of sessions
 */
async function getSessionsByUserId(userId) {
  const result = await dbAdapter.query(
    'SELECT * FROM sessions WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return result.rows;
}

/**
 * Extend a session's expiry time
 * @param {string} sessionId - Session ID
 * @param {number} expiresInDays - New expiration time in days from now (default 7)
 * @returns {Object|null} - Updated session or null if not found
 */
async function extendSession(sessionId, expiresInDays = 7) {
  const session = await getSessionById(sessionId);
  if (!session) return null;

  const newExpiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  await dbAdapter.execute(
    'UPDATE sessions SET expires_at = $1 WHERE id = $2',
    [newExpiresAt, sessionId]
  );

  return {
    ...session,
    expires_at: newExpiresAt
  };
}

// ========================================
// Access Request Management Functions
// ========================================

/**
 * Create or update an access request
 * @param {Object} requestData - Access request data
 * @param {string} requestData.email - Email address
 * @param {string} requestData.name - Optional name
 * @returns {Object} - Created or updated access request
 */
async function createAccessRequest(requestData) {
  const email = requestData.email.toLowerCase().trim();
  const now = new Date().toISOString();

  // Check if request already exists
  const existing = await getAccessRequestByEmail(email);

  if (existing) {
    // Update existing request (allow re-request if denied)
    if (existing.status === 'denied') {
      await dbAdapter.execute(`
        UPDATE access_requests SET
          status = 'pending',
          name = COALESCE($1, name),
          password_hash = COALESCE($2, password_hash),
          last_requested_at = $3,
          decided_at = NULL,
          decided_by = NULL,
          notes = NULL
        WHERE id = $4
      `, [requestData.name || null, requestData.password_hash || null, now, existing.id]);

      return {
        ...existing,
        status: 'pending',
        name: requestData.name || existing.name,
        password_hash: requestData.password_hash || existing.password_hash,
        last_requested_at: now,
        decided_at: null,
        decided_by: null,
        notes: null,
        isReRequest: true
      };
    }
    // Return existing pending or approved request
    return { ...existing, alreadyExists: true };
  }

  // Create new request
  const id = uuidv4();
  await dbAdapter.execute(`
    INSERT INTO access_requests (id, email, name, password_hash, status, created_at, last_requested_at)
    VALUES ($1, $2, $3, $4, 'pending', $5, $6)
  `, [id, email, requestData.name || null, requestData.password_hash || null, now, now]);

  return {
    id,
    email,
    name: requestData.name || null,
    password_hash: requestData.password_hash || null,
    status: 'pending',
    created_at: now,
    last_requested_at: now,
    decided_at: null,
    decided_by: null,
    notes: null
  };
}

/**
 * Get access request by email
 * @param {string} email - Email address
 * @returns {Object|null} - Access request or null
 */
async function getAccessRequestByEmail(email) {
  return dbAdapter.queryOne(
    'SELECT * FROM access_requests WHERE email = $1',
    [email.toLowerCase().trim()]
  );
}

/**
 * Get access request by ID
 * @param {string} id - Request ID
 * @returns {Object|null} - Access request or null
 */
async function getAccessRequestById(id) {
  return dbAdapter.queryOne('SELECT * FROM access_requests WHERE id = $1', [id]);
}

/**
 * Get all access requests
 * @param {Object} options - Filter options
 * @param {string} options.status - Filter by status (pending, approved, denied)
 * @returns {Array} - List of access requests
 */
async function getAccessRequests(options = {}) {
  let query = 'SELECT * FROM access_requests';
  const params = [];

  if (options.status) {
    query += ' WHERE status = $1';
    params.push(options.status);
  }

  query += ' ORDER BY created_at DESC';

  const result = await dbAdapter.query(query, params);
  return result.rows;
}

/**
 * Update access request status (approve or deny)
 * @param {string} id - Request ID
 * @param {string} status - New status ('approved' or 'denied')
 * @param {string} decidedBy - Admin user ID who made the decision
 * @param {string} notes - Optional notes
 * @returns {Object|null} - Updated request or null
 */
async function updateAccessRequestStatus(id, status, decidedBy, notes = null) {
  const now = new Date().toISOString();

  const validStatuses = ['approved', 'denied'];
  if (!validStatuses.includes(status)) {
    throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
  }

  const existing = await getAccessRequestById(id);
  if (!existing) return null;

  await dbAdapter.execute(`
    UPDATE access_requests SET
      status = $1,
      decided_at = $2,
      decided_by = $3,
      notes = $4
    WHERE id = $5
  `, [status, now, decidedBy, notes, id]);

  return {
    ...existing,
    status,
    decided_at: now,
    decided_by: decidedBy,
    notes
  };
}

/**
 * Delete an access request
 * @param {string} id - Request ID
 * @returns {boolean} - Success
 */
async function deleteAccessRequest(id) {
  await dbAdapter.execute('DELETE FROM access_requests WHERE id = $1', [id]);
  return true;
}

/**
 * Hard delete a single transcript and all related data
 * @param {string} transcriptId - Internal transcript ID
 * @returns {Object} - { success: boolean, deleted: boolean }
 */
async function deleteTranscript(transcriptId) {
  // Check if transcript exists
  const existing = await getTranscriptById(transcriptId);
  if (!existing) {
    return { success: false, deleted: false, error: 'Transcript not found' };
  }

  // Delete the transcript (analysis is stored in same row)
  await dbAdapter.execute('DELETE FROM transcripts WHERE id = $1', [transcriptId]);

  return { success: true, deleted: true };
}

/**
 * Hard delete multiple transcripts and all related data
 * @param {Array<string>} transcriptIds - Array of transcript IDs to delete
 * @returns {Object} - { success: boolean, deletedCount: number, errors: Array }
 */
async function deleteTranscripts(transcriptIds) {
  if (!Array.isArray(transcriptIds) || transcriptIds.length === 0) {
    return { success: false, deletedCount: 0, errors: ['No transcript IDs provided'] };
  }

  let deletedCount = 0;
  const errors = [];

  for (const id of transcriptIds) {
    try {
      const result = await deleteTranscript(id);
      if (result.deleted) {
        deletedCount++;
      } else if (result.error) {
        errors.push({ id, error: result.error });
      }
    } catch (error) {
      errors.push({ id, error: error.message });
    }
  }

  return {
    success: errors.length === 0,
    deletedCount,
    errors
  };
}

/**
 * Get multiple transcripts by their IDs
 * @param {Array<string>} ids - Array of transcript IDs
 * @returns {Array} - Array of transcript objects
 */
async function getTranscriptsByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return [];
  }

  // Build placeholders for IN clause
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
  const result = await dbAdapter.query(
    `SELECT * FROM transcripts WHERE id IN (${placeholders})`,
    ids
  );

  return result.rows.map(parseJsonFields);
}

/**
 * Update the classification override for a transcript
 * @param {string} transcriptId - Internal transcript ID
 * @param {string|null} classification - Classification value ('SALES', 'NOT_SALES', or null to clear)
 * @returns {Object} - { success: boolean }
 */
async function updateClassificationOverride(transcriptId, classification) {
  const now = new Date().toISOString();

  // Validate classification value
  const validValues = ['SALES', 'NOT_SALES', null];
  if (!validValues.includes(classification)) {
    throw new Error('Invalid classification value. Must be SALES, NOT_SALES, or null');
  }

  await dbAdapter.execute(`
    UPDATE transcripts SET
      classification_override = $1,
      updated_at = $2
    WHERE id = $3
  `, [classification, now, transcriptId]);

  return { success: true, classification, updatedAt: now };
}

/**
 * Normalize model names to canonical display format
 * Maps any variations to consistent model identifiers
 * @param {string} model - Model name from stored data
 * @returns {string} - Normalized model name
 */
function normalizeModelName(model) {
  if (!model || typeof model !== 'string') return 'unknown';

  // Canonical model name mappings
  const modelAliases = {
    // GPT-5 variants
    'gpt-5-nano': 'gpt-5-nano',
    'gpt-5-mini': 'gpt-5-mini',
    'gpt5-nano': 'gpt-5-nano',
    'gpt5-mini': 'gpt-5-mini',
    // GPT-4 variants
    'gpt-4o': 'gpt-4o',
    'gpt-4o-mini': 'gpt-4o-mini',
    'gpt-4-turbo': 'gpt-4-turbo',
    'gpt-4-turbo-preview': 'gpt-4-turbo',
    'gpt-4-1106-preview': 'gpt-4-turbo',
    'gpt-4-0125-preview': 'gpt-4-turbo',
    // GPT-3.5 variants
    'gpt-3.5-turbo': 'gpt-3.5-turbo',
    'gpt-35-turbo': 'gpt-3.5-turbo',
    'gpt-3.5-turbo-16k': 'gpt-3.5-turbo',
    'gpt-3.5-turbo-1106': 'gpt-3.5-turbo',
    'gpt-3.5-turbo-0125': 'gpt-3.5-turbo'
  };

  const lowerModel = model.toLowerCase().trim();
  return modelAliases[lowerModel] || model;
}

/**
 * Get aggregated token usage statistics from all LLM analyses
 * @param {Object} options - Filter options
 * @param {string} options.startDate - Start date filter (YYYY-MM-DD)
 * @param {string} options.endDate - End date filter (YYYY-MM-DD)
 * @param {string} options.rep - Filter by sales rep name
 * @param {number} options.recentLimit - Number of recent analyses to return (default 10)
 * @returns {Object} - Token usage statistics
 */
async function getTokenUsageStats(options = {}) {
  const { startDate, endDate, rep, recentLimit = 10 } = options;

  // Build query to get all analyses with token usage
  let query = `
    SELECT analysis_json, analyzed_at, call_title, rep_name
    FROM transcripts
    WHERE analysis_json IS NOT NULL
      AND analysis_json LIKE '%tokenUsage%'
  `;
  const params = [];
  let paramIndex = 1;

  if (startDate) {
    query += ` AND analyzed_at >= $${paramIndex}`;
    params.push(startDate);
    paramIndex++;
  }
  if (endDate) {
    query += ` AND analyzed_at <= $${paramIndex}`;
    params.push(endDate + 'T23:59:59');
    paramIndex++;
  }
  if (rep) {
    query += ` AND rep_name = $${paramIndex}`;
    params.push(rep);
    paramIndex++;
  }

  query += ' ORDER BY analyzed_at DESC';

  const result = await dbAdapter.query(query, params);

  // Initialize stats with timestamp
  const stats = {
    totalCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    totalCostCents: 0,
    byModel: {},
    byDay: {},
    recentAnalyses: [],
    lastUpdated: new Date().toISOString()
  };

  if (!result.rows.length) {
    return stats;
  }

  // Process each analysis
  for (const row of result.rows) {
    const analysisJson = row.analysis_json;
    const analyzedAt = row.analyzed_at;
    const callTitle = row.call_title;
    const repName = row.rep_name;

    if (!analysisJson) continue;

    try {
      const analysis = JSON.parse(analysisJson);
      const tokenUsage = analysis.tokenUsage;

      if (!tokenUsage) continue;

      // Aggregate totals
      stats.totalCalls++;
      stats.totalInputTokens += tokenUsage.inputTokens || 0;
      stats.totalOutputTokens += tokenUsage.outputTokens || 0;
      stats.totalTokens += tokenUsage.totalTokens || 0;
      stats.totalCostCents += tokenUsage.costCents || 0;

      // Aggregate by model - normalize model name for consistent display
      const rawModel = tokenUsage.model;
      const model = normalizeModelName(rawModel);
      if (!stats.byModel[model]) {
        stats.byModel[model] = {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costCents: 0
        };
      }
      stats.byModel[model].calls++;
      stats.byModel[model].inputTokens += tokenUsage.inputTokens || 0;
      stats.byModel[model].outputTokens += tokenUsage.outputTokens || 0;
      stats.byModel[model].totalTokens += tokenUsage.totalTokens || 0;
      stats.byModel[model].costCents += tokenUsage.costCents || 0;

      // Aggregate by day
      const day = analyzedAt ? String(analyzedAt).split('T')[0] : 'unknown';
      if (!stats.byDay[day]) {
        stats.byDay[day] = {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costCents: 0
        };
      }
      stats.byDay[day].calls++;
      stats.byDay[day].inputTokens += tokenUsage.inputTokens || 0;
      stats.byDay[day].outputTokens += tokenUsage.outputTokens || 0;
      stats.byDay[day].totalTokens += tokenUsage.totalTokens || 0;
      stats.byDay[day].costCents += tokenUsage.costCents || 0;

      // Track recent analyses (configurable limit)
      if (stats.recentAnalyses.length < recentLimit) {
        stats.recentAnalyses.push({
          callTitle: callTitle || 'Unknown',
          analyzedAt,
          model: model, // Use normalized model name
          rawModel: rawModel, // Also include raw model for debugging
          inputTokens: tokenUsage.inputTokens,
          outputTokens: tokenUsage.outputTokens,
          totalTokens: tokenUsage.totalTokens,
          costCents: tokenUsage.costCents,
          repName: repName || 'Unknown'
        });
      }

    } catch (e) {
      // Skip malformed JSON
      continue;
    }
  }

  // Calculate averages
  if (stats.totalCalls > 0) {
    stats.avgTokensPerCall = Math.round(stats.totalTokens / stats.totalCalls);
    // avgCostPerCall in cents (for display as dollars, divide by 100 in frontend)
    stats.avgCostPerCall = Math.round((stats.totalCostCents / stats.totalCalls) * 100) / 100;
  } else {
    stats.avgTokensPerCall = 0;
    stats.avgCostPerCall = 0;
  }

  // Convert totalCostCents to dollars for display
  stats.totalCostDollars = Math.round(stats.totalCostCents) / 100;

  return stats;
}

/**
 * Update rep name and email for a transcript
 * Used when re-running rep detection
 */
async function updateRepInfo(id, repName, repEmail) {
  await dbAdapter.execute(
    'UPDATE transcripts SET rep_name = $1, rep_email = $2, updated_at = $3 WHERE id = $4',
    [repName, repEmail, new Date().toISOString(), id]
  );
}

/**
 * Get all transcripts with data needed for rep detection
 * Returns: id, call_title, participants, organizer_email (rep_email)
 */
async function getAllTranscriptsForRepDetection() {
  const result = await dbAdapter.query(`
    SELECT id, call_title, participants, rep_email, rep_name
    FROM transcripts
    ORDER BY call_datetime DESC
  `);

  return result.rows.map(row => ({
    id: row.id,
    call_title: row.call_title,
    participants: row.participants ? (typeof row.participants === 'string' ? JSON.parse(row.participants) : row.participants) : [],
    organizer_email: row.rep_email,
    current_rep_name: row.rep_name
  }));
}

/**
 * Seed internal users (michelle and jamie) with hashed passwords
 * These users are created as admins if they don't already exist
 * Password: secrettool12345 (hashed with bcrypt)
 */
async function seedInternalUsers() {
  const bcrypt = require('bcrypt');
  const BCRYPT_ROUNDS = 12;

  const internalUsers = [
    {
      email: 'michelle@affiliatefinder.ai',
      name: 'Michelle',
      role: 'admin'
    }
  ];

  // Hash the shared password once
  const password = 'secrettool12345';
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  for (const userData of internalUsers) {
    try {
      // Check if user already exists
      const existingUser = await getUserByEmail(userData.email);
      if (existingUser) {
        // Always update password for internal users to ensure credentials work
        await updateUserPassword(existingUser.id, passwordHash);
        console.log(`[TranscriptDB] Updated password for internal user: ${userData.email}`);
        continue;
      }

      // Create the user with the hashed password
      await createUser({
        email: userData.email,
        name: userData.name,
        role: userData.role,
        password_hash: passwordHash
      });
      console.log(`[TranscriptDB] Created internal user: ${userData.email}`);
    } catch (error) {
      console.error(`[TranscriptDB] Error seeding user ${userData.email}:`, error.message);
    }
  }

  return { success: true, message: 'Internal users seeded' };
}

// ============================================
// Manual Closes (DFY Won Deals)
// ============================================

/**
 * Create a manual close entry
 * @param {Object} closeData - Manual close data
 * @returns {Object} - Created close with id
 */
async function createManualClose(closeData) {
  const id = uuidv4();
  const now = new Date().toISOString();

  await dbAdapter.execute(`
    INSERT INTO manual_closes (id, email, company, website, rep, close_date, amount, notes, linked_call_id, created_at, created_by, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  `, [
    id,
    closeData.email.toLowerCase(),
    closeData.company || null,
    closeData.website || null,
    closeData.rep || 'Phil',
    closeData.close_date,
    closeData.amount || null,
    closeData.notes || null,
    closeData.linked_call_id || null,
    now,
    closeData.created_by || null,
    now
  ]);

  return { id, ...closeData, created_at: now };
}

/**
 * Get all manual closes with optional filters
 * @param {Object} filters - Optional filters (startDate, endDate, rep)
 * @returns {Array} - Array of manual closes
 */
async function getManualCloses(filters = {}) {
  let query = 'SELECT * FROM manual_closes WHERE 1=1';
  const params = [];
  let paramIndex = 1;

  if (filters.startDate) {
    query += ` AND close_date >= $${paramIndex}`;
    params.push(filters.startDate);
    paramIndex++;
  }
  if (filters.endDate) {
    query += ` AND close_date <= $${paramIndex}`;
    params.push(filters.endDate);
    paramIndex++;
  }
  if (filters.rep && filters.rep.toLowerCase() !== 'all') {
    query += ` AND LOWER(rep) LIKE LOWER($${paramIndex})`;
    params.push(`%${filters.rep}%`);
    paramIndex++;
  }

  query += ' ORDER BY close_date DESC';

  const result = await dbAdapter.query(query, params);
  return result.rows;
}

/**
 * Get a manual close by ID
 * @param {string} id - Manual close ID
 * @returns {Object|null} - Manual close or null
 */
async function getManualCloseById(id) {
  return dbAdapter.queryOne('SELECT * FROM manual_closes WHERE id = $1', [id]);
}

/**
 * Get manual close by email (to check for duplicates)
 * @param {string} email - Prospect email
 * @returns {Object|null} - Manual close or null
 */
async function getManualCloseByEmail(email) {
  return dbAdapter.queryOne('SELECT * FROM manual_closes WHERE LOWER(email) = LOWER($1)', [email]);
}

/**
 * Update a manual close
 * @param {string} id - Manual close ID
 * @param {Object} updates - Fields to update
 * @returns {Object|null} - Updated close or null
 */
async function updateManualClose(id, updates) {
  const now = new Date().toISOString();

  const fields = [];
  const params = [];
  let paramIndex = 1;

  if (updates.email !== undefined) {
    fields.push(`email = $${paramIndex}`);
    params.push(updates.email.toLowerCase());
    paramIndex++;
  }
  if (updates.company !== undefined) {
    fields.push(`company = $${paramIndex}`);
    params.push(updates.company);
    paramIndex++;
  }
  if (updates.website !== undefined) {
    fields.push(`website = $${paramIndex}`);
    params.push(updates.website);
    paramIndex++;
  }
  if (updates.rep !== undefined) {
    fields.push(`rep = $${paramIndex}`);
    params.push(updates.rep);
    paramIndex++;
  }
  if (updates.close_date !== undefined) {
    fields.push(`close_date = $${paramIndex}`);
    params.push(updates.close_date);
    paramIndex++;
  }
  if (updates.amount !== undefined) {
    fields.push(`amount = $${paramIndex}`);
    params.push(updates.amount);
    paramIndex++;
  }
  if (updates.notes !== undefined) {
    fields.push(`notes = $${paramIndex}`);
    params.push(updates.notes);
    paramIndex++;
  }
  if (updates.linked_call_id !== undefined) {
    fields.push(`linked_call_id = $${paramIndex}`);
    params.push(updates.linked_call_id);
    paramIndex++;
  }

  if (fields.length === 0) return null;

  fields.push(`updated_at = $${paramIndex}`);
  params.push(now);
  paramIndex++;
  params.push(id);

  await dbAdapter.execute(`UPDATE manual_closes SET ${fields.join(', ')} WHERE id = $${paramIndex}`, params);

  return getManualCloseById(id);
}

/**
 * Delete a manual close
 * @param {string} id - Manual close ID
 * @returns {boolean} - Success
 */
async function deleteManualClose(id) {
  await dbAdapter.execute('DELETE FROM manual_closes WHERE id = $1', [id]);
  return true;
}

// ============================================
// Manual Lifecycle Overrides
// ============================================

/**
 * Create or update a lifecycle override for a call
 * @param {Object} overrideData - Override data
 * @returns {Object} - Created/updated override
 */
async function setLifecycleOverride(overrideData) {
  const now = new Date().toISOString();

  // Check if override already exists for this call
  const existing = await getLifecycleOverrideByCallId(overrideData.call_id);

  if (existing) {
    // Update existing
    await dbAdapter.execute(`
      UPDATE manual_lifecycle_overrides
      SET status = $1, notes = $2, updated_at = $3
      WHERE call_id = $4
    `, [overrideData.status, overrideData.notes || null, now, overrideData.call_id]);

    return getLifecycleOverrideByCallId(overrideData.call_id);
  }

  // Create new
  const id = uuidv4();
  await dbAdapter.execute(`
    INSERT INTO manual_lifecycle_overrides (id, call_id, prospect_email, status, notes, created_at, created_by, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [
    id,
    overrideData.call_id,
    overrideData.prospect_email || null,
    overrideData.status,
    overrideData.notes || null,
    now,
    overrideData.created_by || null,
    now
  ]);

  return { id, ...overrideData, created_at: now };
}

/**
 * Get lifecycle override by call ID
 * @param {string} callId - Call/transcript ID
 * @returns {Object|null} - Override or null
 */
async function getLifecycleOverrideByCallId(callId) {
  return dbAdapter.queryOne('SELECT * FROM manual_lifecycle_overrides WHERE call_id = $1', [callId]);
}

/**
 * Get all lifecycle overrides
 * @returns {Array} - Array of overrides
 */
async function getAllLifecycleOverrides() {
  const result = await dbAdapter.query('SELECT * FROM manual_lifecycle_overrides ORDER BY updated_at DESC');
  return result.rows;
}

/**
 * Delete lifecycle override for a call
 * @param {string} callId - Call/transcript ID
 * @returns {boolean} - Success
 */
async function deleteLifecycleOverride(callId) {
  await dbAdapter.execute('DELETE FROM manual_lifecycle_overrides WHERE call_id = $1', [callId]);
  return true;
}

// ============================================
// Closing Rate Call Inclusions
// ============================================

/**
 * Set call inclusion status for closing rate metrics
 * @param {string} callId - Call/transcript ID
 * @param {boolean} included - Whether to include in metrics
 * @param {string} updatedBy - User ID who made the change
 * @returns {Object} - Updated inclusion status
 */
async function setCallInclusion(callId, included, updatedBy = null) {
  const now = new Date().toISOString();
  const includedValue = dbAdapter.isUsingPostgres() ? included : (included ? 1 : 0);

  // Check if record exists
  const existing = await dbAdapter.queryOne('SELECT call_id FROM closing_rate_inclusions WHERE call_id = $1', [callId]);

  if (existing) {
    await dbAdapter.execute(`
      UPDATE closing_rate_inclusions SET included = $1, updated_at = $2, updated_by = $3 WHERE call_id = $4
    `, [includedValue, now, updatedBy, callId]);
  } else {
    await dbAdapter.execute(`
      INSERT INTO closing_rate_inclusions (call_id, included, updated_at, updated_by)
      VALUES ($1, $2, $3, $4)
    `, [callId, includedValue, now, updatedBy]);
  }

  return { call_id: callId, included, updated_at: now };
}

/**
 * Set call inclusion for multiple calls (bulk)
 * @param {Array<string>} callIds - Array of call IDs
 * @param {boolean} included - Whether to include in metrics
 * @param {string} updatedBy - User ID who made the change
 * @returns {Object} - Stats { updated }
 */
async function setCallInclusionBulk(callIds, included, updatedBy = null) {
  for (const callId of callIds) {
    await setCallInclusion(callId, included, updatedBy);
  }

  return { updated: callIds.length };
}

/**
 * Get call inclusion status
 * @param {string} callId - Call/transcript ID
 * @returns {boolean} - Whether included (default true if not set)
 */
async function getCallInclusion(callId) {
  const row = await dbAdapter.queryOne('SELECT included FROM closing_rate_inclusions WHERE call_id = $1', [callId]);
  if (!row) return true; // Default: included
  return dbAdapter.isUsingPostgres() ? row.included : row.included === 1;
}

/**
 * Get all call inclusion statuses
 * @returns {Map<string, boolean>} - Map of callId -> included
 */
async function getAllCallInclusions() {
  const result = await dbAdapter.query('SELECT call_id, included FROM closing_rate_inclusions');
  const map = new Map();
  for (const row of result.rows) {
    map.set(row.call_id, dbAdapter.isUsingPostgres() ? row.included : row.included === 1);
  }
  return map;
}

/**
 * Get excluded call IDs
 * @returns {Set<string>} - Set of excluded call IDs
 */
async function getExcludedCallIds() {
  const falseValue = dbAdapter.isUsingPostgres() ? 'FALSE' : '0';
  const result = await dbAdapter.query(`SELECT call_id FROM closing_rate_inclusions WHERE included = ${falseValue}`);
  const set = new Set();
  for (const row of result.rows) {
    set.add(row.call_id);
  }
  return set;
}

// ============================================
// Changelog Entry Management
// ============================================

/**
 * Create a new changelog entry
 * @param {Object} entryData - Changelog entry data
 * @returns {Object} - Created entry with id
 */
async function createChangelogEntry(entryData) {
  const id = uuidv4();
  const now = new Date().toISOString();
  const isPublished = dbAdapter.isUsingPostgres() ? entryData.is_published : (entryData.is_published ? 1 : 0);

  await dbAdapter.execute(`
    INSERT INTO changelog_entries (id, title, summary, details, tag, is_published, show_as_new_until, created_at, created_by, updated_at, published_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  `, [
    id,
    entryData.title,
    entryData.summary,
    entryData.details || null,
    entryData.tag || null,
    isPublished,
    entryData.show_as_new_until || null,
    now,
    entryData.created_by || null,
    now,
    entryData.is_published ? now : null
  ]);

  return { id, ...entryData, created_at: now, updated_at: now };
}

/**
 * Get changelog entry by ID
 * @param {string} id - Entry ID
 * @returns {Object|null} - Entry or null
 */
async function getChangelogEntryById(id) {
  return dbAdapter.queryOne('SELECT * FROM changelog_entries WHERE id = $1', [id]);
}

/**
 * Get all changelog entries with optional filters
 * @param {Object} options - Filter options
 * @param {boolean} options.publishedOnly - Only return published entries
 * @param {string} options.tag - Filter by tag
 * @returns {Array} - Array of changelog entries
 */
async function getChangelogEntries(options = {}) {
  let query = 'SELECT * FROM changelog_entries WHERE 1=1';
  const params = [];
  let paramIndex = 1;

  if (options.publishedOnly) {
    const trueValue = dbAdapter.isUsingPostgres() ? 'TRUE' : '1';
    query += ` AND is_published = ${trueValue}`;
  }
  if (options.tag) {
    query += ` AND tag = $${paramIndex}`;
    params.push(options.tag);
    paramIndex++;
  }

  query += ' ORDER BY created_at DESC';

  const result = await dbAdapter.query(query, params);
  return result.rows;
}

/**
 * Update a changelog entry
 * @param {string} id - Entry ID
 * @param {Object} updates - Fields to update
 * @returns {Object|null} - Updated entry or null
 */
async function updateChangelogEntry(id, updates) {
  const now = new Date().toISOString();
  const existing = await getChangelogEntryById(id);
  if (!existing) return null;

  const fields = [];
  const params = [];
  let paramIndex = 1;

  if (updates.title !== undefined) {
    fields.push(`title = $${paramIndex}`);
    params.push(updates.title);
    paramIndex++;
  }
  if (updates.summary !== undefined) {
    fields.push(`summary = $${paramIndex}`);
    params.push(updates.summary);
    paramIndex++;
  }
  if (updates.details !== undefined) {
    fields.push(`details = $${paramIndex}`);
    params.push(updates.details);
    paramIndex++;
  }
  if (updates.tag !== undefined) {
    fields.push(`tag = $${paramIndex}`);
    params.push(updates.tag);
    paramIndex++;
  }
  if (updates.is_published !== undefined) {
    const isPublished = dbAdapter.isUsingPostgres() ? updates.is_published : (updates.is_published ? 1 : 0);
    fields.push(`is_published = $${paramIndex}`);
    params.push(isPublished);
    paramIndex++;
    // Set published_at when first published
    if (updates.is_published && !existing.published_at) {
      fields.push(`published_at = $${paramIndex}`);
      params.push(now);
      paramIndex++;
    }
  }
  if (updates.show_as_new_until !== undefined) {
    fields.push(`show_as_new_until = $${paramIndex}`);
    params.push(updates.show_as_new_until);
    paramIndex++;
  }

  if (fields.length === 0) return existing;

  fields.push(`updated_at = $${paramIndex}`);
  params.push(now);
  paramIndex++;
  params.push(id);

  await dbAdapter.execute(`UPDATE changelog_entries SET ${fields.join(', ')} WHERE id = $${paramIndex}`, params);

  return getChangelogEntryById(id);
}

/**
 * Delete a changelog entry
 * @param {string} id - Entry ID
 * @returns {boolean} - Success
 */
async function deleteChangelogEntry(id) {
  await dbAdapter.execute('DELETE FROM changelog_entries WHERE id = $1', [id]);
  return true;
}

// For testing: reset the database connection
function resetDb() {
  // This would need to be handled by the adapter
}

// Export getDb and saveDatabase for backward compatibility
function getDb() {
  return dbAdapter.getRawDb();
}

function saveDatabase() {
  return dbAdapter.saveDatabase();
}

module.exports = {
  initTranscriptsTable,
  saveTranscript,
  getTranscriptByFirefliesId,
  getTranscriptById,
  getExistingFirefliesIds,
  getRecentTranscripts,
  getTranscriptCount,
  startSyncLog,
  completeSyncLog,
  getLastSyncTime,
  getSyncHistory,
  saveAnalysis,
  getAnalysis,
  hasAnalysis,
  getTranscriptsNeedingAnalysis,
  getTranscriptWithAnalysis,
  updateStripeData,
  getTranscriptsNeedingStripeEnrichment,
  // User management
  createUser,
  getUserById,
  getUserByEmail,
  getUsers,
  updateUser,
  updateUserPassword,
  deactivateUser,
  updateUserLastLogin,
  hasAdminUser,
  // Magic link management
  createMagicLink,
  getMagicLinkByToken,
  validateAndUseMagicLink,
  isMagicLinkValid,
  deleteExpiredMagicLinks,
  getMagicLinksByUserId,
  deleteMagicLinksForUser,
  // Session management
  createSession,
  getSessionById,
  validateSession,
  isSessionValid,
  deleteSession,
  deleteSessionsForUser,
  deleteExpiredSessions,
  getSessionsByUserId,
  extendSession,
  // Access request management
  createAccessRequest,
  getAccessRequestByEmail,
  getAccessRequestById,
  getAccessRequests,
  updateAccessRequestStatus,
  deleteAccessRequest,
  // Bulk operations
  deleteTranscript,
  deleteTranscripts,
  getTranscriptsByIds,
  // Soft delete / restore operations
  shouldAutoDelete,
  softDeleteTranscript,
  softDeleteTranscripts,
  restoreTranscript,
  getDeletedTranscripts,
  getDeletedTranscriptCount,
  // Classification
  updateClassificationOverride,
  // Token usage
  getTokenUsageStats,
  // Rep detection
  updateRepInfo,
  getAllTranscriptsForRepDetection,
  // Seeding
  seedInternalUsers,
  resetDb,
  getDb,
  saveDatabase,
  // Manual closes (DFY won deals)
  createManualClose,
  getManualCloses,
  getManualCloseById,
  getManualCloseByEmail,
  updateManualClose,
  deleteManualClose,
  // Manual lifecycle overrides
  setLifecycleOverride,
  getLifecycleOverrideByCallId,
  getAllLifecycleOverrides,
  deleteLifecycleOverride,
  // Closing rate call inclusions
  setCallInclusion,
  setCallInclusionBulk,
  getCallInclusion,
  getAllCallInclusions,
  getExcludedCallIds,
  // Changelog entries
  createChangelogEntry,
  getChangelogEntryById,
  getChangelogEntries,
  updateChangelogEntry,
  deleteChangelogEntry
};
