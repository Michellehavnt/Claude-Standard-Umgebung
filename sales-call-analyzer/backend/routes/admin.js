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
 * Handles both ISO strings and numeric timestamps
 */
function normalizeDateTime(datetime) {
  if (!datetime) return null;
  if (typeof datetime === 'string') return datetime;
  if (typeof datetime === 'number') {
    // Convert milliseconds to ISO string
    const ms = datetime > 10000000000 ? datetime : datetime * 1000;
    return new Date(ms).toISOString();
  }
  return null;
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
