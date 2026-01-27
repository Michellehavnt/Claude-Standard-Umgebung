/**
 * Call Analysis Routes
 * Endpoints for analyzing calls and retrieving analysis results
 */

const express = require('express');
const router = express.Router();
const callAnalysisService = require('../services/callAnalysisService');
const transcriptDb = require('../services/transcriptDb');

/**
 * POST /api/analysis/analyze/:id
 * Analyze a single call
 */
router.post('/analyze/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { force = false } = req.body;

    console.log(`[Analysis] Analyzing call ${id}${force ? ' (forced)' : ''}`);

    const result = await callAnalysisService.analyzeCall(id, { force });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error
      });
    }

    res.json({
      success: true,
      skipped: result.skipped,
      message: result.message,
      analysis: result.analysis
    });

  } catch (error) {
    console.error('[Analysis] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/analysis/batch
 * Analyze multiple calls in batch
 */
router.post('/batch', async (req, res) => {
  try {
    const { limit = 10, force = false } = req.body;

    console.log(`[Analysis] Starting batch analysis (limit: ${limit}, force: ${force})`);

    const results = await callAnalysisService.analyzeBatch({ limit, force });

    console.log(`[Analysis] Batch complete: ${results.analyzed} analyzed, ${results.skipped} skipped, ${results.errors} errors`);

    res.json({
      success: true,
      stats: {
        total: results.total,
        analyzed: results.analyzed,
        skipped: results.skipped,
        errors: results.errors
      },
      details: results.details
    });

  } catch (error) {
    console.error('[Analysis] Batch error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/analysis/:id
 * Get analysis results for a call
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const analysis = await callAnalysisService.getCallAnalysis(id);

    if (!analysis) {
      return res.status(404).json({
        success: false,
        error: 'Analysis not found. Call may not have been analyzed yet.'
      });
    }

    res.json({
      success: true,
      data: analysis
    });

  } catch (error) {
    console.error('[Analysis] Get error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/analysis/:id/insights
 * Get just the insights (pains, goals, questions, dislikes, excitement)
 */
router.get('/:id/insights', async (req, res) => {
  try {
    const { id } = req.params;

    const analysis = await callAnalysisService.getCallAnalysis(id);

    if (!analysis) {
      return res.status(404).json({
        success: false,
        error: 'Analysis not found'
      });
    }

    res.json({
      success: true,
      data: {
        callId: analysis.callId,
        callTitle: analysis.callTitle,
        insights: analysis.insights
      }
    });

  } catch (error) {
    console.error('[Analysis] Insights error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/analysis/status/pending
 * Get count of calls pending analysis
 */
router.get('/status/pending', async (req, res) => {
  try {
    const pending = await transcriptDb.getTranscriptsNeedingAnalysis(
      1000,
      callAnalysisService.ANALYSIS_VERSION
    );

    res.json({
      success: true,
      data: {
        pendingCount: pending.length,
        currentVersion: callAnalysisService.ANALYSIS_VERSION
      }
    });

  } catch (error) {
    console.error('[Analysis] Status error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
