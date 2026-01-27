/**
 * Sync Routes
 * Endpoints for syncing transcripts from Fireflies
 */

const express = require('express');
const router = express.Router();
const syncService = require('../services/syncService');
const transcriptDb = require('../services/transcriptDb');

/**
 * GET /api/sync/reps
 * Get available rep filter options
 */
router.get('/reps', async (req, res) => {
  try {
    res.json({
      success: true,
      reps: syncService.VALID_REP_FILTERS,
      knownReps: syncService.KNOWN_REPS,
      defaultFilter: syncService.DEFAULT_REP_FILTER
    });
  } catch (error) {
    console.error('[API] Get reps error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/sync
 * Trigger a manual sync of new transcripts from Fireflies
 * @param {string} repFilter - Optional: 'all', 'Phil' (default), 'Jamie'
 */
router.post('/', async (req, res) => {
  try {
    // Check if sync is already in progress
    if (syncService.isSyncInProgress()) {
      return res.status(409).json({
        success: false,
        error: 'Sync already in progress',
        progress: syncService.getSyncProgress()
      });
    }

    const { fetchDetails = true, limit = 100, repFilter } = req.body;

    // Validate repFilter if provided
    if (repFilter && !syncService.VALID_REP_FILTERS.includes(repFilter)) {
      return res.status(400).json({
        success: false,
        error: `Invalid repFilter. Valid options: ${syncService.VALID_REP_FILTERS.join(', ')}`
      });
    }

    console.log(`[API] Starting manual sync... (repFilter: ${repFilter || syncService.DEFAULT_REP_FILTER})`);

    // Start sync (runs async, but we wait for it)
    const result = await syncService.syncNewTranscripts({
      fetchDetails,
      limit,
      repFilter,
      onProgress: (progress) => {
        console.log(`[API] Sync progress: ${JSON.stringify(progress)}`);
      }
    });

    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('[API] Sync error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/sync/date-range
 * Sync transcripts within a specific date range
 * @param {string} repFilter - Optional: 'all', 'Phil' (default), 'Jamie'
 */
router.post('/date-range', async (req, res) => {
  try {
    if (syncService.isSyncInProgress()) {
      return res.status(409).json({
        success: false,
        error: 'Sync already in progress'
      });
    }

    const { startDate, endDate, fetchDetails = true, repFilter } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate and endDate are required'
      });
    }

    // Validate repFilter if provided
    if (repFilter && !syncService.VALID_REP_FILTERS.includes(repFilter)) {
      return res.status(400).json({
        success: false,
        error: `Invalid repFilter. Valid options: ${syncService.VALID_REP_FILTERS.join(', ')}`
      });
    }

    console.log(`[API] Starting date range sync: ${startDate} to ${endDate} (repFilter: ${repFilter || syncService.DEFAULT_REP_FILTER})`);

    const result = await syncService.syncDateRange(startDate, endDate, {
      fetchDetails,
      repFilter,
      onProgress: (progress) => {
        console.log(`[API] Sync progress: ${JSON.stringify(progress)}`);
      }
    });

    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('[API] Sync error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/sync/status
 * Get current sync status and progress
 */
router.get('/status', async (req, res) => {
  try {
    const progress = syncService.getSyncProgress();
    const lastSync = await transcriptDb.getLastSyncTime();

    res.json({
      ...progress,
      lastSyncTime: lastSync
    });

  } catch (error) {
    console.error('[API] Status error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/sync/history
 * Get sync history
 */
router.get('/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const history = await transcriptDb.getSyncHistory(limit);

    res.json({
      success: true,
      history
    });

  } catch (error) {
    console.error('[API] History error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
