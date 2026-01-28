/**
 * MRR Routes
 *
 * API endpoints for Monthly Recurring Revenue tracking.
 */

const express = require('express');
const router = express.Router();
const mrrService = require('../services/mrrSnapshotService');

/**
 * GET /api/mrr/current
 * Get current MRR with growth indicators
 */
router.get('/current', async (req, res) => {
  try {
    if (!mrrService.isConfigured()) {
      return res.json({
        success: false,
        error: 'Stripe is not configured'
      });
    }

    const data = await mrrService.getCurrentMrrWithGrowth();

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('[MRR Route] Error getting current MRR:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/mrr/chart
 * Get chart data for last N weeks
 */
router.get('/chart', async (req, res) => {
  try {
    const weeks = parseInt(req.query.weeks) || 4;

    const data = await mrrService.getChartData(weeks);

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('[MRR Route] Error getting chart data:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/mrr/refresh
 * Capture a new MRR snapshot
 */
router.post('/refresh', async (req, res) => {
  try {
    if (!mrrService.isConfigured()) {
      return res.json({
        success: false,
        error: 'Stripe is not configured'
      });
    }

    const snapshot = await mrrService.captureSnapshot();

    res.json({
      success: true,
      data: snapshot
    });
  } catch (error) {
    console.error('[MRR Route] Error capturing snapshot:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/mrr/snapshots
 * Get historical snapshots
 */
router.get('/snapshots', async (req, res) => {
  try {
    const weeks = parseInt(req.query.weeks) || 4;

    const snapshots = await mrrService.getSnapshots(weeks);

    res.json({
      success: true,
      data: snapshots
    });
  } catch (error) {
    console.error('[MRR Route] Error getting snapshots:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/mrr/status
 * Check if MRR tracking is available
 */
router.get('/status', (req, res) => {
  res.json({
    success: true,
    configured: mrrService.isConfigured()
  });
});

module.exports = router;
