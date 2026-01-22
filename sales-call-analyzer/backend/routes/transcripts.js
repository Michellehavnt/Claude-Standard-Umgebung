const express = require('express');
const router = express.Router();
const fireflies = require('../services/fireflies');
const { getCallByFirefliesId } = require('../services/database');

/**
 * GET /api/transcripts
 * Fetch transcripts from Fireflies API
 */
router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const skip = parseInt(req.query.skip) || 0;

    const transcripts = await fireflies.getTranscripts(limit, skip);

    // Mark which ones we've already analyzed
    const enrichedTranscripts = transcripts.map(t => ({
      ...t,
      analyzed: !!getCallByFirefliesId(t.id)
    }));

    res.json({
      success: true,
      data: enrichedTranscripts,
      count: enrichedTranscripts.length
    });
  } catch (error) {
    console.error('Error fetching transcripts:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/transcripts/:id
 * Fetch a single transcript with full details
 */
router.get('/:id', async (req, res) => {
  try {
    const transcript = await fireflies.getTranscript(req.params.id);

    if (!transcript) {
      return res.status(404).json({
        success: false,
        error: 'Transcript not found'
      });
    }

    // Check if already analyzed
    const existingAnalysis = getCallByFirefliesId(req.params.id);

    res.json({
      success: true,
      data: {
        ...transcript,
        analyzed: !!existingAnalysis,
        existingAnalysis: existingAnalysis?.analysis || null
      }
    });
  } catch (error) {
    console.error('Error fetching transcript:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/transcripts/date-range
 * Fetch transcripts within a date range
 */
router.get('/date-range/:startDate/:endDate', async (req, res) => {
  try {
    const { startDate, endDate } = req.params;

    const transcripts = await fireflies.getTranscriptsInDateRange(startDate, endDate);

    // Mark which ones we've already analyzed
    const enrichedTranscripts = transcripts.map(t => ({
      ...t,
      analyzed: !!getCallByFirefliesId(t.id)
    }));

    res.json({
      success: true,
      data: enrichedTranscripts,
      count: enrichedTranscripts.length
    });
  } catch (error) {
    console.error('Error fetching transcripts:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
