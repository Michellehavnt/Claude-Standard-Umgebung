/**
 * DFY Pitch Routes
 * API endpoints for DFY pitch detection and analysis
 */

const express = require('express');
const router = express.Router();
const transcriptDb = require('../services/transcriptDb');
const dfyPitchService = require('../services/dfyPitchService');
const {
  analyzeDFYQualification,
  aggregateDFYQualificationStats,
  buildDFYFunnel
} = require('../services/dfyQualificationService');

/**
 * GET /api/dfy/phil
 * Get all DFY pitches for Phil with optional filters
 *
 * Query params:
 *   - startDate: Start date (YYYY-MM-DD)
 *   - endDate: End date (YYYY-MM-DD)
 *   - triggerCategory: Filter by trigger category (PAIN, TIME, BUDGET, etc.)
 *   - minConfidence: Minimum confidence score (0-100)
 */
router.get('/phil', async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null,
      triggerCategory: req.query.triggerCategory || null,
      minConfidence: parseInt(req.query.minConfidence) || 0
    };

    console.log('[DFY] Fetching Phil\'s DFY pitches with filters:', filters);

    // Get Phil's analyzed transcripts
    const db = await transcriptDb.getDb();

    let query = `
      SELECT * FROM transcripts
      WHERE analysis_json IS NOT NULL
      AND analysis_version > 0
      AND LOWER(rep_name) = 'phil'
    `;
    const params = [];

    if (filters.startDate) {
      query += ' AND call_datetime >= ?';
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      query += ' AND call_datetime <= ?';
      params.push(filters.endDate + 'T23:59:59Z');
    }

    query += ' ORDER BY call_datetime DESC';

    const result = db.exec(query, params);

    if (!result.length) {
      return res.json({
        success: true,
        data: {
          summary: {
            totalCalls: 0,
            callsWithDFYPitch: 0,
            totalPitches: 0,
            averageConfidence: 0
          },
          pitches: []
        }
      });
    }

    // Convert to objects
    const transcripts = rowsToObjects(result[0]);

    // Aggregate DFY pitches
    const aggregation = dfyPitchService.aggregateDFYPitches(transcripts);

    // Apply additional filters
    let filteredPitches = aggregation.pitches;

    if (filters.triggerCategory) {
      filteredPitches = filteredPitches.filter(p =>
        p.trigger.category === filters.triggerCategory
      );
    }

    if (filters.minConfidence > 0) {
      filteredPitches = filteredPitches.filter(p =>
        p.confidence >= filters.minConfidence
      );
    }

    res.json({
      success: true,
      data: {
        summary: aggregation.summary,
        pitches: filteredPitches,
        filters
      }
    });

  } catch (error) {
    console.error('[DFY] Error fetching Phil\'s pitches:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/dfy/call/:id
 * Get DFY pitches for a specific call
 */
router.get('/call/:id', async (req, res) => {
  try {
    const callId = req.params.id;

    const transcript = await transcriptDb.getTranscriptWithAnalysis(callId);

    if (!transcript) {
      return res.status(404).json({
        success: false,
        error: 'Call not found'
      });
    }

    // Get DFY pitches from stored analysis or detect fresh
    let dfyPitches;

    if (transcript.analysis && transcript.analysis.dfyPitches) {
      dfyPitches = transcript.analysis.dfyPitches;
    } else {
      // Detect fresh if not in analysis
      const pitches = dfyPitchService.detectDFYPitches(transcript);
      dfyPitches = {
        detected: pitches.length > 0,
        count: pitches.length,
        pitches
      };
    }

    res.json({
      success: true,
      data: {
        callId,
        callTitle: transcript.call_title,
        repName: transcript.rep_name,
        dfyPitches
      }
    });

  } catch (error) {
    console.error('[DFY] Error fetching call pitches:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/dfy/triggers
 * Get available trigger categories for filtering
 */
router.get('/triggers', (req, res) => {
  const triggers = Object.entries(dfyPitchService.TRIGGER_CATEGORIES).map(([key, value]) => ({
    category: key,
    name: value.name
  }));

  res.json({
    success: true,
    data: {
      triggers
    }
  });
});

/**
 * GET /api/dfy/summary
 * Get DFY pitch summary statistics for Phil
 */
router.get('/summary', async (req, res) => {
  try {
    const db = await transcriptDb.getDb();

    // Get all Phil's analyzed transcripts
    const result = db.exec(`
      SELECT * FROM transcripts
      WHERE analysis_json IS NOT NULL
      AND analysis_version > 0
      AND LOWER(rep_name) = 'phil'
      ORDER BY call_datetime DESC
    `);

    if (!result.length) {
      return res.json({
        success: true,
        data: {
          totalCalls: 0,
          callsWithDFYPitch: 0,
          totalPitches: 0,
          averageConfidence: 0,
          triggerBreakdown: {},
          recentPitches: []
        }
      });
    }

    const transcripts = rowsToObjects(result[0]);
    const aggregation = dfyPitchService.aggregateDFYPitches(transcripts);

    res.json({
      success: true,
      data: {
        ...aggregation.summary,
        recentPitches: aggregation.pitches.slice(0, 5) // Last 5 pitches
      }
    });

  } catch (error) {
    console.error('[DFY] Error fetching summary:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/dfy/detect/:id
 * Detect DFY pitches for a specific call (re-detect)
 */
router.post('/detect/:id', async (req, res) => {
  try {
    const callId = req.params.id;

    const transcript = await transcriptDb.getTranscriptById(callId);

    if (!transcript) {
      return res.status(404).json({
        success: false,
        error: 'Call not found'
      });
    }

    // Detect DFY pitches
    const pitches = dfyPitchService.detectDFYPitches(transcript);

    res.json({
      success: true,
      data: {
        callId,
        callTitle: transcript.call_title,
        repName: transcript.rep_name,
        detected: pitches.length > 0,
        count: pitches.length,
        pitches
      }
    });

  } catch (error) {
    console.error('[DFY] Error detecting pitches:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/dfy/quality
 * Get DFY quality/qualification data for Phil's calls
 *
 * Query params:
 *   - startDate: Start date (YYYY-MM-DD)
 *   - endDate: End date (YYYY-MM-DD)
 *   - qualityFlag: Filter by quality flag (clean, risky, unclear)
 *   - minScore: Minimum qualification score (0-4)
 */
router.get('/quality', async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null,
      qualityFlag: req.query.qualityFlag || null,
      minScore: parseInt(req.query.minScore) || 0
    };

    console.log('[DFY] Fetching Phil\'s DFY quality data with filters:', filters);

    // Get Phil's analyzed transcripts
    const db = await transcriptDb.getDb();

    let query = `
      SELECT * FROM transcripts
      WHERE analysis_json IS NOT NULL
      AND analysis_version > 0
      AND LOWER(rep_name) = 'phil'
    `;
    const params = [];

    if (filters.startDate) {
      query += ' AND call_datetime >= ?';
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      query += ' AND call_datetime <= ?';
      params.push(filters.endDate + 'T23:59:59Z');
    }

    query += ' ORDER BY call_datetime DESC';

    const result = db.exec(query, params);

    if (!result.length) {
      return res.json({
        success: true,
        data: {
          stats: aggregateDFYQualificationStats([]),
          funnel: buildDFYFunnel([]),
          calls: []
        }
      });
    }

    // Convert to objects
    const transcripts = rowsToObjects(result[0]);

    // Analyze each transcript for DFY qualification
    const qualifications = [];
    const calls = [];

    for (const transcript of transcripts) {
      // Check if qualification already exists in analysis
      let qualification;
      if (transcript.analysis && transcript.analysis.dfyQualification) {
        qualification = transcript.analysis.dfyQualification;
      } else {
        // Analyze on the fly if not stored
        qualification = analyzeDFYQualification(transcript);
      }

      // Apply filters
      if (filters.qualityFlag && qualification.dfy_quality_flag !== filters.qualityFlag) {
        continue;
      }
      if (filters.minScore > 0 && qualification.dfy_qualification_score < filters.minScore) {
        continue;
      }

      qualifications.push(qualification);

      // Build call object for list view
      calls.push({
        id: transcript.id,
        callTitle: transcript.call_title,
        callDate: transcript.call_datetime,
        duration: transcript.duration_seconds,
        repName: transcript.rep_name,
        dfy_pitched: qualification.dfy_pitched,
        dfy_offer_type: qualification.dfy_offer_type,
        dfy_qualification_score: qualification.dfy_qualification_score,
        dfy_quality_flag: qualification.dfy_quality_flag,
        budget_asked: qualification.budget_asked,
        budget_fit_for_dfy: qualification.budget_fit_for_dfy,
        proposal_promised: qualification.proposal_promised,
        discovery_booked_for_dfy: qualification.discovery_booked_for_dfy,
        software_pitched: qualification.software_pitched,
        software_close_attempted: qualification.software_close_attempted,
        criteria_no_time: qualification.criteria_no_time,
        criteria_buyer_intent: qualification.criteria_buyer_intent,
        criteria_budget_validated: qualification.criteria_budget_validated
      });
    }

    // Calculate aggregate stats and funnel
    const stats = aggregateDFYQualificationStats(qualifications);
    const funnel = buildDFYFunnel(qualifications);

    res.json({
      success: true,
      data: {
        stats,
        funnel,
        calls,
        filters
      }
    });

  } catch (error) {
    console.error('[DFY] Error fetching quality data:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/dfy/quality/call/:id
 * Get detailed DFY qualification for a specific call with full evidence
 */
router.get('/quality/call/:id', async (req, res) => {
  try {
    const callId = req.params.id;

    const transcript = await transcriptDb.getTranscriptWithAnalysis(callId);

    if (!transcript) {
      return res.status(404).json({
        success: false,
        error: 'Call not found'
      });
    }

    // Get or compute qualification
    let qualification;
    if (transcript.analysis && transcript.analysis.dfyQualification) {
      qualification = transcript.analysis.dfyQualification;
    } else {
      qualification = analyzeDFYQualification(transcript);
    }

    res.json({
      success: true,
      data: {
        callId,
        callTitle: transcript.call_title,
        callDate: transcript.call_datetime,
        repName: transcript.rep_name,
        duration: transcript.duration_seconds,
        qualification,
        // Include DFY pitches if available
        dfyPitches: transcript.analysis?.dfyPitches || null
      }
    });

  } catch (error) {
    console.error('[DFY] Error fetching call quality:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/dfy/quality/reanalyze/:id
 * Re-analyze DFY qualification for a specific call
 */
router.post('/quality/reanalyze/:id', async (req, res) => {
  try {
    const callId = req.params.id;

    const transcript = await transcriptDb.getTranscriptById(callId);

    if (!transcript) {
      return res.status(404).json({
        success: false,
        error: 'Call not found'
      });
    }

    // Re-analyze qualification
    const qualification = analyzeDFYQualification(transcript);

    // Update analysis if it exists
    if (transcript.analysis_json) {
      const analysis = JSON.parse(transcript.analysis_json);
      analysis.dfyQualification = qualification;
      await transcriptDb.saveAnalysis(callId, analysis, analysis.version || 2);
    }

    res.json({
      success: true,
      data: {
        callId,
        callTitle: transcript.call_title,
        qualification
      }
    });

  } catch (error) {
    console.error('[DFY] Error reanalyzing call:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Helper function to convert SQL.js result to objects
function rowsToObjects(result) {
  const columns = result.columns;
  return result.values.map(row => {
    const obj = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    if (obj.participants && typeof obj.participants === 'string') {
      try {
        obj.participants = JSON.parse(obj.participants);
      } catch (e) {
        obj.participants = [];
      }
    }
    if (obj.analysis_json && typeof obj.analysis_json === 'string') {
      try {
        obj.analysis = JSON.parse(obj.analysis_json);
      } catch (e) {
        obj.analysis = null;
      }
    }
    return obj;
  });
}

module.exports = router;
