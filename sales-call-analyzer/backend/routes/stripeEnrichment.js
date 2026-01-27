/**
 * Stripe Enrichment Routes
 * API endpoints for Stripe customer matching and enrichment
 */

const express = require('express');
const router = express.Router();
const stripeService = require('../services/stripeEnrichmentService');
const transcriptDb = require('../services/transcriptDb');

/**
 * GET /api/stripe/status
 * Check if Stripe is configured
 */
router.get('/status', (req, res) => {
  res.json({
    success: true,
    configured: stripeService.isConfigured()
  });
});

/**
 * GET /api/stripe/enrich/:callId
 * Enrich a specific call with Stripe data
 */
router.get('/enrich/:callId', async (req, res) => {
  try {
    const callId = req.params.callId;

    // Check if Stripe is configured
    if (!stripeService.isConfigured()) {
      return res.json({
        success: true,
        data: {
          enriched: false,
          reason: 'Stripe not configured'
        }
      });
    }

    // Get transcript
    const transcript = await transcriptDb.getTranscriptById(callId);

    if (!transcript) {
      return res.status(404).json({
        success: false,
        error: 'Call not found'
      });
    }

    // Enrich with Stripe data
    const enrichment = await stripeService.enrichCall(transcript);

    // Optionally store the enrichment
    if (enrichment.matched && req.query.store === 'true') {
      await transcriptDb.updateStripeData(callId, enrichment);
    }

    res.json({
      success: true,
      data: {
        callId,
        callTitle: transcript.call_title,
        ...enrichment
      }
    });

  } catch (error) {
    console.error('[Stripe Route] Error enriching call:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/stripe/lookup
 * Look up a customer by email
 */
router.get('/lookup', async (req, res) => {
  try {
    const email = req.query.email;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email parameter required'
      });
    }

    if (!stripeService.isConfigured()) {
      return res.json({
        success: true,
        data: {
          matched: false,
          reason: 'Stripe not configured'
        }
      });
    }

    const result = await stripeService.getEnrichmentByEmail(email);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('[Stripe Route] Error looking up email:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/stripe/metrics
 * Get conversion metrics for dashboard
 */
router.get('/metrics', async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null,
      rep: req.query.rep || null
    };

    console.log('[Stripe] Fetching conversion metrics with filters:', filters);

    // Get analyzed transcripts
    const db = await transcriptDb.getDb();

    let query = `
      SELECT * FROM transcripts
      WHERE analysis_json IS NOT NULL
      AND analysis_version > 0
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
    if (filters.rep) {
      query += ' AND LOWER(rep_name) = ?';
      params.push(filters.rep.toLowerCase());
    }

    query += ' ORDER BY call_datetime DESC';

    const result = db.exec(query, params);

    if (!result.length) {
      return res.json({
        success: true,
        data: {
          metrics: stripeService.calculateConversionMetrics([]),
          filters
        }
      });
    }

    // Convert to objects and enrich with Stripe data
    const transcripts = rowsToObjects(result[0]);

    // Enrich each transcript that doesn't have stripe_data
    const enrichedTranscripts = [];
    for (const transcript of transcripts) {
      if (transcript.stripe_data) {
        // Already has Stripe data
        enrichedTranscripts.push({
          ...transcript,
          stripeData: typeof transcript.stripe_data === 'string'
            ? JSON.parse(transcript.stripe_data)
            : transcript.stripe_data
        });
      } else if (stripeService.isConfigured()) {
        // Need to enrich
        const enrichment = await stripeService.enrichCall(transcript);
        enrichedTranscripts.push({
          ...transcript,
          stripeData: enrichment
        });
      } else {
        enrichedTranscripts.push({
          ...transcript,
          stripeData: { matched: false, status: 'unmatched' }
        });
      }
    }

    const metrics = stripeService.calculateConversionMetrics(enrichedTranscripts);

    res.json({
      success: true,
      data: {
        metrics,
        filters,
        stripeConfigured: stripeService.isConfigured()
      }
    });

  } catch (error) {
    console.error('[Stripe Route] Error fetching metrics:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/stripe/batch-enrich
 * Enrich multiple calls with Stripe data
 */
router.post('/batch-enrich', async (req, res) => {
  try {
    const { limit = 10, store = false } = req.body;

    if (!stripeService.isConfigured()) {
      return res.json({
        success: true,
        data: {
          enriched: 0,
          reason: 'Stripe not configured'
        }
      });
    }

    // Get transcripts that haven't been enriched
    const db = await transcriptDb.getDb();

    const result = db.exec(`
      SELECT * FROM transcripts
      WHERE analysis_json IS NOT NULL
      AND (stripe_data IS NULL OR stripe_data = '')
      LIMIT ?
    `, [limit]);

    if (!result.length) {
      return res.json({
        success: true,
        data: {
          enriched: 0,
          message: 'No transcripts need enrichment'
        }
      });
    }

    const transcripts = rowsToObjects(result[0]);
    const enrichments = await stripeService.batchEnrich(transcripts);

    // Store results if requested
    let stored = 0;
    if (store) {
      for (const enrichment of enrichments) {
        if (enrichment.enriched) {
          await transcriptDb.updateStripeData(enrichment.id, enrichment);
          stored++;
        }
      }
    }

    res.json({
      success: true,
      data: {
        total: transcripts.length,
        enriched: enrichments.filter(e => e.enriched).length,
        matched: enrichments.filter(e => e.matched).length,
        stored,
        results: enrichments
      }
    });

  } catch (error) {
    console.error('[Stripe Route] Error batch enriching:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/stripe/call/:callId
 * Get Stripe data for a specific call (from DB or fresh lookup)
 */
router.get('/call/:callId', async (req, res) => {
  try {
    const callId = req.params.callId;
    const refresh = req.query.refresh === 'true';

    const transcript = await transcriptDb.getTranscriptById(callId);

    if (!transcript) {
      return res.status(404).json({
        success: false,
        error: 'Call not found'
      });
    }

    // Check for stored data
    if (!refresh && transcript.stripe_data) {
      const stripeData = typeof transcript.stripe_data === 'string'
        ? JSON.parse(transcript.stripe_data)
        : transcript.stripe_data;

      return res.json({
        success: true,
        data: {
          callId,
          callTitle: transcript.call_title,
          fromCache: true,
          ...stripeData
        }
      });
    }

    // Fresh lookup
    if (!stripeService.isConfigured()) {
      return res.json({
        success: true,
        data: {
          callId,
          enriched: false,
          reason: 'Stripe not configured'
        }
      });
    }

    const enrichment = await stripeService.enrichCall(transcript);

    res.json({
      success: true,
      data: {
        callId,
        callTitle: transcript.call_title,
        fromCache: false,
        ...enrichment
      }
    });

  } catch (error) {
    console.error('[Stripe Route] Error getting call Stripe data:', error);
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
    // Parse JSON fields
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
    if (obj.stripe_data && typeof obj.stripe_data === 'string') {
      try {
        obj.stripe_data = JSON.parse(obj.stripe_data);
      } catch (e) {
        obj.stripe_data = null;
      }
    }
    return obj;
  });
}

module.exports = router;
