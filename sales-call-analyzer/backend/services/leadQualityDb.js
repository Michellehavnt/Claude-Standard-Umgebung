/**
 * Lead Quality Database Service
 *
 * Handles all database operations for lead quality scores.
 * Uses dbAdapter for PostgreSQL/SQLite compatibility.
 */

const { v4: uuidv4 } = require('uuid');
const dbAdapter = require('./dbAdapter');

/**
 * Create a new lead quality record
 * @param {Object} leadData - Lead data to insert
 * @returns {Promise<Object>} - Created lead record
 */
async function createLead(leadData) {
  const id = uuidv4();
  const now = new Date().toISOString();

  const {
    calendly_event_id = null,
    invitee_email,
    invitee_name = null,
    company_name = null,
    website = null,
    calendly_challenge = null,
    calendly_country = null,
    calendly_booking_time = null,
    calendly_booking_owner = null,
    calendly_form_responses = null,
    transcript_id = null
  } = leadData;

  await dbAdapter.execute(`
    INSERT INTO lead_quality_scores (
      id, calendly_event_id, invitee_email, invitee_name, company_name,
      website, calendly_challenge, calendly_country, calendly_booking_time,
      calendly_booking_owner, calendly_form_responses, transcript_id, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
  `, [
    id, calendly_event_id, invitee_email, invitee_name, company_name,
    website, calendly_challenge, calendly_country, calendly_booking_time,
    calendly_booking_owner, calendly_form_responses, transcript_id, now, now
  ]);

  return getLead(id);
}

/**
 * Update a lead quality record
 * @param {string} id - Lead ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} - Updated lead record
 */
async function updateLead(id, updates) {
  const now = new Date().toISOString();

  // Build dynamic update query
  const allowedFields = [
    'invitee_name', 'company_name', 'website', 'calendly_challenge',
    'calendly_country', 'calendly_booking_time', 'calendly_booking_owner',
    'calendly_form_responses', 'perplexity_response_json', 'enriched_at',
    'company_strength_score', 'company_strength_rationale',
    'affiliate_readiness_score', 'affiliate_readiness_rationale',
    'buyer_authority_score', 'buyer_authority_rationale',
    'inbound_quality_score', 'inbound_quality_rationale',
    'total_score', 'research_links', 'prompt_version', 'transcript_id',
    'transcript_analysis_json', 'transcript_analyzed_at',
    'post_call_score', 'post_call_rationale', 'linkedin_url'
  ];

  const setClauses = [];
  const values = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      setClauses.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  }

  if (setClauses.length === 0) {
    return getLead(id);
  }

  // Add updated_at
  setClauses.push(`updated_at = $${paramIndex}`);
  values.push(now);
  paramIndex++;

  // Add id for WHERE clause
  values.push(id);

  await dbAdapter.execute(`
    UPDATE lead_quality_scores
    SET ${setClauses.join(', ')}
    WHERE id = $${paramIndex}
  `, values);

  return getLead(id);
}

/**
 * Get a lead by ID
 * @param {string} id - Lead ID
 * @returns {Promise<Object|null>} - Lead record or null
 */
async function getLead(id) {
  const result = await dbAdapter.queryOne(
    'SELECT * FROM lead_quality_scores WHERE id = $1',
    [id]
  );
  return result ? formatLead(result) : null;
}

/**
 * Get a lead by Calendly event ID
 * @param {string} eventId - Calendly event ID
 * @returns {Promise<Object|null>} - Lead record or null
 */
async function getLeadByCalendlyEvent(eventId) {
  const result = await dbAdapter.queryOne(
    'SELECT * FROM lead_quality_scores WHERE calendly_event_id = $1',
    [eventId]
  );
  return result ? formatLead(result) : null;
}

/**
 * Get a lead by email and booking owner
 * @param {string} email - Invitee email
 * @param {string} ownerEmail - Booking owner email
 * @returns {Promise<Object|null>} - Lead record or null
 */
async function getLeadByEmail(email, ownerEmail) {
  const result = await dbAdapter.queryOne(
    'SELECT * FROM lead_quality_scores WHERE invitee_email = $1 AND calendly_booking_owner = $2 ORDER BY created_at DESC',
    [email, ownerEmail]
  );
  return result ? formatLead(result) : null;
}

/**
 * Get leads by booking owner with filters
 * @param {string} ownerEmail - Booking owner email (or 'all' for all reps)
 * @param {Object} filters - Query filters
 * @returns {Promise<Object[]>} - Array of lead records
 */
async function getLeadsByOwner(ownerEmail, filters = {}) {
  const {
    startDate = null,
    endDate = null,
    minScore = null,
    maxScore = null,
    limit = 100,
    offset = 0,
    sortBy = 'calendly_booking_time',
    sortOrder = 'DESC'
  } = filters;

  const conditions = [];
  const values = [];
  let paramIndex = 1;

  if (ownerEmail && ownerEmail !== 'all') {
    conditions.push(`calendly_booking_owner = $${paramIndex}`);
    values.push(ownerEmail);
    paramIndex++;
  }

  if (startDate) {
    conditions.push(`calendly_booking_time >= $${paramIndex}`);
    values.push(startDate);
    paramIndex++;
  }

  if (endDate) {
    conditions.push(`calendly_booking_time <= $${paramIndex}`);
    values.push(endDate);
    paramIndex++;
  }

  if (minScore !== null) {
    conditions.push(`(total_score >= $${paramIndex} OR manual_override_score >= $${paramIndex})`);
    values.push(minScore);
    paramIndex++;
  }

  if (maxScore !== null) {
    conditions.push(`(total_score <= $${paramIndex} OR manual_override_score <= $${paramIndex})`);
    values.push(maxScore);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Validate sort column to prevent SQL injection
  const validSortColumns = ['calendly_booking_time', 'total_score', 'created_at', 'invitee_name', 'company_name'];
  const safeSortBy = validSortColumns.includes(sortBy) ? sortBy : 'calendly_booking_time';
  const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const result = await dbAdapter.query(`
    SELECT * FROM lead_quality_scores
    ${whereClause}
    ORDER BY ${safeSortBy} ${safeSortOrder}
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `, [...values, limit, offset]);

  return result.rows.map(formatLead);
}

/**
 * Get lead count by owner
 * @param {string} ownerEmail - Booking owner email (or 'all' for all reps)
 * @param {Object} filters - Query filters
 * @returns {Promise<number>} - Count of leads
 */
async function getLeadCount(ownerEmail, filters = {}) {
  const { startDate = null, endDate = null, minScore = null, maxScore = null } = filters;

  const conditions = [];
  const values = [];
  let paramIndex = 1;

  if (ownerEmail && ownerEmail !== 'all') {
    conditions.push(`calendly_booking_owner = $${paramIndex}`);
    values.push(ownerEmail);
    paramIndex++;
  }

  if (startDate) {
    conditions.push(`calendly_booking_time >= $${paramIndex}`);
    values.push(startDate);
    paramIndex++;
  }

  if (endDate) {
    conditions.push(`calendly_booking_time <= $${paramIndex}`);
    values.push(endDate);
    paramIndex++;
  }

  if (minScore !== null) {
    conditions.push(`(total_score >= $${paramIndex} OR manual_override_score >= $${paramIndex})`);
    values.push(minScore);
    paramIndex++;
  }

  if (maxScore !== null) {
    conditions.push(`(total_score <= $${paramIndex} OR manual_override_score <= $${paramIndex})`);
    values.push(maxScore);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const count = await dbAdapter.queryScalar(`
    SELECT COUNT(*) FROM lead_quality_scores ${whereClause}
  `, values);

  return parseInt(count, 10) || 0;
}

/**
 * Get lead statistics by owner
 * @param {string} ownerEmail - Booking owner email (or 'all' for all reps)
 * @param {Object} filters - Query filters
 * @returns {Promise<Object>} - Statistics object
 */
async function getStats(ownerEmail, filters = {}) {
  const { startDate = null, endDate = null } = filters;

  const conditions = [];
  const values = [];
  let paramIndex = 1;

  if (ownerEmail && ownerEmail !== 'all') {
    conditions.push(`calendly_booking_owner = $${paramIndex}`);
    values.push(ownerEmail);
    paramIndex++;
  }

  if (startDate) {
    conditions.push(`calendly_booking_time >= $${paramIndex}`);
    values.push(startDate);
    paramIndex++;
  }

  if (endDate) {
    conditions.push(`calendly_booking_time <= $${paramIndex}`);
    values.push(endDate);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await dbAdapter.queryOne(`
    SELECT
      COUNT(*) as total_leads,
      COUNT(CASE WHEN total_score IS NOT NULL OR manual_override_score IS NOT NULL THEN 1 END) as scored_leads,
      COUNT(CASE WHEN total_score IS NULL AND manual_override_score IS NULL THEN 1 END) as pending_leads,
      AVG(COALESCE(manual_override_score, total_score)) as avg_score,
      COUNT(CASE WHEN COALESCE(manual_override_score, total_score) >= 7 THEN 1 END) as high_quality,
      COUNT(CASE WHEN COALESCE(manual_override_score, total_score) >= 4 AND COALESCE(manual_override_score, total_score) < 7 THEN 1 END) as medium_quality,
      COUNT(CASE WHEN COALESCE(manual_override_score, total_score) < 4 AND COALESCE(manual_override_score, total_score) IS NOT NULL THEN 1 END) as low_quality,
      COUNT(CASE WHEN manual_override_score IS NOT NULL THEN 1 END) as overridden
    FROM lead_quality_scores
    ${whereClause}
  `, values);

  return {
    totalLeads: parseInt(result.total_leads, 10) || 0,
    scoredLeads: parseInt(result.scored_leads, 10) || 0,
    pendingLeads: parseInt(result.pending_leads, 10) || 0,
    avgScore: result.avg_score ? parseFloat(result.avg_score).toFixed(1) : null,
    highQuality: parseInt(result.high_quality, 10) || 0,
    mediumQuality: parseInt(result.medium_quality, 10) || 0,
    lowQuality: parseInt(result.low_quality, 10) || 0,
    overridden: parseInt(result.overridden, 10) || 0
  };
}

/**
 * Set manual score override
 * @param {string} id - Lead ID
 * @param {number} score - Override score (1-10)
 * @param {string} notes - Override notes
 * @param {string} userId - User ID making the override
 * @returns {Promise<Object>} - Updated lead record
 */
async function setOverride(id, score, notes, userId) {
  const now = new Date().toISOString();

  await dbAdapter.execute(`
    UPDATE lead_quality_scores
    SET manual_override_score = $1,
        manual_override_notes = $2,
        manual_override_at = $3,
        manual_override_by = $4,
        updated_at = $5
    WHERE id = $6
  `, [score, notes, now, userId, now, id]);

  return getLead(id);
}

/**
 * Clear manual score override
 * @param {string} id - Lead ID
 * @returns {Promise<Object>} - Updated lead record
 */
async function clearOverride(id) {
  const now = new Date().toISOString();

  await dbAdapter.execute(`
    UPDATE lead_quality_scores
    SET manual_override_score = NULL,
        manual_override_notes = NULL,
        manual_override_at = NULL,
        manual_override_by = NULL,
        updated_at = $1
    WHERE id = $2
  `, [now, id]);

  return getLead(id);
}

/**
 * Delete a lead record (hard delete - use sparingly)
 * @param {string} id - Lead ID
 * @returns {Promise<boolean>} - Success status
 */
async function deleteLead(id) {
  const result = await dbAdapter.execute(
    'DELETE FROM lead_quality_scores WHERE id = $1',
    [id]
  );
  return result.rowCount > 0;
}

/**
 * Get or create a setting
 * @param {string} key - Setting key
 * @param {string} defaultValue - Default value if not found
 * @returns {Promise<string>} - Setting value
 */
async function getSetting(key, defaultValue = null) {
  const result = await dbAdapter.queryOne(
    'SELECT setting_value FROM lead_quality_settings WHERE setting_key = $1',
    [key]
  );
  return result ? result.setting_value : defaultValue;
}

/**
 * Save a setting
 * @param {string} key - Setting key
 * @param {string} value - Setting value
 * @param {string} userId - User ID making the change
 * @returns {Promise<boolean>} - Success status
 */
async function saveSetting(key, value, userId = null) {
  const now = new Date().toISOString();

  // Check if setting exists
  const existing = await dbAdapter.queryOne(
    'SELECT id FROM lead_quality_settings WHERE setting_key = $1',
    [key]
  );

  if (existing) {
    await dbAdapter.execute(`
      UPDATE lead_quality_settings
      SET setting_value = $1, updated_at = $2, updated_by = $3
      WHERE setting_key = $4
    `, [value, now, userId, key]);
  } else {
    const id = uuidv4();
    await dbAdapter.execute(`
      INSERT INTO lead_quality_settings (id, setting_key, setting_value, updated_at, updated_by)
      VALUES ($1, $2, $3, $4, $5)
    `, [id, key, value, now, userId]);
  }

  return true;
}

/**
 * Format a lead record for API response
 * @param {Object} row - Database row
 * @returns {Object} - Formatted lead
 */
function formatLead(row) {
  if (!row) return null;

  // Parse JSON fields
  let perplexityData = null;
  let researchLinks = [];
  let calendlyFormResponses = null;

  try {
    if (row.perplexity_response_json) {
      perplexityData = JSON.parse(row.perplexity_response_json);
    }
  } catch (e) {
    // Ignore parse errors
  }

  try {
    if (row.research_links) {
      researchLinks = JSON.parse(row.research_links);
    }
  } catch (e) {
    // Ignore parse errors
  }

  try {
    if (row.calendly_form_responses) {
      calendlyFormResponses = JSON.parse(row.calendly_form_responses);
    }
  } catch (e) {
    // Ignore parse errors
  }

  // Calculate effective score (override takes precedence)
  const effectiveScore = row.manual_override_score !== null
    ? row.manual_override_score
    : row.total_score;

  return {
    id: row.id,
    calendlyEventId: row.calendly_event_id,
    inviteeEmail: row.invitee_email,
    inviteeName: row.invitee_name,
    companyName: row.company_name,
    website: row.website,
    calendlyChallenge: row.calendly_challenge,
    calendlyCountry: row.calendly_country,
    calendlyFormResponses,
    calendlyBookingTime: row.calendly_booking_time,
    calendlyBookingOwner: row.calendly_booking_owner,

    // Perplexity research
    perplexityData,
    enrichedAt: row.enriched_at,

    // Scores
    companyStrengthScore: row.company_strength_score,
    companyStrengthRationale: row.company_strength_rationale,
    affiliateReadinessScore: row.affiliate_readiness_score,
    affiliateReadinessRationale: row.affiliate_readiness_rationale,
    buyerAuthorityScore: row.buyer_authority_score,
    buyerAuthorityRationale: row.buyer_authority_rationale,
    inboundQualityScore: row.inbound_quality_score,
    inboundQualityRationale: row.inbound_quality_rationale,
    totalScore: row.total_score,
    effectiveScore,

    // Research links
    researchLinks,

    // Metadata
    promptVersion: row.prompt_version,
    transcriptId: row.transcript_id,

    // Override
    manualOverride: row.manual_override_score !== null ? {
      score: row.manual_override_score,
      notes: row.manual_override_notes,
      at: row.manual_override_at,
      by: row.manual_override_by
    } : null,

    // Transcript analysis
    transcriptAnalysisJson: row.transcript_analysis_json,
    transcriptAnalyzedAt: row.transcript_analyzed_at,
    postCallScore: row.post_call_score,
    postCallRationale: row.post_call_rationale,

    // LinkedIn profile (extracted from perplexity data)
    linkedinUrl: row.linkedin_url || (perplexityData?.linkedin_url) || null,

    // Timestamps
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = {
  // CRUD
  createLead,
  updateLead,
  getLead,
  getLeadByCalendlyEvent,
  getLeadByEmail,
  getLeadsByOwner,
  getLeadCount,
  deleteLead,

  // Stats
  getStats,

  // Override
  setOverride,
  clearOverride,

  // Settings
  getSetting,
  saveSetting,

  // Utilities
  formatLead
};
