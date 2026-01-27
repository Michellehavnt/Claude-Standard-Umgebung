/**
 * Search Routes
 * API endpoints for full-text search functionality
 */

const express = require('express');
const router = express.Router();
const searchService = require('../services/searchService');

/**
 * GET /api/search
 * Search transcripts using full-text search
 * Query params:
 *   - q: Search query (required)
 *   - limit: Maximum results (default 50)
 *   - offset: Pagination offset (default 0)
 *   - repName: Filter by rep name
 *   - dateFrom: Filter by date from (ISO string)
 *   - dateTo: Filter by date to (ISO string)
 */
router.get('/', async (req, res) => {
  try {
    const { q, limit, offset, repName, dateFrom, dateTo } = req.query;

    if (!q || q.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }

    const options = {
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
      repName: repName || null,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null
    };

    // Validate limit and offset
    if (isNaN(options.limit) || options.limit < 1 || options.limit > 100) {
      options.limit = 50;
    }
    if (isNaN(options.offset) || options.offset < 0) {
      options.offset = 0;
    }

    const result = await searchService.searchTranscripts(q, options);

    if (result.error) {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }

    res.json({
      success: true,
      query: q,
      total: result.total,
      limit: options.limit,
      offset: options.offset,
      results: result.results
    });
  } catch (error) {
    console.error('[Search] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/search/suggestions
 * Get search suggestions based on partial query
 * Query params:
 *   - q: Partial search query (required)
 *   - limit: Maximum suggestions (default 5)
 */
router.get('/suggestions', async (req, res) => {
  try {
    const { q, limit } = req.query;

    if (!q || q.trim().length < 2) {
      return res.json({
        success: true,
        suggestions: []
      });
    }

    const maxLimit = limit ? Math.min(parseInt(limit, 10), 10) : 5;
    const suggestions = await searchService.getSearchSuggestions(q, maxLimit);

    res.json({
      success: true,
      suggestions
    });
  } catch (error) {
    console.error('[Search] Suggestions error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/search/reindex
 * Rebuild the search index (admin only)
 * This can be used if the index gets out of sync
 */
router.post('/reindex', async (req, res) => {
  try {
    await searchService.rebuildSearchIndex();

    res.json({
      success: true,
      message: 'Search index rebuilt successfully'
    });
  } catch (error) {
    console.error('[Search] Reindex error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
