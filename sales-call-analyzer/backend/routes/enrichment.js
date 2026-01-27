/**
 * Enrichment Routes
 *
 * API endpoints for the prospect enrichment pipeline.
 * Combines Slack, Calendly, and Stripe data for prospect matching.
 */

const express = require('express');
const router = express.Router();
const prospectEnrichmentService = require('../services/prospectEnrichmentService');
const slackIngestionService = require('../services/slackIngestionService');
const calendlyService = require('../services/calendlyService');
const stripeEnrichmentService = require('../services/stripeEnrichmentService');

/**
 * GET /api/enrichment/status
 * Get configuration status for all enrichment sources
 */
router.get('/status', async (req, res) => {
  try {
    const status = {
      slack: {
        configured: slackIngestionService.isConfigured()
      },
      calendly: {
        configured: calendlyService.isConfigured()
      },
      stripe: {
        configured: stripeEnrichmentService.isConfigured(),
        mode: stripeEnrichmentService.getKeyMode()
      }
    };

    // Test connections if configured
    if (status.slack.configured) {
      const slackTest = await slackIngestionService.testConnection();
      status.slack.connected = slackTest.valid;
      status.slack.teamName = slackTest.teamName;
    }

    if (status.calendly.configured) {
      const calendlyTest = await calendlyService.testConnection();
      status.calendly.connected = calendlyTest.valid;
      status.calendly.user = calendlyTest.user?.name;
    }

    if (status.stripe.configured) {
      const stripeTest = await stripeEnrichmentService.testConnection();
      status.stripe.connected = stripeTest.valid;
    }

    res.json({
      success: true,
      status
    });
  } catch (error) {
    console.error('[Enrichment Route] Status error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/enrichment/stats
 * Get enrichment statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await prospectEnrichmentService.getEnrichmentStats();

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('[Enrichment Route] Stats error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/enrichment/run
 * Run the full enrichment pipeline
 * First syncs Slack, then enriches calls with all sources
 */
router.post('/run', async (req, res) => {
  try {
    const {
      limit = 100,
      syncSlackFirst = true,
      storeResults = true
    } = req.body;

    console.log(`[Enrichment Route] Starting enrichment pipeline (limit: ${limit})`);

    const results = await prospectEnrichmentService.runEnrichmentPipeline({
      limit,
      syncSlackFirst,
      storeResults
    });

    res.json({
      success: true,
      results
    });
  } catch (error) {
    console.error('[Enrichment Route] Pipeline error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/enrichment/slack/sync
 * Sync Slack lifecycle events only
 */
router.post('/slack/sync', async (req, res) => {
  try {
    if (!slackIngestionService.isConfigured()) {
      return res.json({
        success: true,
        data: {
          synced: false,
          reason: 'Slack not configured'
        }
      });
    }

    const { maxPages = 10 } = req.body;

    console.log('[Enrichment Route] Syncing Slack events...');
    const results = await slackIngestionService.syncEvents({ maxPages });

    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('[Enrichment Route] Slack sync error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/enrichment/slack/events
 * Get Slack lifecycle events with optional filters
 */
router.get('/slack/events', async (req, res) => {
  try {
    const {
      limit = 100,
      offset = 0,
      eventType = null,
      email = null
    } = req.query;

    const events = await slackIngestionService.getAllEvents({
      limit: parseInt(limit),
      offset: parseInt(offset),
      eventType,
      email
    });

    res.json({
      success: true,
      data: events
    });
  } catch (error) {
    console.error('[Enrichment Route] Get events error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/enrichment/slack/stats
 * Get Slack event statistics
 */
router.get('/slack/stats', async (req, res) => {
  try {
    const stats = await slackIngestionService.getEventStats();

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('[Enrichment Route] Slack stats error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/enrichment/call/:callId/proof
 * Get detailed proof/reasoning for a call's status
 * Returns human-readable explanation of why the status was determined
 * NOTE: This route MUST be defined BEFORE /call/:callId to avoid route matching issues
 */
router.get('/call/:callId/proof', async (req, res) => {
  try {
    const { callId } = req.params;

    const transcriptDb = require('../services/transcriptDb');
    const transcript = await transcriptDb.getTranscriptById(callId);

    if (!transcript) {
      return res.status(404).json({
        success: false,
        error: 'Call not found'
      });
    }

    const prospectEmail = prospectEnrichmentService.extractProspectEmail(transcript);

    // Get stored enrichment data from database
    let storedData = null;
    if (transcript.stripe_data) {
      try {
        storedData = typeof transcript.stripe_data === 'string'
          ? JSON.parse(transcript.stripe_data)
          : transcript.stripe_data;
      } catch (e) {
        storedData = null;
      }
    }

    // Build proof object with all available sources
    const proof = {
      callId,
      callTitle: transcript.call_title,
      prospectEmail,
      sources: [],
      summary: '',
      details: {},
      storedStatus: storedData?.status || 'unmatched',
      storedMatched: storedData?.matched || false
    };

    // Check for manual override first - this takes priority
    const override = await transcriptDb.getLifecycleOverrideByCallId(callId);
    if (override) {
      proof.sources.push('manual');
      proof.details.manual = {
        status: override.status,
        notes: override.notes,
        createdBy: override.created_by || 'Admin',
        createdAt: override.created_at
      };
      proof.summary = `Manually marked as "${override.status}"${override.notes ? `: ${override.notes}` : ''} by ${override.created_by || 'Admin'} on ${new Date(override.created_at).toLocaleDateString()}`;
    }

    // If we have stored enrichment data, use it for the proof (this is what the table displays)
    if (!override && storedData && storedData.matched) {
      // Build summary from stored data
      const storedSources = storedData.sources || [];

      if (storedSources.includes('stripe') || storedData.customerId) {
        proof.sources.push('stripe');
        proof.details.stripe = {
          customerId: storedData.customerId,
          customerName: storedData.customerName,
          email: storedData.prospectEmail || prospectEmail,
          status: storedData.status,
          signupDate: storedData.signupDate,
          mrr: storedData.mrr,
          matchMethod: storedData.matchMethod
        };

        const signupDate = storedData.signupDate ? new Date(storedData.signupDate).toLocaleDateString() : null;
        proof.summary = `Found in Stripe as "${storedData.status}" customer (ID: ${storedData.customerId})`;
        if (signupDate) {
          proof.summary += ` since ${signupDate}`;
        }
        if (storedData.mrr) {
          proof.summary += ` - MRR: $${storedData.mrr}`;
        }
      }

      if (storedSources.includes('slack') || storedData.slackStatus) {
        proof.sources.push('slack');
        proof.details.slackStored = {
          status: storedData.slackStatus,
          timestamp: storedData.slackTimestamp
        };

        if (!proof.summary && storedData.slackStatus) {
          const slackDate = storedData.slackTimestamp ? new Date(storedData.slackTimestamp).toLocaleDateString() : 'unknown date';
          proof.summary = `Found in Slack with status "${storedData.slackStatus}" on ${slackDate}`;
        }
      }

      // Add enrichment timestamp
      if (storedData.enrichedAt) {
        proof.enrichedAt = storedData.enrichedAt;
      }
    }

    // If no override and no stored data (or not matched), show current live data
    if (!override && (!storedData || !storedData.matched)) {
      // Get current Slack events for this email
      if (prospectEmail && slackIngestionService.isConfigured()) {
        try {
          const slackEvents = await slackIngestionService.getAllEvents({
            email: prospectEmail,
            limit: 10
          });

          if (slackEvents && slackEvents.length > 0) {
            proof.sources.push('slack');
            proof.details.slack = {
              totalEvents: slackEvents.length,
              events: slackEvents.map(e => ({
                type: e.event_type,
                timestamp: e.timestamp,
                channel: e.channel_source,
                message: e.raw_message?.substring(0, 200) + (e.raw_message?.length > 200 ? '...' : ''),
                plan: e.plan,
                cancellationReason: e.cancellation_reason
              }))
            };

            const latestEvent = slackEvents[0];
            const eventDate = new Date(latestEvent.timestamp).toLocaleDateString();
            const channelName = latestEvent.channel_source === 'signup' ? 'signup channel' : 'payment channel';
            proof.summary = `Found in Slack ${channelName} on ${eventDate}: ${latestEvent.event_type}`;
            if (latestEvent.raw_message) {
              proof.summary += ` - "${latestEvent.raw_message.substring(0, 100)}${latestEvent.raw_message.length > 100 ? '...' : ''}"`;
            }
          }
        } catch (e) {
          console.warn('[Enrichment] Error getting Slack events for proof:', e.message);
        }
      }

      // Get current Stripe data
      if (prospectEmail && stripeEnrichmentService.isConfigured() && !proof.details.stripe) {
        try {
          const stripeResult = await stripeEnrichmentService.getEnrichmentByEmail(prospectEmail);

          if (stripeResult && stripeResult.matched) {
            proof.sources.push('stripe');
            proof.details.stripe = {
              customerId: stripeResult.customerId,
              customerName: stripeResult.customerName,
              email: stripeResult.email,
              status: stripeResult.status,
              signupDate: stripeResult.signupDate,
              mrr: stripeResult.mrr,
              subscriptionStatus: stripeResult.subscriptionStatus
            };

            if (!proof.summary) {
              const signupDate = stripeResult.signupDate ? new Date(stripeResult.signupDate).toLocaleDateString() : 'unknown date';
              proof.summary = `Found in Stripe as "${stripeResult.status}" customer (ID: ${stripeResult.customerId})`;
              if (stripeResult.signupDate) {
                proof.summary += ` since ${signupDate}`;
              }
              if (stripeResult.mrr) {
                proof.summary += ` - MRR: $${stripeResult.mrr}`;
              }
            }
          }
        } catch (e) {
          console.warn('[Enrichment] Error getting Stripe data for proof:', e.message);
        }
      }

      // Get Calendly data
      if (prospectEmail && calendlyService.isConfigured()) {
        try {
          const calendlyResult = await calendlyService.enrichWithCalendly({
            email: prospectEmail,
            callDatetime: transcript.call_datetime
          });

          if (calendlyResult.enriched) {
            proof.sources.push('calendly');
            proof.details.calendly = {
              eventName: calendlyResult.calendly?.eventName,
              invitee: calendlyResult.calendly?.invitee,
              responses: calendlyResult.calendly?.responses,
              scheduledAt: calendlyResult.calendly?.scheduledAt
            };
          }
        } catch (e) {
          console.warn('[Enrichment] Error getting Calendly data for proof:', e.message);
        }
      }
    }

    // Default summary if nothing found
    if (!proof.summary) {
      if (prospectEmail) {
        proof.summary = `No enrichment data found for ${prospectEmail}. Status: Not Matched`;
        proof.storedStatus = 'unmatched';
      } else {
        proof.summary = 'No prospect email could be extracted from call participants.';
        proof.storedStatus = 'unmatched';
      }
    }

    res.json({
      success: true,
      data: proof
    });
  } catch (error) {
    console.error('[Enrichment Route] Proof error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/enrichment/call/:callId
 * Get enrichment data for a specific call
 */
router.get('/call/:callId', async (req, res) => {
  try {
    const { callId } = req.params;
    const { refresh = 'false' } = req.query;

    const transcriptDb = require('../services/transcriptDb');
    const transcript = await transcriptDb.getTranscriptById(callId);

    if (!transcript) {
      return res.status(404).json({
        success: false,
        error: 'Call not found'
      });
    }

    // If refresh requested or no existing data, run enrichment
    if (refresh === 'true' || !transcript.stripe_data) {
      const enrichment = await prospectEnrichmentService.reEnrichCall(callId, true);

      return res.json({
        success: true,
        data: {
          callId,
          callTitle: transcript.call_title,
          fromCache: false,
          ...enrichment
        }
      });
    }

    // Return cached data
    let stripeData = transcript.stripe_data;
    if (typeof stripeData === 'string') {
      try {
        stripeData = JSON.parse(stripeData);
      } catch (e) {
        stripeData = {};
      }
    }

    res.json({
      success: true,
      data: {
        callId,
        callTitle: transcript.call_title,
        fromCache: true,
        ...stripeData
      }
    });
  } catch (error) {
    console.error('[Enrichment Route] Call enrichment error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/enrichment/call/:callId/refresh
 * Force re-enrich a specific call
 */
router.post('/call/:callId/refresh', async (req, res) => {
  try {
    const { callId } = req.params;

    const enrichment = await prospectEnrichmentService.reEnrichCall(callId, true);

    res.json({
      success: true,
      data: enrichment
    });
  } catch (error) {
    console.error('[Enrichment Route] Call refresh error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/enrichment/batch
 * Batch enrich calls without Slack sync
 */
router.post('/batch', async (req, res) => {
  try {
    const { limit = 50, storeResults = true } = req.body;

    const results = await prospectEnrichmentService.runEnrichmentPipeline({
      limit,
      syncSlackFirst: false,
      storeResults
    });

    res.json({
      success: true,
      results
    });
  } catch (error) {
    console.error('[Enrichment Route] Batch error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
