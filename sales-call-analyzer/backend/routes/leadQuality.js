/**
 * Lead Quality Routes
 * API endpoints for lead quality scoring and management
 */

const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const leadQualityService = require('../services/leadQualityService');
const leadQualityDb = require('../services/leadQualityDb');
const perplexityService = require('../services/perplexityService');
const secretManager = require('../services/secretManager');

/**
 * GET /api/lead-quality/leads
 * Get list of leads with filtering
 */
router.get('/leads', requireAuth, async (req, res) => {
  try {
    const {
      rep = 'all',
      startDate,
      endDate,
      minScore,
      maxScore,
      limit = 100,
      offset = 0,
      sortBy = 'calendly_booking_time',
      sortOrder = 'DESC'
    } = req.query;

    const filters = {
      startDate: startDate || null,
      endDate: endDate || null,
      minScore: minScore ? parseInt(minScore, 10) : null,
      maxScore: maxScore ? parseInt(maxScore, 10) : null,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
      sortBy,
      sortOrder
    };

    const { leads, stats } = await leadQualityService.getLeadsWithStats(rep, filters);
    const count = await leadQualityDb.getLeadCount(rep, filters);

    res.json({
      success: true,
      data: {
        leads,
        stats,
        pagination: {
          total: count,
          limit: filters.limit,
          offset: filters.offset,
          hasMore: filters.offset + leads.length < count
        }
      }
    });
  } catch (error) {
    console.error('[LeadQuality] Error fetching leads:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/lead-quality/leads/:id
 * Get single lead details
 */
router.get('/leads/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const lead = await leadQualityDb.getLead(id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found'
      });
    }

    res.json({
      success: true,
      data: lead
    });
  } catch (error) {
    console.error('[LeadQuality] Error fetching lead:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/lead-quality/stats
 * Get lead quality statistics
 */
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const { rep = 'all', startDate, endDate } = req.query;

    const stats = await leadQualityDb.getStats(rep, {
      startDate: startDate || null,
      endDate: endDate || null
    });

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('[LeadQuality] Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/lead-quality/sync
 * Trigger Calendly sync and lead analysis
 */
router.post('/sync', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rep = 'all', analyzeNew = true, reanalyzeExisting = false, daysBack = 30 } = req.body;

    const result = await leadQualityService.syncAndAnalyzeLeads(rep, {
      analyzeNew,
      reanalyzeExisting,
      daysBack
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error
      });
    }

    res.json({
      success: true,
      message: `Synced ${result.synced} leads, analyzed ${result.analyzed}`,
      data: {
        synced: result.synced,
        analyzed: result.analyzed,
        errors: result.errors
      }
    });
  } catch (error) {
    console.error('[LeadQuality] Error syncing leads:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/lead-quality/analyze/:id
 * Re-analyze a single lead
 */
router.post('/analyze/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!perplexityService.isConfigured()) {
      return res.status(400).json({
        success: false,
        error: 'Perplexity not configured. Add API key in settings.'
      });
    }

    const lead = await leadQualityService.reanalyzeLead(id);

    res.json({
      success: true,
      message: 'Lead re-analyzed',
      data: lead
    });
  } catch (error) {
    console.error('[LeadQuality] Error analyzing lead:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/lead-quality/analyze-transcript/:id
 * Analyze call transcript and re-evaluate lead score
 * Body: { model: 'gpt-5-nano' | 'perplexity-sonar' }
 */
router.post('/analyze-transcript/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { model = 'gpt-5-nano' } = req.body;

    // Validate model
    const validModels = ['gpt-5-nano', 'perplexity-sonar'];
    if (!validModels.includes(model)) {
      return res.status(400).json({
        success: false,
        error: `Invalid model. Valid options: ${validModels.join(', ')}`
      });
    }

    // Check if the selected model's service is configured
    if (model === 'perplexity-sonar') {
      if (!perplexityService.isConfigured()) {
        return res.status(400).json({
          success: false,
          error: 'Perplexity not configured. Add API key in settings.'
        });
      }
    } else {
      const llmService = require('../services/llmService');
      if (!llmService.isConfigured()) {
        return res.status(400).json({
          success: false,
          error: 'OpenAI not configured. Add API key in settings.'
        });
      }
    }

    const result = await leadQualityService.analyzeTranscript(id, { model });

    res.json({
      success: true,
      message: 'Transcript analyzed',
      data: result
    });
  } catch (error) {
    console.error('[LeadQuality] Error analyzing transcript:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/lead-quality/link-transcript/:id
 * Link a transcript to a lead
 */
router.post('/link-transcript/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { transcriptId } = req.body;

    if (!transcriptId) {
      return res.status(400).json({
        success: false,
        error: 'transcriptId is required'
      });
    }

    const lead = await leadQualityService.linkTranscript(id, transcriptId);

    res.json({
      success: true,
      message: 'Transcript linked',
      data: lead
    });
  } catch (error) {
    console.error('[LeadQuality] Error linking transcript:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/lead-quality/fetch-transcript/:id
 * Fetch transcript from Fireflies or link from existing Calls tab
 * Body: { source: 'calls_tab' | 'fireflies', syncToCallsTab: boolean, autoAnalyze: boolean }
 */
router.post('/fetch-transcript/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { source = 'auto', syncToCallsTab = true, autoAnalyze = true } = req.body;

    const result = await leadQualityService.fetchAndLinkTranscript(id, {
      source,
      syncToCallsTab,
      autoAnalyze
    });

    if (!result.success) {
      return res.status(404).json({
        success: false,
        error: result.error || 'Transcript not found'
      });
    }

    res.json({
      success: true,
      message: `Transcript ${result.source === 'calls_tab' ? 'linked from Calls tab' : 'fetched from Fireflies'}`,
      data: result
    });
  } catch (error) {
    console.error('[LeadQuality] Error fetching transcript:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/lead-quality/check-transcript/:id
 * Check if transcript exists for a lead (in Calls tab or Fireflies)
 */
router.get('/check-transcript/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await leadQualityService.checkTranscriptAvailability(id);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('[LeadQuality] Error checking transcript:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PATCH /api/lead-quality/leads/:id
 * Update lead data (website, form responses, etc.)
 */
router.patch('/leads/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { website, calendlyFormResponses, companyName } = req.body;

    const updates = {};
    if (website !== undefined) updates.website = website;
    if (calendlyFormResponses !== undefined) updates.calendly_form_responses =
      typeof calendlyFormResponses === 'string' ? calendlyFormResponses : JSON.stringify(calendlyFormResponses);
    if (companyName !== undefined) updates.company_name = companyName;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update'
      });
    }

    const lead = await leadQualityDb.updateLead(id, updates);

    if (!lead) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found'
      });
    }

    res.json({
      success: true,
      message: 'Lead updated',
      data: lead
    });
  } catch (error) {
    console.error('[LeadQuality] Error updating lead:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/lead-quality/override/:id
 * Set manual score override
 */
router.post('/override/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { score, notes } = req.body;

    // Validate score
    if (score === undefined || score < 1 || score > 10) {
      return res.status(400).json({
        success: false,
        error: 'Score must be between 1 and 10'
      });
    }

    const lead = await leadQualityDb.setOverride(id, score, notes || '', req.user.id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found'
      });
    }

    res.json({
      success: true,
      message: 'Override saved',
      data: lead
    });
  } catch (error) {
    console.error('[LeadQuality] Error setting override:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/lead-quality/override/:id
 * Clear manual score override
 */
router.delete('/override/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const lead = await leadQualityDb.clearOverride(id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found'
      });
    }

    res.json({
      success: true,
      message: 'Override cleared',
      data: lead
    });
  } catch (error) {
    console.error('[LeadQuality] Error clearing override:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/lead-quality/tracked-reps
 * Get list of tracked rep emails
 */
router.get('/tracked-reps', requireAuth, async (req, res) => {
  try {
    const config = secretManager.getPerplexityConfig();

    res.json({
      success: true,
      data: {
        trackedReps: config.trackedReps || []
      }
    });
  } catch (error) {
    console.error('[LeadQuality] Error getting tracked reps:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/lead-quality/tracked-reps
 * Update list of tracked rep emails
 */
router.post('/tracked-reps', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { repEmails } = req.body;

    if (!Array.isArray(repEmails)) {
      return res.status(400).json({
        success: false,
        error: 'repEmails must be an array'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = repEmails.filter(e => !emailRegex.test(e));

    if (invalidEmails.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Invalid email format: ${invalidEmails.join(', ')}`
      });
    }

    const saved = secretManager.saveTrackedReps(repEmails);

    if (!saved) {
      return res.status(500).json({
        success: false,
        error: 'Failed to save tracked reps'
      });
    }

    res.json({
      success: true,
      message: 'Tracked reps updated',
      data: {
        trackedReps: repEmails
      }
    });
  } catch (error) {
    console.error('[LeadQuality] Error saving tracked reps:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/lead-quality/config
 * Get lead quality configuration (Perplexity status, prompt, tracked reps)
 */
router.get('/config', requireAuth, async (req, res) => {
  try {
    const perplexityConfig = secretManager.getPerplexityConfig();
    const calendlyConfigured = require('../services/calendlyService').isConfigured();

    res.json({
      success: true,
      data: {
        perplexity: {
          configured: perplexityConfig.configured,
          maskedKey: perplexityConfig.maskedKey
        },
        calendly: {
          configured: calendlyConfigured
        },
        trackedReps: perplexityConfig.trackedReps || [],
        prompt: perplexityConfig.prompt
      }
    });
  } catch (error) {
    console.error('[LeadQuality] Error getting config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
