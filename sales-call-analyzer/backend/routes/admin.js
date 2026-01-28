/**
 * Admin Routes
 * Endpoints for the admin dashboard
 */

const express = require('express');
const router = express.Router();
const transcriptDb = require('../services/transcriptDb');
const syncService = require('../services/syncService');
const { classifyCall, CLASSIFICATION } = require('../services/analyzer');

/**
 * Normalize datetime to ISO string for consistent frontend display
 * Handles ISO strings, numeric timestamps, and Date objects (from PostgreSQL)
 */
function normalizeDateTime(datetime) {
  if (!datetime) return null;
  if (typeof datetime === 'string') return datetime;
  if (datetime instanceof Date) {
    // PostgreSQL returns Date objects - convert to ISO string
    return datetime.toISOString();
  }
  if (typeof datetime === 'number') {
    // Convert milliseconds to ISO string
    const ms = datetime > 10000000000 ? datetime : datetime * 1000;
    return new Date(ms).toISOString();
  }
  // Last resort: try to convert whatever it is
  try {
    return new Date(datetime).toISOString();
  } catch (e) {
    return null;
  }
}

/**
 * GET /api/admin/dashboard
 * Get dashboard data: stats, last sync, recent calls
 */
router.get('/dashboard', async (req, res) => {
  try {
    const [
      callCount,
      lastSyncTime,
      recentCalls,
      syncHistory
    ] = await Promise.all([
      transcriptDb.getTranscriptCount(),
      transcriptDb.getLastSyncTime(),
      transcriptDb.getRecentTranscripts(500),
      transcriptDb.getSyncHistory(5)
    ]);

    const syncProgress = syncService.getSyncProgress();

    res.json({
      success: true,
      data: {
        stats: {
          totalCalls: callCount,
          lastSyncTime: lastSyncTime
        },
        syncStatus: {
          inProgress: syncProgress.inProgress,
          progress: syncProgress.progress
        },
        recentCalls: recentCalls.map(call => {
          const classification = classifyCall(call.call_title);
          return {
            id: call.id,
            fireflies_id: call.fireflies_id,
            title: call.call_title,
            datetime: normalizeDateTime(call.call_datetime),
            duration: call.duration_seconds,
            rep: call.rep_name,
            repEmail: call.rep_email,
            participants: call.participants,
            hasTranscript: !!call.transcript_text,
            hasAnalysis: !!(call.analysis_version && call.analysis_version > 0),
            classification: classification.classification,
            classificationConfidence: classification.confidence,
            classificationReason: classification.reason,
            classificationOverride: call.classification_override || null,
            sourceUrl: call.source_url,
            createdAt: call.created_at,
            updatedAt: call.updated_at
          };
        }),
        syncHistory
      }
    });

  } catch (error) {
    console.error('[Admin] Dashboard error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/admin/calls
 * Get paginated calls list
 */
router.get('/calls', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 500;
    const offset = parseInt(req.query.offset) || 0;
    const startDate = req.query.startDate || null;
    const endDate = req.query.endDate || null;
    const repFilter = req.query.rep || null;

    const calls = await transcriptDb.getRecentTranscripts(limit, offset, { startDate, endDate, repFilter });
    const total = await transcriptDb.getTranscriptCount({ startDate, endDate, repFilter });

    res.json({
      success: true,
      data: {
        calls: calls.map(call => {
          const classification = classifyCall(call.call_title);
          return {
            id: call.id,
            fireflies_id: call.fireflies_id,
            title: call.call_title,
            datetime: normalizeDateTime(call.call_datetime),
            duration: call.duration_seconds,
            rep: call.rep_name,
            repEmail: call.rep_email,
            participants: call.participants,
            hasTranscript: !!call.transcript_text,
            hasAnalysis: !!(call.analysis_version && call.analysis_version > 0),
            classification: classification.classification,
            classificationConfidence: classification.confidence,
            classificationReason: classification.reason,
            classificationOverride: call.classification_override || null,
            sourceUrl: call.source_url,
            createdAt: call.created_at,
            updatedAt: call.updated_at
          };
        }),
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total
        }
      }
    });

  } catch (error) {
    console.error('[Admin] Calls error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/admin/calls/:id
 * Get single call with full transcript and analysis
 */
router.get('/calls/:id', async (req, res) => {
  try {
    const call = await transcriptDb.getTranscriptWithAnalysis(req.params.id);

    if (!call) {
      return res.status(404).json({
        success: false,
        error: 'Call not found'
      });
    }

    res.json({
      success: true,
      data: {
        id: call.id,
        fireflies_id: call.fireflies_id,
        title: call.call_title,
        datetime: call.call_datetime,
        duration: call.duration_seconds,
        rep: call.rep_name,
        repEmail: call.rep_email,
        participants: call.participants,
        transcript: call.transcript_text,
        sourceUrl: call.source_url,
        analysis: call.analysis || null,
        analyzedAt: call.analyzed_at,
        createdAt: call.created_at,
        updatedAt: call.updated_at
      }
    });

  } catch (error) {
    console.error('[Admin] Call detail error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/admin/calls/:id/classification
 * Update the classification override for a call
 */
router.put('/calls/:id/classification', async (req, res) => {
  try {
    const { classification } = req.body;

    // Validate classification value
    const validValues = ['SALES', 'NOT_SALES', null];
    if (!validValues.includes(classification)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid classification. Must be SALES, NOT_SALES, or null'
      });
    }

    const result = await transcriptDb.updateClassificationOverride(req.params.id, classification);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('[Admin] Classification update error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/admin/redetect-reps
 * Re-run rep detection on all existing transcripts
 * Updates rep_name based on improved detection logic
 */
router.post('/redetect-reps', async (req, res) => {
  try {
    console.log('[Admin] Starting rep re-detection...');
    const stats = await syncService.redetectAllReps();

    res.json({
      success: true,
      message: `Rep re-detection complete: ${stats.updated} updated, ${stats.unchanged} unchanged`,
      stats
    });

  } catch (error) {
    console.error('[Admin] Rep re-detection error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/admin/deleted
 * Get deleted calls list
 */
router.get('/deleted', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 500;
    const offset = parseInt(req.query.offset) || 0;
    const startDate = req.query.startDate || null;
    const endDate = req.query.endDate || null;
    const repFilter = req.query.rep || null;

    const calls = await transcriptDb.getDeletedTranscripts(limit, offset, { startDate, endDate, repFilter });
    const total = await transcriptDb.getDeletedTranscriptCount({ startDate, endDate, repFilter });

    res.json({
      success: true,
      data: {
        calls: calls.map(call => {
          const classification = classifyCall(call.call_title);
          return {
            id: call.id,
            fireflies_id: call.fireflies_id,
            title: call.call_title,
            datetime: normalizeDateTime(call.call_datetime),
            duration: call.duration_seconds,
            rep: call.rep_name,
            repEmail: call.rep_email,
            participants: call.participants,
            hasTranscript: !!call.transcript_text,
            hasAnalysis: !!(call.analysis_version && call.analysis_version > 0),
            classification: classification.classification,
            classificationConfidence: classification.confidence,
            classificationReason: classification.reason,
            classificationOverride: call.classification_override || null,
            sourceUrl: call.source_url,
            createdAt: call.created_at,
            updatedAt: call.updated_at,
            deletedAt: call.deleted_at,
            deletedReason: call.deleted_reason
          };
        }),
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total
        }
      }
    });

  } catch (error) {
    console.error('[Admin] Deleted calls error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/admin/calls/:id/restore
 * Restore a single deleted call
 */
router.post('/calls/:id/restore', async (req, res) => {
  try {
    const result = await transcriptDb.restoreTranscript(req.params.id);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Failed to restore call'
      });
    }

    res.json({
      success: true,
      message: 'Call restored successfully'
    });

  } catch (error) {
    console.error('[Admin] Restore error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/admin/diagnose-dates
 * Diagnose NULL date issues - shows what data is available
 */
router.get('/diagnose-dates', async (req, res) => {
  try {
    const dbAdapter = require('../services/dbAdapter');

    // Count NULL dates
    const nullCount = await dbAdapter.query(
      'SELECT COUNT(*) as count FROM transcripts WHERE call_datetime IS NULL'
    );

    // Get sample records with NULL dates
    const samples = await dbAdapter.query(
      'SELECT id, call_title, call_datetime, created_at FROM transcripts WHERE call_datetime IS NULL LIMIT 10'
    );

    // Get sample records with valid dates
    const validSamples = await dbAdapter.query(
      'SELECT id, call_title, call_datetime, created_at FROM transcripts WHERE call_datetime IS NOT NULL LIMIT 5'
    );

    // Also get what the dashboard API would return
    const dashboardCalls = await transcriptDb.getRecentTranscripts(5);
    const dashboardFormatted = dashboardCalls.map(call => ({
      title: call.call_title,
      raw_call_datetime: call.call_datetime,
      normalized_datetime: normalizeDateTime(call.call_datetime)
    }));

    res.json({
      success: true,
      data: {
        nullDateCount: parseInt(nullCount.rows[0].count),
        samplesWithNullDates: samples.rows,
        samplesWithValidDates: validSamples.rows,
        dashboardApiPreview: dashboardFormatted
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/fix-null-dates
 * Fix NULL call_datetime values by:
 * 1. Using created_at as fallback
 * 2. Parsing date from call title if possible
 * 3. Setting to epoch as last resort
 * Safe operation - only updates NULL values, doesn't overwrite existing dates
 */
router.post('/fix-null-dates', async (req, res) => {
  try {
    console.log('[Admin] Starting NULL date fix...');
    const dbAdapter = require('../services/dbAdapter');

    // First, count how many NULL dates we have
    const countResult = await dbAdapter.query(
      'SELECT COUNT(*) as count FROM transcripts WHERE call_datetime IS NULL'
    );
    const nullCount = parseInt(countResult.rows[0].count);

    if (nullCount === 0) {
      return res.json({
        success: true,
        message: 'No NULL dates found - all records already have valid dates',
        fixed: 0,
        total: 0
      });
    }

    // Get all transcripts with NULL call_datetime
    const nullRecords = await dbAdapter.query(
      'SELECT id, call_title, created_at FROM transcripts WHERE call_datetime IS NULL'
    );

    let fixed = 0;
    const currentYear = new Date().getFullYear();

    for (const row of nullRecords.rows) {
      let newDate = null;

      // Strategy 1: Use created_at if available
      if (row.created_at) {
        newDate = row.created_at;
      }
      // Strategy 2: Parse date from call title (e.g., "Jan 23, 12:12 PM" or "Colin Stevenson and Phil Norris")
      else if (row.call_title) {
        // Try to find date patterns in the title
        const datePatterns = [
          // "Jan 23, 12:12 PM" format
          /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i,
          // "January 23, 2025" format
          /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i,
          // "2025-01-23" format
          /\b(\d{4})-(\d{2})-(\d{2})/
        ];

        for (const pattern of datePatterns) {
          const match = row.call_title.match(pattern);
          if (match) {
            try {
              // Parse based on which pattern matched
              if (pattern.source.includes('Jan|Feb')) {
                // Short month format: "Jan 23, 12:12 PM"
                const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
                const month = months[match[1].toLowerCase()];
                const day = parseInt(match[2]);
                let hour = parseInt(match[3]);
                const minute = parseInt(match[4]);
                const isPM = match[5] && match[5].toUpperCase() === 'PM';

                if (isPM && hour < 12) hour += 12;
                if (!isPM && hour === 12) hour = 0;

                const parsedDate = new Date(currentYear, month, day, hour, minute);
                // If date is in future, use last year
                if (parsedDate > new Date()) {
                  parsedDate.setFullYear(currentYear - 1);
                }
                newDate = parsedDate.toISOString();
              } else if (pattern.source.includes('January|February')) {
                // Long month format
                newDate = new Date(match[0]).toISOString();
              } else {
                // ISO format
                newDate = new Date(match[0]).toISOString();
              }
              break;
            } catch (e) {
              console.log(`[Admin] Could not parse date from: ${row.call_title}`);
            }
          }
        }
      }

      // Strategy 3: Use a default date (beginning of 2025) as last resort
      if (!newDate) {
        newDate = '2025-01-01T00:00:00.000Z';
      }

      // Update the record
      await dbAdapter.query(
        'UPDATE transcripts SET call_datetime = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [newDate, row.id]
      );
      fixed++;
    }

    console.log(`[Admin] Fixed ${fixed} NULL dates`);

    res.json({
      success: true,
      message: `Fixed ${fixed} records with NULL call_datetime`,
      fixed: fixed,
      total: nullCount
    });

  } catch (error) {
    console.error('[Admin] Fix NULL dates error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/admin/calls/:id
 * Soft delete a single call
 */
router.delete('/calls/:id', async (req, res) => {
  try {
    const result = await transcriptDb.softDeleteTranscript(req.params.id, 'manual');

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Failed to delete call'
      });
    }

    res.json({
      success: true,
      message: 'Call deleted successfully'
    });

  } catch (error) {
    console.error('[Admin] Delete error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
