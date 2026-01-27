/**
 * Insight Snapshot Routes
 * API endpoints for generating and exporting insight snapshots
 */

const express = require('express');
const router = express.Router();
const snapshotService = require('../services/insightSnapshotService');

/**
 * GET /api/insights/snapshot
 * Generate insight snapshot for a date range
 *
 * Query params:
 * - startDate (required): YYYY-MM-DD
 * - endDate (required): YYYY-MM-DD
 * - rep (optional): filter by rep name
 */
router.get('/', async (req, res) => {
  try {
    const { startDate, endDate, rep } = req.query;

    // Validate required params
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate and endDate are required query parameters'
      });
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({
        success: false,
        error: 'Dates must be in YYYY-MM-DD format'
      });
    }

    // Validate date range
    if (new Date(startDate) > new Date(endDate)) {
      return res.status(400).json({
        success: false,
        error: 'startDate must be before or equal to endDate'
      });
    }

    const filters = { startDate, endDate };
    if (rep) {
      filters.rep = rep;
    }

    const snapshot = await snapshotService.generateSnapshot(filters);

    res.json({
      success: true,
      data: snapshot
    });
  } catch (error) {
    console.error('[Snapshot] Error generating snapshot:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/insights/snapshot/notion
 * Generate snapshot formatted as Notion markdown
 *
 * Same query params as main endpoint
 */
router.get('/notion', async (req, res) => {
  try {
    const { startDate, endDate, rep } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate and endDate are required query parameters'
      });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({
        success: false,
        error: 'Dates must be in YYYY-MM-DD format'
      });
    }

    const filters = { startDate, endDate };
    if (rep) {
      filters.rep = rep;
    }

    const snapshot = await snapshotService.generateSnapshot(filters);
    const markdown = snapshotService.formatForNotion(snapshot);

    res.json({
      success: true,
      content: markdown,
      contentType: 'text/markdown'
    });
  } catch (error) {
    console.error('[Snapshot] Error generating Notion export:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/insights/snapshot/slack
 * Generate snapshot formatted as Slack Block Kit
 *
 * Same query params as main endpoint
 */
router.get('/slack', async (req, res) => {
  try {
    const { startDate, endDate, rep } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate and endDate are required query parameters'
      });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({
        success: false,
        error: 'Dates must be in YYYY-MM-DD format'
      });
    }

    const filters = { startDate, endDate };
    if (rep) {
      filters.rep = rep;
    }

    const snapshot = await snapshotService.generateSnapshot(filters);
    const slackBlocks = snapshotService.formatForSlack(snapshot);

    res.json({
      success: true,
      ...slackBlocks,
      contentType: 'application/json'
    });
  } catch (error) {
    console.error('[Snapshot] Error generating Slack export:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
