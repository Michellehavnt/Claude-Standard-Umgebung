/**
 * Founder Snapshot Service
 *
 * Generates founder-facing metrics for sales rep performance,
 * specifically focused on Phil's closing rate using Stripe AND Slack data.
 *
 * DEFINITIONS:
 * ============
 * - "Call" = SALES-classified call that has been analyzed (analysis_version > 0)
 * - "Signed Up" = Prospect found in Stripe OR has Slack lifecycle event (registered, trialing, active, etc.)
 * - "Active" = Stripe/Slack status is 'active'
 * - "Churned" = Stripe/Slack status is 'canceled'
 *
 * DATA SOURCES (in priority order):
 * =================================
 * 1. Stripe enrichment data (stored in stripe_data column) - highest priority
 * 2. Slack lifecycle events (from slack_lifecycle_events table) - fallback
 *
 * METRICS:
 * ========
 * - Call Count: # analyzed SALES calls for the rep
 * - Signup Count: # calls with Stripe OR Slack match
 * - Active Count: # calls with active status
 * - Churned Count: # calls with canceled status
 * - Signup Rate ("closing rate"): Signup Count / Call Count
 * - Active Rate: Active Count / Call Count
 * - Avg Days to Signup: Average time from call to signup
 *
 * DEDUPLICATION:
 * ==============
 * When multiple calls exist for the same prospect (by email), only the
 * earliest call in the date range is counted.
 */

const transcriptDb = require('./transcriptDb');
const dbAdapter = require('./dbAdapter');
const analyzer = require('./analyzer');
const slackIngestionService = require('./slackIngestionService');

/**
 * Get analyzed SALES calls for a rep within a date range
 * @param {Object} filters
 * @param {string} filters.startDate - Start date (YYYY-MM-DD)
 * @param {string} filters.endDate - End date (YYYY-MM-DD)
 * @param {string} filters.rep - Rep name (default: 'Phil')
 * @returns {Promise<Array>} - Array of transcript objects with parsed analysis and stripe data
 */
async function getRepSalesCalls(filters = {}) {
  const rep = filters.rep || 'Phil';

  // Build query with parameterized placeholders for PostgreSQL compatibility
  let sql = `
    SELECT * FROM transcripts
    WHERE analysis_json IS NOT NULL
    AND analysis_version > 0
    AND deleted_at IS NULL
  `;
  const params = [];
  let paramIndex = 1;

  // Filter by rep unless "all" is specified
  if (rep.toLowerCase() !== 'all') {
    sql += ` AND LOWER(rep_name) LIKE LOWER($${paramIndex})`;
    params.push(`%${rep}%`);
    paramIndex++;
  }

  // Date range filter - call_datetime is stored as ISO strings (e.g., '2025-01-20T14:00:00Z')
  // Use date() for SQLite compatibility, substring for PostgreSQL
  if (filters.startDate) {
    if (dbAdapter.isUsingPostgres()) {
      sql += ` AND call_datetime::date >= $${paramIndex}::date`;
    } else {
      sql += ` AND date(call_datetime) >= $${paramIndex}`;
    }
    params.push(filters.startDate);
    paramIndex++;
  }
  if (filters.endDate) {
    if (dbAdapter.isUsingPostgres()) {
      sql += ` AND call_datetime::date <= $${paramIndex}::date`;
    } else {
      sql += ` AND date(call_datetime) <= $${paramIndex}`;
    }
    params.push(filters.endDate);
    paramIndex++;
  }

  sql += ' ORDER BY call_datetime ASC';

  const result = await dbAdapter.query(sql, params);
  if (!result.rows || !result.rows.length) return [];

  const transcripts = result.rows.map(row => parseJsonFields(row));

  // Filter to only SALES-classified calls
  return transcripts.filter(t => {
    const classification = analyzer.classifyCall(t.call_title);
    return classification.classification === analyzer.CLASSIFICATION.SALES;
  });
}

/**
 * Parse JSON fields in a transcript row
 */
function parseJsonFields(row) {
  const obj = { ...row };

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
  } else if (obj.stripe_data) {
    obj.stripeData = obj.stripe_data;
  }
  return obj;
}

// Note: rowsToObjects removed - now using parseJsonFields with dbAdapter

/**
 * Extract prospect email from transcript data
 * @param {Object} transcript - Transcript object
 * @returns {string|null} - Prospect email or null
 */
function extractProspectEmail(transcript) {
  // First check stripeData for matched email
  if (transcript.stripeData?.email) {
    return transcript.stripeData.email.toLowerCase();
  }

  // Check participants for non-rep emails
  const participants = transcript.participants || [];
  // Known sales rep domains to exclude
  const salesRepDomains = ['affiliatefinder.io', 'affiliatefinder.ai', 'kniroo.com', 'increasing.com'];
  // Known sales rep email patterns to exclude
  // Jamie I.F. uses jamie@increasing.com
  // Phil uses phil@affiliatefinder.ai
  const salesRepEmails = [
    'phil@affiliatefinder.ai',
    'phil@affiliatefinder.io',
    'phil@kniroo.com',
    'jamie@increasing.com',
    'jamie@affiliatefinder.io',
    'jamie@kniroo.com'
  ];

  for (const p of participants) {
    let email = null;
    if (typeof p === 'string' && p.includes('@')) {
      email = p.toLowerCase();
    } else if (p && typeof p === 'object' && p.email) {
      email = p.email.toLowerCase();
    }

    if (email) {
      // Skip known sales rep emails (exact match)
      if (salesRepEmails.includes(email)) {
        continue;
      }
      // Skip emails from sales rep domains (but allow other emails from increasing.com that aren't jamie@)
      const domain = email.split('@')[1];
      if (salesRepDomains.includes(domain) && !email.startsWith('jamie@increasing.com')) {
        // Only skip if it's an internal domain email (affiliatefinder, kniroo)
        if (domain !== 'increasing.com') {
          continue;
        }
      }
      return email;
    }
  }

  return null;
}

/**
 * Deduplicate calls by prospect email, keeping only the earliest call
 * @param {Array} calls - Array of transcript objects
 * @returns {Array} - Deduplicated array
 */
function deduplicateByProspect(calls) {
  const emailToCall = new Map();

  for (const call of calls) {
    const email = extractProspectEmail(call);

    if (!email) {
      // No email - can't dedupe, include the call
      // Use call ID as a unique key to ensure it's counted
      emailToCall.set(`no-email-${call.id}`, call);
      continue;
    }

    // Keep only the earliest call per email
    if (!emailToCall.has(email)) {
      emailToCall.set(email, call);
    } else {
      const existing = emailToCall.get(email);
      const existingDate = new Date(existing.call_datetime);
      const currentDate = new Date(call.call_datetime);
      if (currentDate < existingDate) {
        emailToCall.set(email, call);
      }
    }
  }

  return Array.from(emailToCall.values());
}

/**
 * Determine Stripe status category for a call
 * @param {Object} stripeData - Stripe enrichment data
 * @returns {Object} - { isSignedUp, isActive, isChurned }
 */
function categorizeStripeStatus(stripeData) {
  if (!stripeData || !stripeData.matched) {
    return { isSignedUp: false, isActive: false, isChurned: false };
  }

  const status = stripeData.status;

  // Signed up = customer exists in Stripe (any status that indicates they signed up at some point)
  // This includes: active, trialing, past_due, canceled, never_subscribed
  // But NOT 'unmatched' since that means no customer found
  const isSignedUp = status !== 'unmatched' && status !== undefined;

  const isActive = status === 'active';
  const isChurned = status === 'canceled';

  return { isSignedUp, isActive, isChurned };
}

/**
 * Categorize Slack lifecycle events into signup status
 * @param {Object} slackStatus - Result from slackIngestionService.getLatestStatusForEmail
 * @returns {Object} - { isSignedUp, isActive, isChurned, slackEventType }
 */
function categorizeSlackStatus(slackStatus) {
  if (!slackStatus) {
    return { isSignedUp: false, isActive: false, isChurned: false, slackEventType: null };
  }

  const status = slackStatus.status;

  // Any event except 'unparsed' indicates a signup of some kind
  const isSignedUp = status && status !== 'unparsed';

  // Map Slack event types to status
  const isActive = status === 'active';
  const isChurned = status === 'canceled';

  return {
    isSignedUp,
    isActive,
    isChurned,
    slackEventType: status
  };
}

/**
 * Get combined status from Stripe and Slack
 * Stripe takes priority, Slack is fallback
 * @param {Object} stripeData - Stripe enrichment data
 * @param {Object} slackStatus - Slack lifecycle status
 * @returns {Object} - Combined status { isSignedUp, isActive, isChurned, source, status }
 */
function getCombinedStatus(stripeData, slackStatus) {
  const stripe = categorizeStripeStatus(stripeData);
  const slack = categorizeSlackStatus(slackStatus);

  // If Stripe has a match, use Stripe data
  if (stripe.isSignedUp) {
    return {
      ...stripe,
      source: 'stripe',
      status: stripeData?.status || 'unknown'
    };
  }

  // Fall back to Slack data
  if (slack.isSignedUp) {
    return {
      ...slack,
      source: 'slack',
      status: slack.slackEventType
    };
  }

  // No match in either source
  return {
    isSignedUp: false,
    isActive: false,
    isChurned: false,
    source: null,
    status: 'unmatched'
  };
}

/**
 * Calculate days from call to signup
 * @param {Object} call - Transcript object with stripeData
 * @returns {number|null} - Days to signup or null if not available
 */
function calculateDaysToSignup(call) {
  if (!call.call_datetime || !call.stripeData?.signupDate) {
    return null;
  }

  const callDate = new Date(call.call_datetime);
  const signupDate = new Date(call.stripeData.signupDate);

  // Only count if signup was after the call
  if (signupDate < callDate) {
    return null;
  }

  const diffMs = signupDate - callDate;
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  return diffDays;
}

/**
 * Calculate Phil's (or other rep's) closing metrics
 * Uses both Stripe and Slack data sources
 *
 * @param {Object} filters
 * @param {string} filters.startDate - Start date (YYYY-MM-DD) - REQUIRED
 * @param {string} filters.endDate - End date (YYYY-MM-DD) - REQUIRED
 * @param {string} filters.rep - Rep name (default: 'Phil')
 * @param {boolean} filters.includeManualCloses - Include manual DFY closes in metrics (default: false)
 * @param {boolean} filters.includeManualOverrides - Include manual lifecycle overrides (default: false)
 * @param {boolean} filters.includeExcludedCalls - Include calls marked as excluded (default: false)
 * @returns {Promise<Object>} - Metrics object
 */
async function getRepMetrics(filters = {}) {
  if (!filters.startDate || !filters.endDate) {
    throw new Error('startDate and endDate are required');
  }

  const rep = filters.rep || 'Phil';
  const includeManualCloses = filters.includeManualCloses || false;
  const includeManualOverrides = filters.includeManualOverrides || false;
  const includeExcludedCalls = filters.includeExcludedCalls || false;

  // Get all SALES calls for the rep in date range
  const allCalls = await getRepSalesCalls(filters);

  // Get exclusion list if we need to filter
  let excludedCallIds = new Set();
  if (!includeExcludedCalls) {
    excludedCallIds = await transcriptDb.getExcludedCallIds();
  }

  // Filter out excluded calls before deduplication
  const includedCalls = allCalls.filter(call => !excludedCallIds.has(call.id));

  // Deduplicate by prospect email (first call only)
  const calls = deduplicateByProspect(includedCalls);

  // Get manual lifecycle overrides if enabled
  let lifecycleOverrides = new Map();
  if (includeManualOverrides) {
    const allOverrides = await transcriptDb.getAllLifecycleOverrides();
    for (const override of allOverrides) {
      lifecycleOverrides.set(override.call_id, override);
    }
  }

  // Get all call inclusions for UI display (convert array to Map)
  const inclusionsArray = await transcriptDb.getAllCallInclusions();
  const allInclusions = new Map();
  for (const inc of inclusionsArray) {
    allInclusions.set(inc.call_id, inc.included === 1);
  }

  // Calculate metrics - now using both Stripe and Slack
  const callCount = calls.length;
  let signupCount = 0;
  let activeCount = 0;
  let churnedCount = 0;
  let teamCount = 0;
  let noCloseCount = 0;
  let stripeMatchCount = 0;
  let slackMatchCount = 0;
  let manualOverrideCount = 0;
  const daysToSignupValues = [];

  // Build call details with combined status
  const callDetails = [];

  for (const call of calls) {
    const prospectEmail = extractProspectEmail(call);

    // Check for manual lifecycle override first
    const override = lifecycleOverrides.get(call.id);
    let finalStatus = null;
    let statusSource = null;
    let isManualOverride = false;

    if (override) {
      // Manual override takes precedence when enabled
      isManualOverride = true;
      manualOverrideCount++;
      finalStatus = {
        isSignedUp: ['signed_up', 'active', 'churned'].includes(override.status),
        isActive: override.status === 'active',
        isChurned: override.status === 'churned',
        isTeam: override.status === 'team',
        isNoClose: override.status === 'no_close',
        source: 'manual',
        status: override.status
      };
      statusSource = 'manual';

      // Count team and no_close
      if (override.status === 'team') {
        teamCount++;
      }
      if (override.status === 'no_close') {
        noCloseCount++;
      }
    } else {
      // Get Slack status for this email (if available)
      let slackStatus = null;
      if (prospectEmail) {
        try {
          slackStatus = await slackIngestionService.getLatestStatusForEmail(prospectEmail);
        } catch (e) {
          // Slack service might not be initialized, continue without it
        }
      }

      // Get combined status from Stripe + Slack
      finalStatus = getCombinedStatus(call.stripeData, slackStatus);
      statusSource = finalStatus.source;

      if (finalStatus.isSignedUp) {
        if (finalStatus.source === 'stripe') {
          stripeMatchCount++;
          const daysToSignup = calculateDaysToSignup(call);
          if (daysToSignup !== null) {
            daysToSignupValues.push(daysToSignup);
          }
        } else if (finalStatus.source === 'slack') {
          slackMatchCount++;
          // Calculate days to signup from Slack event timestamp
          if (slackStatus?.timestamp && call.call_datetime) {
            const callDate = new Date(call.call_datetime);
            const signupDate = new Date(slackStatus.timestamp);
            if (signupDate >= callDate) {
              const diffMs = signupDate - callDate;
              const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
              daysToSignupValues.push(diffDays);
            }
          }
        }
      }
    }

    if (finalStatus.isSignedUp) {
      signupCount++;
    }

    if (finalStatus.isActive) {
      activeCount++;
    }

    if (finalStatus.isChurned) {
      churnedCount++;
    }

    // Build call detail
    let displayStatus = 'Not Matched';
    if (finalStatus.isActive) displayStatus = 'Active';
    else if (finalStatus.isChurned) displayStatus = 'Churned';
    else if (finalStatus.isSignedUp) displayStatus = 'Signed Up';

    // Add manual prefix if override
    if (isManualOverride) {
      displayStatus = `Manual: ${displayStatus}`;
    }

    // Check if this call is included (for UI display)
    const isIncluded = !allInclusions.has(call.id) || allInclusions.get(call.id) === true;

    callDetails.push({
      id: call.id,
      title: call.call_title || 'Untitled Call',
      date: call.call_datetime,
      repName: call.rep_name || 'Unknown',
      prospectEmail,
      stripeStatus: displayStatus,
      source: statusSource,
      status: finalStatus.status,
      isSignedUp: finalStatus.isSignedUp,
      isActive: finalStatus.isActive,
      isChurned: finalStatus.isChurned,
      isManualOverride,
      isIncluded,
      overrideNotes: override?.notes || null
    });
  }

  // Get manual closes if enabled
  let manualCloses = [];
  let manualClosesCount = 0;
  if (includeManualCloses) {
    manualCloses = await transcriptDb.getManualCloses({
      startDate: filters.startDate,
      endDate: filters.endDate,
      rep: rep
    });
    manualClosesCount = manualCloses.length;
    // Add manual closes to signup count (they are won deals = signups)
    signupCount += manualClosesCount;
  }

  // Calculate rates (avoid division by zero)
  // Closing Rate = (signups from calls + manual closes) / included calls
  const signupRate = callCount > 0 ? Math.round((signupCount / callCount) * 100) : 0;
  const activeRate = callCount > 0 ? Math.round((activeCount / callCount) * 100) : 0;
  // Churn Rate = churned / signups (as per user's choice)
  const churnedRate = signupCount > 0 ? Math.round((churnedCount / signupCount) * 100) : 0;

  // Calculate average days to signup
  const avgDaysToSignup = daysToSignupValues.length > 0
    ? Math.round(daysToSignupValues.reduce((a, b) => a + b, 0) / daysToSignupValues.length)
    : null;

  // Count excluded calls
  const excludedCount = allCalls.length - includedCalls.length;

  return {
    rep,
    dateRange: {
      startDate: filters.startDate,
      endDate: filters.endDate
    },
    metrics: {
      callCount,
      signupCount,
      activeCount,
      churnedCount,
      teamCount,
      noCloseCount,
      signupRate,
      activeRate,
      churnedRate,
      avgDaysToSignup
    },
    // Data source breakdown
    dataSources: {
      stripeMatches: stripeMatchCount,
      slackMatches: slackMatchCount,
      manualOverrides: manualOverrideCount,
      manualCloses: manualClosesCount,
      teamMarked: teamCount,
      noCloseMarked: noCloseCount
    },
    // Manual adjustments
    manualCloses: includeManualCloses ? manualCloses : [],
    // Toggle states (for UI)
    toggles: {
      includeManualCloses,
      includeManualOverrides,
      includeExcludedCalls
    },
    // Raw counts for UI display
    rawCallsBeforeDedup: allCalls.length,
    callsDeduped: allCalls.length - calls.length,
    excludedCount,
    includedCount: includedCalls.length,
    // Call details for display
    calls: callDetails,
    generatedAt: new Date().toISOString()
  };
}

/**
 * Refresh signup status for all calls in a date range
 * Uses the full enrichment pipeline: Slack sync -> Calendly -> Stripe
 *
 * @param {Object} filters
 * @param {string} filters.startDate - Start date (YYYY-MM-DD) - REQUIRED
 * @param {string} filters.endDate - End date (YYYY-MM-DD) - REQUIRED
 * @param {string} filters.rep - Rep name (default: 'all')
 * @returns {Promise<Object>} - Refresh stats { checked, updated, newSignups }
 */
async function refreshSignupStatus(filters = {}) {
  if (!filters.startDate || !filters.endDate) {
    throw new Error('startDate and endDate are required');
  }

  const prospectEnrichmentService = require('./prospectEnrichmentService');

  // Get all SALES calls for the date range
  const calls = await getRepSalesCalls(filters);

  const stats = {
    checked: 0,
    updated: 0,
    newSignups: 0,
    stripeUpdates: 0,
    slackUpdates: 0,
    calendlyUpdates: 0
  };

  // First, sync Slack events to get latest lifecycle data
  if (slackIngestionService.isConfigured()) {
    try {
      console.log('[FounderService] Syncing Slack lifecycle events...');
      await slackIngestionService.syncEvents({ maxPages: 5 });
    } catch (e) {
      console.warn('[FounderService] Slack sync error:', e.message);
    }
  }

  // Now enrich each call with the full pipeline
  for (const call of calls) {
    stats.checked++;

    const prospectEmail = extractProspectEmail(call);
    if (!prospectEmail) continue;

    try {
      // Run full enrichment pipeline
      const enrichment = await prospectEnrichmentService.enrichCall(call);

      if (enrichment.error) continue;

      // Check if this is a new/updated match
      const oldStripeData = call.stripeData;
      const wasUnmatched = !oldStripeData || !oldStripeData.matched;
      const isNowMatched = enrichment.isSignedUp;

      // Check which sources contributed
      if (enrichment.sources.includes('slack')) {
        stats.slackUpdates++;
      }
      if (enrichment.sources.includes('calendly')) {
        stats.calendlyUpdates++;
      }
      if (enrichment.sources.includes('stripe')) {
        stats.stripeUpdates++;
      }

      // Determine if we should update
      const statusChanged = oldStripeData?.status !== enrichment.finalStatus;
      const shouldUpdate = wasUnmatched && isNowMatched || statusChanged;

      if (shouldUpdate) {
        // Build stripe_data for storage
        const stripeData = {
          enriched: true,
          matched: enrichment.isSignedUp,
          status: enrichment.finalStatus,
          prospectEmail: enrichment.prospectEmail,
          prospectName: enrichment.prospectName,
          sources: enrichment.sources,
          isSignedUp: enrichment.isSignedUp,
          isActive: enrichment.isActive,
          isChurned: enrichment.isChurned,
          enrichedAt: enrichment.enrichedAt
        };

        // Add Stripe-specific fields
        if (enrichment.stripeData?.matched) {
          Object.assign(stripeData, {
            signupDate: enrichment.stripeData.signupDate,
            customerId: enrichment.stripeData.customerId,
            customerName: enrichment.stripeData.customerName,
            mrr: enrichment.stripeData.mrr,
            matchMethod: enrichment.stripeData.matchMethod
          });
        }

        // Add Slack data
        if (enrichment.slackData) {
          stripeData.slackStatus = enrichment.slackData.status;
          stripeData.slackTimestamp = enrichment.slackData.timestamp;
        }

        await transcriptDb.updateStripeData(call.id, stripeData);
        stats.updated++;

        if (wasUnmatched && isNowMatched) {
          stats.newSignups++;
        }
      }
    } catch (e) {
      console.error(`[FounderService] Enrichment error for ${call.id}:`, e.message);
    }
  }

  return stats;
}

module.exports = {
  getRepMetrics,
  refreshSignupStatus,
  // Exported for testing
  getRepSalesCalls,
  deduplicateByProspect,
  categorizeStripeStatus,
  categorizeSlackStatus,
  getCombinedStatus,
  calculateDaysToSignup,
  extractProspectEmail
};
