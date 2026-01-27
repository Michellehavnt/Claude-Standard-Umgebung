/**
 * Sync Service
 * Coordinates syncing transcripts from Fireflies API to local database
 */

const fireflies = require('./fireflies');
const transcriptDb = require('./transcriptDb');

// Known sales reps - Phil is tracked specially
const KNOWN_REPS = ['Phil', 'Jamie'];

// Rep email patterns for identification
// Jamie I.F. uses jamie@increasing.com
// Phil uses phil@affiliatefinder.ai
const REP_EMAIL_PATTERNS = {
  'Phil': ['phil@affiliatefinder.ai', 'phil@affiliatefinder.io', 'phil@kniroo.com'],
  'Jamie': ['jamie@increasing.com', 'jamie@affiliatefinder.io', 'jamie@kniroo.com']
};

// Rep name patterns for title/participant matching
// These patterns are more specific to avoid false positives (e.g., "Phil Alexander" is a prospect, not Phil the rep)
const REP_NAME_PATTERNS = {
  'Phil': ['phil norris', 'phil -', '- phil', 'with phil'],
  'Jamie': ['jamie i.f.', 'jamie i.f', 'jamie if', 'jamie -', '- jamie', 'with jamie']
};

// Default rep filter (Phil only per user preference)
const DEFAULT_REP_FILTER = 'Phil';

// Valid rep filter values
const VALID_REP_FILTERS = ['all', ...KNOWN_REPS];

// Sync state
let syncInProgress = false;
let currentSyncProgress = null;

/**
 * Check if an email matches a known rep's email patterns
 * @param {string} email - Email to check
 * @returns {string|null} - Rep name if matched, null otherwise
 */
function matchRepByEmail(email) {
  if (!email) return null;
  const emailLower = email.toLowerCase().trim();

  for (const [rep, patterns] of Object.entries(REP_EMAIL_PATTERNS)) {
    if (patterns.some(pattern => emailLower === pattern.toLowerCase())) {
      return rep;
    }
  }
  return null;
}

/**
 * Check if title contains a specific rep pattern (more strict than simple substring match)
 * This avoids false positives like "Phil Alexander" being matched as Phil the sales rep
 * @param {string} title - Call title (lowercase)
 * @param {string} rep - Rep name to check
 * @returns {boolean} - True if rep pattern found
 */
function titleContainsRepPattern(title, rep) {
  const patterns = REP_NAME_PATTERNS[rep] || [];
  return patterns.some(pattern => title.includes(pattern));
}

/**
 * Extract sales rep name from call title or participants
 * Detects if both Jamie and Phil are present in the call
 * Priority: 1) Email patterns (most reliable), 2) Specific name patterns in title, 3) Participant names
 * @param {string} title - Call title
 * @param {Array} participants - List of participants
 * @param {string} organizerEmail - Organizer's email
 * @returns {Object} - { name, email }
 */
function identifySalesRep(title, participants = [], organizerEmail = null) {
  // Map to store rep name -> email (for preserving participant emails)
  const foundReps = new Map();

  // PRIORITY 1: Check organizer email first for rep match (most reliable)
  const organizerRep = matchRepByEmail(organizerEmail);
  if (organizerRep) {
    foundReps.set(organizerRep, organizerEmail);
  }

  // PRIORITY 2: Check participants by email (very reliable)
  if (participants && Array.isArray(participants)) {
    for (const participant of participants) {
      const participantEmail = typeof participant === 'object' ? participant?.email : null;
      const emailRep = matchRepByEmail(participantEmail);
      if (emailRep) {
        foundReps.set(emailRep, participantEmail);
      }
    }
  }

  // If both reps found by email, return early
  if (foundReps.size >= 2) {
    return { name: 'Both', email: organizerEmail };
  }

  // PRIORITY 3: Check title for specific rep patterns (e.g., "Jamie I.F.", "Phil Norris", "Phil -")
  // This avoids false positives like "Phil Alexander" (prospect name)
  if (title) {
    const titleLower = title.toLowerCase();
    for (const rep of KNOWN_REPS) {
      if (titleContainsRepPattern(titleLower, rep)) {
        foundReps.set(rep, organizerEmail);
      }
    }
  }

  // PRIORITY 4: Check participant names for rep full names or specific patterns
  if (participants && Array.isArray(participants)) {
    for (const participant of participants) {
      const participantName = typeof participant === 'string'
        ? participant
        : participant?.name || participant?.displayName || '';

      const participantEmail = typeof participant === 'object' ? participant?.email : null;
      const nameLower = participantName.toLowerCase();

      // Check for specific rep name patterns in participant name
      for (const rep of KNOWN_REPS) {
        const patterns = REP_NAME_PATTERNS[rep] || [];
        // Also check if participant name is exactly or closely matches rep name
        // e.g., "Phil Norris", "Jamie I.F.", "Jamie"
        const isRepName = patterns.some(p => nameLower.includes(p)) ||
                          (rep === 'Jamie' && (nameLower === 'jamie' || nameLower.startsWith('jamie i'))) ||
                          (rep === 'Phil' && (nameLower === 'phil' || nameLower === 'phil norris'));

        if (isRepName) {
          foundReps.set(rep, participantEmail || foundReps.get(rep) || organizerEmail);
        }
      }
    }
  }

  // If both reps found, return "Both"
  if (foundReps.size >= 2) {
    return { name: 'Both', email: organizerEmail };
  }

  // If exactly one rep found, return that rep with their email
  if (foundReps.size === 1) {
    const [[repName, repEmail]] = foundReps.entries();
    return { name: repName, email: repEmail };
  }

  // Default: use organizer as rep
  return {
    name: organizerEmail ? organizerEmail.split('@')[0] : 'Unknown',
    email: organizerEmail
  };
}

/**
 * Transform Fireflies transcript to our database format
 * @param {Object} ffTranscript - Raw Fireflies transcript
 * @param {Object} ffDetails - Detailed transcript with sentences
 * @returns {Object} - Transformed transcript
 */
function transformTranscript(ffTranscript, ffDetails = null) {
  const rep = identifySalesRep(
    ffTranscript.title,
    ffTranscript.participants,
    ffTranscript.organizer_email
  );

  // Build transcript text from sentences if available
  let transcriptText = '';
  if (ffDetails?.sentences && Array.isArray(ffDetails.sentences)) {
    transcriptText = ffDetails.sentences
      .map(s => `${s.speaker_name || 'Unknown'}: ${s.text || s.raw_text || ''}`)
      .join('\n');
  }

  // Fireflies API returns duration in MINUTES, convert to seconds
  // Note: Test/seed data may already be in seconds (values like 1500-2400)
  // Real synced data from Fireflies has values like 20-40 (minutes)
  const rawDuration = ffTranscript.duration || 0;
  // If duration > 100, it's likely already in seconds (test data)
  // If duration <= 100, it's likely in minutes (real Fireflies data)
  const durationSeconds = rawDuration > 100 ? rawDuration : rawDuration * 60;

  // Normalize call datetime to ISO string for consistent sorting
  // Fireflies returns dates as timestamps or ISO strings
  let callDatetime = ffTranscript.date;
  if (typeof callDatetime === 'number') {
    // Convert timestamp to ISO string (handle both seconds and milliseconds)
    const ms = callDatetime > 10000000000 ? callDatetime : callDatetime * 1000;
    callDatetime = new Date(ms).toISOString();
  } else if (typeof callDatetime === 'string' && !callDatetime.includes('T')) {
    // Convert date-only strings to full ISO
    callDatetime = new Date(callDatetime).toISOString();
  }

  return {
    fireflies_id: ffTranscript.id,
    call_title: ffTranscript.title || 'Untitled Call',
    call_datetime: callDatetime,
    duration_seconds: durationSeconds,
    rep_name: rep.name,
    rep_email: rep.email,
    participants: ffTranscript.participants || [],
    transcript_text: transcriptText,
    source_url: ffTranscript.transcript_url || null
  };
}

/**
 * Check if transcript matches rep filter
 * "Both" calls match any individual rep filter (Phil or Jamie)
 * @param {Object} transcript - Transformed transcript with rep_name
 * @param {string} repFilter - 'all', 'Phil', 'Jamie', etc.
 * @returns {boolean} - true if transcript should be included
 */
function matchesRepFilter(transcript, repFilter) {
  if (!repFilter || repFilter === 'all') {
    return true;
  }
  // Case-insensitive comparison - return false if rep_name is null/undefined
  if (!transcript.rep_name) {
    return false;
  }
  const repName = transcript.rep_name.toLowerCase();
  const filter = repFilter.toLowerCase();

  // "Both" calls match any individual rep filter
  if (repName === 'both') {
    return filter === 'phil' || filter === 'jamie';
  }

  return repName === filter;
}

/**
 * Sync new transcripts from Fireflies
 * @param {Object} options - Sync options
 * @param {boolean} options.fetchDetails - Whether to fetch full transcript details
 * @param {number} options.limit - Maximum number of transcripts to sync
 * @param {string} options.repFilter - Filter by rep: 'all' (default), 'Phil', 'Jamie'
 * @param {Function} options.onProgress - Progress callback
 * @returns {Object} - Sync results
 */
async function syncNewTranscripts(options = {}) {
  const { fetchDetails = true, limit = 100, repFilter = DEFAULT_REP_FILTER, onProgress } = options;

  if (syncInProgress) {
    throw new Error('Sync already in progress');
  }

  syncInProgress = true;
  currentSyncProgress = { status: 'starting', fetched: 0, new: 0, updated: 0, skipped_by_rep: 0 };

  const syncId = await transcriptDb.startSyncLog('manual');
  const stats = { fetched: 0, new: 0, updated: 0, skipped_by_rep: 0, errors: [] };

  const log = (message) => {
    console.log(`[Sync ${syncId}] ${message}`);
    if (onProgress) {
      onProgress({ ...currentSyncProgress, message });
    }
  };

  try {
    log('Starting sync...');

    // Get existing Fireflies IDs to identify new transcripts
    const existingIds = await transcriptDb.getExistingFirefliesIds();
    log(`Found ${existingIds.length} existing transcripts in database`);

    // Fetch transcripts from Fireflies
    currentSyncProgress.status = 'fetching';
    log('Fetching transcripts from Fireflies...');

    const transcripts = await fireflies.getNewTranscripts(existingIds);
    stats.fetched = transcripts.length;
    currentSyncProgress.fetched = stats.fetched;
    log(`Fetched ${stats.fetched} new transcripts from Fireflies`);

    // Process each transcript
    currentSyncProgress.status = 'processing';
    let processed = 0;

    // Log rep filter if not 'all'
    if (repFilter && repFilter !== 'all') {
      log(`Filtering for rep: ${repFilter}`);
    }

    for (const ffTranscript of transcripts.slice(0, limit)) {
      try {
        // Optionally fetch full details
        let ffDetails = null;
        if (fetchDetails) {
          try {
            ffDetails = await fireflies.getTranscript(ffTranscript.id);
          } catch (detailError) {
            log(`Warning: Could not fetch details for ${ffTranscript.id}: ${detailError.message}`);
          }
        }

        // Transform transcript
        const transcript = transformTranscript(ffTranscript, ffDetails);

        // Apply rep filter BEFORE inserting into database
        if (!matchesRepFilter(transcript, repFilter)) {
          stats.skipped_by_rep++;
          currentSyncProgress.skipped_by_rep = stats.skipped_by_rep;
          processed++;
          log(`Skipped (rep filter): ${transcript.call_title} (rep: ${transcript.rep_name})`);
          continue;
        }

        // Save to database
        const result = await transcriptDb.saveTranscript(transcript);

        if (result.created) {
          stats.new++;
          currentSyncProgress.new = stats.new;
        } else if (result.updated) {
          stats.updated++;
          currentSyncProgress.updated = stats.updated;
        }

        processed++;
        log(`Processed ${processed}/${Math.min(transcripts.length, limit)}: ${transcript.call_title}`);

        // Small delay to avoid overwhelming APIs
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (transcriptError) {
        stats.errors.push({
          fireflies_id: ffTranscript.id,
          error: transcriptError.message
        });
        log(`Error processing ${ffTranscript.id}: ${transcriptError.message}`);
      }
    }

    // Complete sync log
    await transcriptDb.completeSyncLog(syncId, stats);
    currentSyncProgress.status = 'completed';
    log(`Sync completed: ${stats.new} new, ${stats.updated} updated, ${stats.skipped_by_rep} skipped by rep filter, ${stats.errors.length} errors`);

    return {
      success: true,
      syncId,
      stats,
      message: `Synced ${stats.new} new and ${stats.updated} updated transcripts${stats.skipped_by_rep > 0 ? ` (${stats.skipped_by_rep} skipped by rep filter)` : ''}`
    };

  } catch (error) {
    await transcriptDb.completeSyncLog(syncId, stats, error.message);
    currentSyncProgress.status = 'error';
    log(`Sync failed: ${error.message}`);
    throw error;

  } finally {
    syncInProgress = false;
  }
}

/**
 * Sync transcripts within a date range
 * IMPORTANT: Existing transcripts are NEVER overwritten or duplicated.
 * Only new transcripts (not already in database) are added.
 *
 * @param {string} startDate - Start date (ISO string or YYYY-MM-DD)
 * @param {string} endDate - End date (ISO string or YYYY-MM-DD)
 * @param {Object} options - Sync options
 * @param {string} options.repFilter - Filter by rep: 'all', 'Phil' (default), 'Jamie'
 */
async function syncDateRange(startDate, endDate, options = {}) {
  const { fetchDetails = true, repFilter = DEFAULT_REP_FILTER, onProgress } = options;

  if (syncInProgress) {
    throw new Error('Sync already in progress');
  }

  syncInProgress = true;
  currentSyncProgress = { status: 'starting', fetched: 0, new: 0, skipped: 0, skipped_by_rep: 0 };

  const syncId = await transcriptDb.startSyncLog('date_range');
  const stats = { fetched: 0, new: 0, updated: 0, skipped: 0, skipped_by_rep: 0, errors: [] };

  const log = (message) => {
    console.log(`[Sync ${syncId}] ${message}`);
    if (onProgress) {
      onProgress({ ...currentSyncProgress, message });
    }
  };

  try {
    log(`Starting date range sync: ${startDate} to ${endDate}`);

    // Get existing Fireflies IDs FIRST to skip duplicates
    const existingIds = await transcriptDb.getExistingFirefliesIds();
    const existingSet = new Set(existingIds);
    log(`Found ${existingIds.length} existing transcripts in database (will be skipped)`);

    // Fetch transcripts in date range from Fireflies
    currentSyncProgress.status = 'fetching';
    const allTranscripts = await fireflies.getTranscriptsInDateRange(startDate, endDate);
    stats.fetched = allTranscripts.length;
    currentSyncProgress.fetched = stats.fetched;
    log(`Found ${stats.fetched} transcripts in date range from Fireflies`);

    // Filter out existing transcripts - NEVER re-fetch or update existing ones
    const newTranscripts = allTranscripts.filter(t => !existingSet.has(t.id));
    stats.skipped = allTranscripts.length - newTranscripts.length;
    currentSyncProgress.skipped = stats.skipped;

    if (stats.skipped > 0) {
      log(`Skipping ${stats.skipped} transcripts that already exist in database`);
    }

    if (newTranscripts.length === 0) {
      log('No new transcripts to sync - all calls already exist in database');
      await transcriptDb.completeSyncLog(syncId, stats);
      currentSyncProgress.status = 'completed';

      return {
        success: true,
        syncId,
        stats,
        message: `No new transcripts. ${stats.skipped} already existed.`
      };
    }

    log(`Processing ${newTranscripts.length} new transcripts...`);

    // Log rep filter if not 'all'
    if (repFilter && repFilter !== 'all') {
      log(`Filtering for rep: ${repFilter}`);
    }

    // Process only NEW transcripts
    currentSyncProgress.status = 'processing';
    let processed = 0;

    for (const ffTranscript of newTranscripts) {
      try {
        let ffDetails = null;
        if (fetchDetails) {
          try {
            ffDetails = await fireflies.getTranscript(ffTranscript.id);
          } catch (detailError) {
            log(`Warning: Could not fetch details for ${ffTranscript.id}`);
          }
        }

        const transcript = transformTranscript(ffTranscript, ffDetails);

        // Apply rep filter BEFORE inserting into database
        if (!matchesRepFilter(transcript, repFilter)) {
          stats.skipped_by_rep++;
          currentSyncProgress.skipped_by_rep = stats.skipped_by_rep;
          processed++;
          log(`Skipped (rep filter): ${transcript.call_title} (rep: ${transcript.rep_name})`);
          continue;
        }

        const result = await transcriptDb.saveTranscript(transcript);

        if (result.created) {
          stats.new++;
          currentSyncProgress.new = stats.new;
        }
        // Note: We no longer count "updated" since we skip existing transcripts

        processed++;
        log(`Processed ${processed}/${newTranscripts.length}: ${transcript.call_title}`);

        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (transcriptError) {
        stats.errors.push({
          fireflies_id: ffTranscript.id,
          error: transcriptError.message
        });
      }
    }

    await transcriptDb.completeSyncLog(syncId, stats);
    currentSyncProgress.status = 'completed';
    log(`Sync completed: ${stats.new} new, ${stats.skipped} skipped (already existed), ${stats.skipped_by_rep} skipped by rep filter`);

    return {
      success: true,
      syncId,
      stats,
      message: `Added ${stats.new} new transcripts. ${stats.skipped} already existed.${stats.skipped_by_rep > 0 ? ` ${stats.skipped_by_rep} skipped by rep filter.` : ''}`
    };

  } catch (error) {
    await transcriptDb.completeSyncLog(syncId, stats, error.message);
    currentSyncProgress.status = 'error';
    throw error;

  } finally {
    syncInProgress = false;
  }
}

/**
 * Get current sync progress
 */
function getSyncProgress() {
  return {
    inProgress: syncInProgress,
    progress: currentSyncProgress
  };
}

/**
 * Check if sync is in progress
 */
function isSyncInProgress() {
  return syncInProgress;
}

/**
 * Re-run rep detection on all existing transcripts
 * Updates rep_name and rep_email in the database
 * @returns {Object} - { updated, unchanged, total }
 */
async function redetectAllReps() {
  const transcripts = await transcriptDb.getAllTranscriptsForRepDetection();
  const stats = { updated: 0, unchanged: 0, total: transcripts.length };

  console.log(`[SyncService] Re-detecting reps for ${transcripts.length} transcripts...`);

  for (const t of transcripts) {
    const newRep = identifySalesRep(t.call_title, t.participants, t.organizer_email);

    if (newRep.name !== t.current_rep_name) {
      await transcriptDb.updateRepInfo(t.id, newRep.name, newRep.email);
      stats.updated++;
      console.log(`[SyncService] Updated: "${t.call_title}" - ${t.current_rep_name} → ${newRep.name}`);
    } else {
      stats.unchanged++;
    }
  }

  console.log(`[SyncService] Rep re-detection complete: ${stats.updated} updated, ${stats.unchanged} unchanged`);
  return stats;
}

// Export for testing
module.exports = {
  syncNewTranscripts,
  syncDateRange,
  getSyncProgress,
  isSyncInProgress,
  identifySalesRep,
  transformTranscript,
  matchesRepFilter,
  redetectAllReps,
  KNOWN_REPS,
  DEFAULT_REP_FILTER,
  VALID_REP_FILTERS
};
