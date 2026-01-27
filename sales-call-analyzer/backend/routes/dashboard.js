/**
 * Dashboard Routes
 * API endpoints for the aggregated insights dashboard
 */

const express = require('express');
const router = express.Router();
const dashboardService = require('../services/dashboardAggregationService');

/**
 * GET /api/dashboard
 * Get aggregated dashboard data with optional filters
 *
 * Query params:
 *   - startDate: Start date (YYYY-MM-DD)
 *   - endDate: End date (YYYY-MM-DD)
 *   - rep: Sales rep name filter
 *   - keyword: Keyword search in transcript
 *   - limit: Max items per category (default 10)
 */
router.get('/', async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null,
      rep: req.query.rep || null,
      keyword: req.query.keyword || null,
      limit: parseInt(req.query.limit) || 10
    };

    console.log('[Dashboard] Fetching aggregation with filters:', filters);

    const aggregation = await dashboardService.getDashboardAggregation(filters);

    res.json({
      success: true,
      data: aggregation
    });

  } catch (error) {
    console.error('[Dashboard] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/dashboard/pains
 * Get detailed pain points aggregation
 */
router.get('/pains', async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null,
      rep: req.query.rep || null,
      keyword: req.query.keyword || null
    };

    const transcripts = await dashboardService.getFilteredAnalyzedTranscripts(filters);
    const pains = dashboardService.aggregatePains(transcripts);

    res.json({
      success: true,
      data: {
        total: pains.length,
        items: pains
      }
    });

  } catch (error) {
    console.error('[Dashboard] Pains error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/dashboard/goals
 * Get detailed goals aggregation
 */
router.get('/goals', async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null,
      rep: req.query.rep || null,
      keyword: req.query.keyword || null
    };

    const transcripts = await dashboardService.getFilteredAnalyzedTranscripts(filters);
    const goals = dashboardService.aggregateGoals(transcripts);

    res.json({
      success: true,
      data: {
        total: goals.length,
        items: goals
      }
    });

  } catch (error) {
    console.error('[Dashboard] Goals error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/dashboard/questions
 * Get detailed questions aggregation
 */
router.get('/questions', async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null,
      rep: req.query.rep || null,
      keyword: req.query.keyword || null
    };

    const transcripts = await dashboardService.getFilteredAnalyzedTranscripts(filters);
    const questions = dashboardService.aggregateQuestions(transcripts);

    res.json({
      success: true,
      data: {
        total: questions.length,
        items: questions
      }
    });

  } catch (error) {
    console.error('[Dashboard] Questions error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/dashboard/dislikes
 * Get detailed dislikes/objections aggregation
 */
router.get('/dislikes', async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null,
      rep: req.query.rep || null,
      keyword: req.query.keyword || null
    };

    const transcripts = await dashboardService.getFilteredAnalyzedTranscripts(filters);
    const dislikes = dashboardService.aggregateDislikes(transcripts);

    res.json({
      success: true,
      data: {
        total: dislikes.length,
        items: dislikes
      }
    });

  } catch (error) {
    console.error('[Dashboard] Dislikes error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/dashboard/excitement
 * Get detailed excitement triggers aggregation
 */
router.get('/excitement', async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null,
      rep: req.query.rep || null,
      keyword: req.query.keyword || null
    };

    const transcripts = await dashboardService.getFilteredAnalyzedTranscripts(filters);
    const excitement = dashboardService.aggregateExcitement(transcripts);

    res.json({
      success: true,
      data: {
        total: excitement.length,
        items: excitement
      }
    });

  } catch (error) {
    console.error('[Dashboard] Excitement error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/dashboard/filters
 * Get available filter options (reps, date range)
 */
router.get('/filters', async (req, res) => {
  try {
    const [reps, dateRange] = await Promise.all([
      dashboardService.getUniqueReps(),
      dashboardService.getDateRange()
    ]);

    res.json({
      success: true,
      data: {
        reps,
        dateRange
      }
    });

  } catch (error) {
    console.error('[Dashboard] Filters error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/dashboard/wording
 * Get wording aggregation (industry terms, problem language, power words)
 */
router.get('/wording', async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null,
      rep: req.query.rep || null,
      keyword: req.query.keyword || null
    };

    const wording = await dashboardService.getWordingAggregation(filters);

    res.json({
      success: true,
      data: {
        industryTerms: wording.industryTerms,
        problemLanguage: wording.problemLanguage,
        powerWords: wording.powerWords,
        totals: {
          industryTerms: wording.industryTerms.length,
          problemLanguage: wording.problemLanguage.length,
          powerWords: wording.powerWords.length
        }
      }
    });

  } catch (error) {
    console.error('[Dashboard] Wording error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/dashboard/metaphors
 * Get metaphors and analogies aggregation
 */
router.get('/metaphors', async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null,
      rep: req.query.rep || null,
      keyword: req.query.keyword || null
    };

    const metaphors = await dashboardService.getMetaphorsAggregation(filters);

    res.json({
      success: true,
      data: {
        total: metaphors.length,
        items: metaphors
      }
    });

  } catch (error) {
    console.error('[Dashboard] Metaphors error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
