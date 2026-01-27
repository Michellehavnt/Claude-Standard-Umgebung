/**
 * Founder Routes
 *
 * Provides founder-facing metrics endpoints, specifically Phil's closing rate.
 *
 * Endpoints:
 * - GET /api/founder/phil - Phil's closing metrics for a date range
 * - GET /api/founder/:rep - Generic rep metrics (optional, same logic)
 */

const express = require('express');
const router = express.Router();
const founderSnapshotService = require('../services/founderSnapshotService');

/**
 * GET /api/founder/phil
 *
 * Returns Phil's closing rate metrics for a given date range.
 *
 * Query parameters:
 * - start_date (required): Start date in YYYY-MM-DD format
 * - end_date (required): End date in YYYY-MM-DD format
 *
 * Response:
 * {
 *   rep: "Phil",
 *   dateRange: { startDate, endDate },
 *   metrics: {
 *     callCount: number,
 *     signupCount: number,
 *     activeCount: number,
 *     churnedCount: number,
 *     signupRate: number (0-100),
 *     activeRate: number (0-100),
 *     churnedRate: number (0-100),
 *     avgDaysToSignup: number | null
 *   },
 *   rawCallsBeforeDedup: number,
 *   callsDeduped: number,
 *   generatedAt: ISO timestamp
 * }
 */
router.get('/phil', async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    // Validate required parameters
    if (!start_date) {
      return res.status(400).json({
        error: 'Missing required parameter: start_date',
        message: 'Please provide start_date in YYYY-MM-DD format'
      });
    }

    if (!end_date) {
      return res.status(400).json({
        error: 'Missing required parameter: end_date',
        message: 'Please provide end_date in YYYY-MM-DD format'
      });
    }

    // Validate date format (basic check)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(start_date)) {
      return res.status(400).json({
        error: 'Invalid start_date format',
        message: 'start_date must be in YYYY-MM-DD format'
      });
    }

    if (!dateRegex.test(end_date)) {
      return res.status(400).json({
        error: 'Invalid end_date format',
        message: 'end_date must be in YYYY-MM-DD format'
      });
    }

    // Validate date range
    if (new Date(start_date) > new Date(end_date)) {
      return res.status(400).json({
        error: 'Invalid date range',
        message: 'start_date must be before or equal to end_date'
      });
    }

    // Parse toggle parameters
    const includeManualCloses = req.query.includeManualCloses === 'true';
    const includeManualOverrides = req.query.includeManualOverrides === 'true';
    const includeExcludedCalls = req.query.includeExcludedCalls === 'true';

    const metrics = await founderSnapshotService.getRepMetrics({
      startDate: start_date,
      endDate: end_date,
      rep: 'Phil',
      includeManualCloses,
      includeManualOverrides,
      includeExcludedCalls
    });

    res.json(metrics);

  } catch (error) {
    console.error('[FounderRoutes] Error getting Phil metrics:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/founder/refresh
 *
 * Re-checks Stripe, Slack, and Calendly for all calls in the date range to see if
 * any prospects have signed up since the last check.
 *
 * Query parameters:
 * - start_date (required): Start date in YYYY-MM-DD format
 * - end_date (required): End date in YYYY-MM-DD format
 * - rep: Rep filter (optional, default 'all')
 *
 * Response: Updated metrics with fresh data
 */
router.post('/refresh', async (req, res) => {
  try {
    const { start_date, end_date, rep = 'all' } = req.query;

    // Validate required parameters
    if (!start_date || !end_date) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'Please provide start_date and end_date in YYYY-MM-DD format'
      });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(start_date) || !dateRegex.test(end_date)) {
      return res.status(400).json({
        error: 'Invalid date format',
        message: 'Dates must be in YYYY-MM-DD format'
      });
    }

    // Re-check Stripe/Slack/Calendly for updated sign-ups
    const refreshResult = await founderSnapshotService.refreshSignupStatus({
      startDate: start_date,
      endDate: end_date,
      rep
    });

    // Parse toggle parameters
    const includeManualCloses = req.query.includeManualCloses === 'true';
    const includeManualOverrides = req.query.includeManualOverrides === 'true';
    const includeExcludedCalls = req.query.includeExcludedCalls === 'true';

    // Get updated metrics
    const metrics = await founderSnapshotService.getRepMetrics({
      startDate: start_date,
      endDate: end_date,
      rep,
      includeManualCloses,
      includeManualOverrides,
      includeExcludedCalls
    });

    res.json({
      ...metrics,
      refreshed: true,
      refreshStats: refreshResult
    });

  } catch (error) {
    console.error('[FounderRoutes] Error refreshing metrics:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/founder/:rep
 *
 * Returns closing rate metrics for any rep.
 * Same parameters and response as /phil endpoint.
 */
router.get('/:rep', async (req, res) => {
  try {
    const { rep } = req.params;
    const { start_date, end_date } = req.query;

    // Validate required parameters
    if (!start_date) {
      return res.status(400).json({
        error: 'Missing required parameter: start_date',
        message: 'Please provide start_date in YYYY-MM-DD format'
      });
    }

    if (!end_date) {
      return res.status(400).json({
        error: 'Missing required parameter: end_date',
        message: 'Please provide end_date in YYYY-MM-DD format'
      });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(start_date)) {
      return res.status(400).json({
        error: 'Invalid start_date format',
        message: 'start_date must be in YYYY-MM-DD format'
      });
    }

    if (!dateRegex.test(end_date)) {
      return res.status(400).json({
        error: 'Invalid end_date format',
        message: 'end_date must be in YYYY-MM-DD format'
      });
    }

    // Validate date range
    if (new Date(start_date) > new Date(end_date)) {
      return res.status(400).json({
        error: 'Invalid date range',
        message: 'start_date must be before or equal to end_date'
      });
    }

    // Parse toggle parameters
    const includeManualCloses = req.query.includeManualCloses === 'true';
    const includeManualOverrides = req.query.includeManualOverrides === 'true';
    const includeExcludedCalls = req.query.includeExcludedCalls === 'true';

    const metrics = await founderSnapshotService.getRepMetrics({
      startDate: start_date,
      endDate: end_date,
      rep: rep,
      includeManualCloses,
      includeManualOverrides,
      includeExcludedCalls
    });

    res.json(metrics);

  } catch (error) {
    console.error(`[FounderRoutes] Error getting ${req.params.rep} metrics:`, error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

module.exports = router;
