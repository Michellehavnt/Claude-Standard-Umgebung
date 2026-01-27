/**
 * Prospect Enrichment Service
 *
 * Orchestrates the complete enrichment pipeline for sales calls.
 * Uses multiple data sources in priority order to get prospect info and status.
 *
 * ENRICHMENT FLOW (Priority Order):
 * =================================
 * 1. Extract prospect email from call participants
 * 2. Check Slack lifecycle events for signup status
 * 3. Check Calendly for meeting details and additional info
 * 4. Check Stripe for customer status
 * 5. Store combined enrichment data
 *
 * This service coordinates between:
 * - slackIngestionService (Slack lifecycle events)
 * - calendlyService (meeting enrichment)
 * - stripeEnrichmentService (customer status)
 * - transcriptDb (storage)
 */

const transcriptDb = require('./transcriptDb');
const slackIngestionService = require('./slackIngestionService');
const calendlyService = require('./calendlyService');
const stripeEnrichmentService = require('./stripeEnrichmentService');

/**
 * Known sales rep emails to exclude from prospect matching
 */
const SALES_REP_EMAILS = [
  'phil@affiliatefinder.ai',
  'phil@affiliatefinder.io',
  'phil@kniroo.com',
  'jamie@increasing.com',
  'jamie@affiliatefinder.io',
  'jamie@kniroo.com'
];

/**
 * Known sales rep domains to exclude
 */
const SALES_REP_DOMAINS = ['affiliatefinder.io', 'affiliatefinder.ai', 'kniroo.com'];

/**
 * Extract prospect email from call participants
 * Excludes known sales rep emails
 * @param {Object} transcript - Transcript object
 * @returns {string|null} - Prospect email or null
 */
function extractProspectEmail(transcript) {
  // Get participants array
  let participants = transcript.participants;

  // Parse if stored as JSON string
  if (typeof participants === 'string') {
    try {
      participants = JSON.parse(participants);
    } catch (e) {
      participants = [];
    }
  }

  if (!Array.isArray(participants)) {
    participants = [];
  }

  // Find first non-sales-rep email
  for (const p of participants) {
    let email = null;

    if (typeof p === 'string' && p.includes('@')) {
      email = p.toLowerCase().trim();
    } else if (p && typeof p === 'object' && p.email) {
      email = p.email.toLowerCase().trim();
    }

    if (!email) continue;

    // Skip known sales rep emails
    if (SALES_REP_EMAILS.includes(email)) continue;

    // Skip internal domains (but jamie@increasing.com is allowed)
    const domain = email.split('@')[1];
    if (SALES_REP_DOMAINS.includes(domain)) continue;

    return email;
  }

  return null;
}

/**
 * Extract prospect name from call participants
 * @param {Object} transcript - Transcript object
 * @returns {string|null} - Prospect name or null
 */
function extractProspectName(transcript) {
  // Get participants array
  let participants = transcript.participants;

  if (typeof participants === 'string') {
    try {
      participants = JSON.parse(participants);
    } catch (e) {
      participants = [];
    }
  }

  if (!Array.isArray(participants)) {
    return null;
  }

  // Sales rep name patterns to exclude
  const salesRepNames = ['phil', 'jamie', 'phil norris'];

  for (const p of participants) {
    // Check for name field in object
    if (p && typeof p === 'object' && p.name) {
      const name = p.name.trim();
      const lowerName = name.toLowerCase();
      if (!salesRepNames.some(rep => lowerName.includes(rep))) {
        return name;
      }
    }
    // Check for string that's not an email
    if (typeof p === 'string' && !p.includes('@')) {
      const name = p.trim();
      const lowerName = name.toLowerCase();
      if (!salesRepNames.some(rep => lowerName.includes(rep))) {
        return name;
      }
    }
  }

  // Try to extract from call title
  if (transcript.call_title) {
    const titleMatch = transcript.call_title.match(/(?:call with|meeting with|demo with)\s+(.+)/i);
    if (titleMatch && titleMatch[1]) {
      const name = titleMatch[1].split(/[-–—]/)[0].trim();
      const lowerName = name.toLowerCase();
      if (!salesRepNames.some(rep => lowerName.includes(rep))) {
        return name;
      }
    }
  }

  return null;
}

/**
 * Enrich a single call with all available data sources
 * @param {Object} transcript - Transcript object
 * @param {Object} options - Enrichment options
 * @param {boolean} options.skipSlack - Skip Slack lookup
 * @param {boolean} options.skipCalendly - Skip Calendly lookup
 * @param {boolean} options.skipStripe - Skip Stripe lookup
 * @returns {Object} - Combined enrichment data
 */
async function enrichCall(transcript, options = {}) {
  const prospectEmail = extractProspectEmail(transcript);
  const prospectName = extractProspectName(transcript);

  const enrichment = {
    prospectEmail,
    prospectName,
    sources: [],
    slackData: null,
    calendlyData: null,
    stripeData: null,
    finalStatus: 'unmatched',
    isSignedUp: false,
    isActive: false,
    isChurned: false,
    enrichedAt: new Date().toISOString()
  };

  if (!prospectEmail) {
    enrichment.error = 'No prospect email found in participants';
    return enrichment;
  }

  // 1. Check Slack lifecycle events
  if (!options.skipSlack && slackIngestionService.isConfigured()) {
    try {
      const slackStatus = await slackIngestionService.getLatestStatusForEmail(prospectEmail);
      if (slackStatus) {
        enrichment.slackData = slackStatus;
        enrichment.sources.push('slack');

        // Determine status from Slack
        if (slackStatus.status === 'active') {
          enrichment.finalStatus = 'active';
          enrichment.isSignedUp = true;
          enrichment.isActive = true;
        } else if (slackStatus.status === 'trialing') {
          enrichment.finalStatus = 'trialing';
          enrichment.isSignedUp = true;
        } else if (slackStatus.status === 'canceled') {
          enrichment.finalStatus = 'canceled';
          enrichment.isSignedUp = true;
          enrichment.isChurned = true;
        } else if (slackStatus.status === 'registered') {
          enrichment.finalStatus = 'registered';
          enrichment.isSignedUp = true;
        }
      }
    } catch (e) {
      console.warn('[ProspectEnrichment] Slack lookup error:', e.message);
    }
  }

  // 2. Check Calendly for meeting details
  if (!options.skipCalendly && calendlyService.isConfigured()) {
    try {
      const calendlyResult = await calendlyService.enrichWithCalendly({
        email: prospectEmail,
        callDatetime: transcript.call_datetime
      });
      if (calendlyResult.enriched) {
        enrichment.calendlyData = calendlyResult.calendly;
        enrichment.sources.push('calendly');

        // Extract additional info from Calendly responses
        if (calendlyResult.calendly?.invitee) {
          enrichment.prospectName = enrichment.prospectName || calendlyResult.calendly.invitee.name;
        }
        if (calendlyResult.calendly?.responses) {
          // Store responses for potential website/company info
          enrichment.calendlyResponses = calendlyResult.calendly.responses;
        }
      }
    } catch (e) {
      console.warn('[ProspectEnrichment] Calendly lookup error:', e.message);
    }
  }

  // 3. Check Stripe for customer status (highest priority for final status)
  // IMPORTANT: Only look up the specific PROSPECT email, not all participants
  // Previously used enrichCall(transcript) which checked all participants and could match wrong person
  if (!options.skipStripe && stripeEnrichmentService.isConfigured()) {
    try {
      // Use getEnrichmentByEmail with the specific prospect email only
      const stripeResult = await stripeEnrichmentService.getEnrichmentByEmail(prospectEmail);

      if (stripeResult) {
        enrichment.stripeData = {
          enriched: true,
          matchMethod: 'email_exact',
          ...stripeResult
        };

        if (stripeResult.matched) {
          enrichment.sources.push('stripe');

          // Stripe status overrides other sources
          enrichment.finalStatus = stripeResult.status || 'never_subscribed';
          enrichment.isSignedUp = stripeResult.status !== 'unmatched';
          enrichment.isActive = stripeResult.status === 'active';
          enrichment.isChurned = stripeResult.status === 'canceled';
          enrichment.signupDate = stripeResult.signupDate;
          enrichment.customerId = stripeResult.customerId;
          enrichment.customerName = stripeResult.customerName;
          enrichment.mrr = stripeResult.mrr;
        }
      }
    } catch (e) {
      console.warn('[ProspectEnrichment] Stripe lookup error:', e.message);
    }
  }

  return enrichment;
}

/**
 * Batch enrich multiple calls
 * @param {Array} transcripts - Array of transcript objects
 * @param {Object} options - Enrichment options
 * @returns {Object} - Enrichment results { total, enriched, matched, results }
 */
async function batchEnrich(transcripts, options = {}) {
  const results = {
    total: transcripts.length,
    enriched: 0,
    withEmail: 0,
    slackMatches: 0,
    calendlyMatches: 0,
    stripeMatches: 0,
    details: []
  };

  for (const transcript of transcripts) {
    try {
      const enrichment = await enrichCall(transcript, options);

      if (enrichment.prospectEmail) {
        results.withEmail++;
      }
      if (enrichment.slackData) {
        results.slackMatches++;
      }
      if (enrichment.calendlyData) {
        results.calendlyMatches++;
      }
      if (enrichment.stripeData?.matched) {
        results.stripeMatches++;
      }
      if (enrichment.isSignedUp) {
        results.enriched++;
      }

      results.details.push({
        id: transcript.id,
        title: transcript.call_title,
        ...enrichment
      });
    } catch (e) {
      console.error(`[ProspectEnrichment] Error enriching ${transcript.id}:`, e.message);
      results.details.push({
        id: transcript.id,
        error: e.message
      });
    }
  }

  return results;
}

/**
 * Run full enrichment pipeline for all un-enriched calls
 * First syncs Slack events, then enriches calls
 * @param {Object} options
 * @param {number} options.limit - Max calls to enrich (default: 100)
 * @param {boolean} options.syncSlackFirst - Sync Slack events before enriching (default: true)
 * @param {boolean} options.storeResults - Store enrichment results in DB (default: true)
 * @returns {Object} - Pipeline results
 */
async function runEnrichmentPipeline(options = {}) {
  const {
    limit = 100,
    syncSlackFirst = true,
    storeResults = true
  } = options;

  const pipelineResults = {
    startedAt: new Date().toISOString(),
    slackSync: null,
    enrichment: null,
    stored: 0,
    errors: []
  };

  // Step 1: Sync Slack events
  if (syncSlackFirst && slackIngestionService.isConfigured()) {
    try {
      console.log('[ProspectEnrichment] Syncing Slack lifecycle events...');
      pipelineResults.slackSync = await slackIngestionService.syncEvents({ maxPages: 5 });
      console.log(`[ProspectEnrichment] Slack sync complete: ${pipelineResults.slackSync.imported} events imported`);
    } catch (e) {
      console.error('[ProspectEnrichment] Slack sync error:', e.message);
      pipelineResults.errors.push({ stage: 'slack_sync', error: e.message });
    }
  }

  // Step 2: Get calls that need enrichment
  const database = await transcriptDb.getDb();
  const result = database.exec(`
    SELECT * FROM transcripts
    WHERE analysis_json IS NOT NULL
    AND analysis_version > 0
    AND (stripe_data IS NULL OR stripe_data = '' OR stripe_data = '{}')
    ORDER BY call_datetime DESC
    LIMIT ?
  `, [limit]);

  if (!result.length || !result[0].values.length) {
    console.log('[ProspectEnrichment] No calls need enrichment');
    pipelineResults.enrichment = { total: 0, message: 'No calls need enrichment' };
    return pipelineResults;
  }

  // Convert to objects
  const columns = result[0].columns;
  const transcripts = result[0].values.map(row => {
    const obj = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });

  console.log(`[ProspectEnrichment] Found ${transcripts.length} calls to enrich`);

  // Step 3: Enrich calls
  pipelineResults.enrichment = await batchEnrich(transcripts);

  // Step 4: Store results
  if (storeResults) {
    for (const detail of pipelineResults.enrichment.details) {
      if (detail.error) continue;

      try {
        // Build stripe_data object for storage (maintaining compatibility)
        const stripeData = {
          enriched: true,
          matched: detail.isSignedUp,
          status: detail.finalStatus,
          prospectEmail: detail.prospectEmail,
          prospectName: detail.prospectName,
          sources: detail.sources,
          isSignedUp: detail.isSignedUp,
          isActive: detail.isActive,
          isChurned: detail.isChurned,
          enrichedAt: detail.enrichedAt
        };

        // Add Stripe-specific fields if available
        if (detail.stripeData?.matched) {
          stripeData.signupDate = detail.stripeData.signupDate;
          stripeData.customerId = detail.stripeData.customerId;
          stripeData.customerName = detail.stripeData.customerName;
          stripeData.mrr = detail.stripeData.mrr;
          stripeData.subscriptionStartDate = detail.stripeData.subscriptionStartDate;
          stripeData.cancelDate = detail.stripeData.cancelDate;
          stripeData.matchMethod = detail.stripeData.matchMethod;
        }

        // Add Slack data if available
        if (detail.slackData) {
          stripeData.slackStatus = detail.slackData.status;
          stripeData.slackTimestamp = detail.slackData.timestamp;
        }

        // Add Calendly data if available
        if (detail.calendlyData) {
          stripeData.calendlyEventId = detail.calendlyData.eventId;
          stripeData.calendlyEventName = detail.calendlyData.eventName;
        }

        await transcriptDb.updateStripeData(detail.id, stripeData);
        pipelineResults.stored++;
      } catch (e) {
        pipelineResults.errors.push({
          stage: 'store',
          callId: detail.id,
          error: e.message
        });
      }
    }
  }

  pipelineResults.completedAt = new Date().toISOString();
  console.log(`[ProspectEnrichment] Pipeline complete: ${pipelineResults.stored} calls enriched and stored`);

  return pipelineResults;
}

/**
 * Re-enrich a specific call (refresh data)
 * @param {string} callId - Call ID to re-enrich
 * @param {boolean} store - Store results in DB
 * @returns {Object} - Enrichment result
 */
async function reEnrichCall(callId, store = true) {
  const transcript = await transcriptDb.getTranscriptById(callId);

  if (!transcript) {
    throw new Error(`Call not found: ${callId}`);
  }

  const enrichment = await enrichCall(transcript);

  if (store && !enrichment.error) {
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

    if (enrichment.stripeData?.matched) {
      Object.assign(stripeData, {
        signupDate: enrichment.stripeData.signupDate,
        customerId: enrichment.stripeData.customerId,
        customerName: enrichment.stripeData.customerName,
        mrr: enrichment.stripeData.mrr,
        matchMethod: enrichment.stripeData.matchMethod
      });
    }

    if (enrichment.slackData) {
      stripeData.slackStatus = enrichment.slackData.status;
      stripeData.slackTimestamp = enrichment.slackData.timestamp;
    }

    await transcriptDb.updateStripeData(callId, stripeData);
  }

  return enrichment;
}

/**
 * Get enrichment statistics
 * @returns {Object} - Stats about enrichment status
 */
async function getEnrichmentStats() {
  const database = await transcriptDb.getDb();

  const stats = {
    totalCalls: 0,
    analyzedCalls: 0,
    enrichedCalls: 0,
    matchedCalls: 0,
    needsEnrichment: 0,
    byStatus: {}
  };

  // Total calls
  const totalResult = database.exec('SELECT COUNT(*) FROM transcripts');
  stats.totalCalls = totalResult[0]?.values[0]?.[0] || 0;

  // Analyzed calls
  const analyzedResult = database.exec(`
    SELECT COUNT(*) FROM transcripts
    WHERE analysis_json IS NOT NULL AND analysis_version > 0
  `);
  stats.analyzedCalls = analyzedResult[0]?.values[0]?.[0] || 0;

  // Enriched calls
  const enrichedResult = database.exec(`
    SELECT COUNT(*) FROM transcripts
    WHERE stripe_data IS NOT NULL AND stripe_data != '' AND stripe_data != '{}'
  `);
  stats.enrichedCalls = enrichedResult[0]?.values[0]?.[0] || 0;

  // Calls needing enrichment
  stats.needsEnrichment = stats.analyzedCalls - stats.enrichedCalls;

  // Matched calls (have a signup status)
  const matchedResult = database.exec(`
    SELECT COUNT(*) FROM transcripts
    WHERE stripe_data LIKE '%"matched":true%'
  `);
  stats.matchedCalls = matchedResult[0]?.values[0]?.[0] || 0;

  return stats;
}

module.exports = {
  extractProspectEmail,
  extractProspectName,
  enrichCall,
  batchEnrich,
  runEnrichmentPipeline,
  reEnrichCall,
  getEnrichmentStats,
  // Constants
  SALES_REP_EMAILS,
  SALES_REP_DOMAINS
};
