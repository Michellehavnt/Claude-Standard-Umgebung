/**
 * Settings Routes
 * API endpoints for managing application settings and integrations
 * IMPORTANT: These routes NEVER expose raw API keys
 *
 * Access Control:
 * - GET routes: All authenticated users can view settings
 * - POST/DELETE routes: Admin-only for write operations
 */

const express = require('express');
const router = express.Router();
const secretManager = require('../services/secretManager');
const reanalysisService = require('../services/reanalysisService');
const transcriptDb = require('../services/transcriptDb');
const llmService = require('../services/llmService');
const { requireAuth, requireAdmin } = require('../middleware/auth');

/**
 * GET /api/settings/integrations
 * Get status of all integrations (with masked keys)
 * NEVER returns actual API keys
 */
router.get('/integrations', (req, res) => {
  try {
    const status = secretManager.getIntegrationStatus();

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('[Settings] Error getting integration status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/settings/integrations/fireflies
 * Save Fireflies API key (admin-only)
 * Accepts key in request body, saves to secrets.json
 */
router.post('/integrations/fireflies', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { apiKey } = req.body;

    if (!apiKey || typeof apiKey !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'API key is required'
      });
    }

    // Validate the key before saving
    const validation = await secretManager.validateFirefliesKey(apiKey);

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: `Invalid API key: ${validation.error}`
      });
    }

    // Save the key
    const saved = secretManager.saveSecret('FIREFLIES_API_KEY', apiKey);

    if (!saved) {
      return res.status(500).json({
        success: false,
        error: 'Failed to save API key'
      });
    }

    res.json({
      success: true,
      message: 'Fireflies API key saved successfully',
      data: {
        configured: true,
        maskedKey: secretManager.getMaskedKey('FIREFLIES_API_KEY'),
        validatedEmail: validation.email
      }
    });
  } catch (error) {
    console.error('[Settings] Error saving Fireflies key:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/settings/integrations/stripe
 * Save Stripe API key (admin-only)
 * Accepts key in request body, saves to secrets.json
 */
router.post('/integrations/stripe', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { apiKey } = req.body;

    if (!apiKey || typeof apiKey !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'API key is required'
      });
    }

    // Validate the key before saving
    const validation = await secretManager.validateStripeKey(apiKey);

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: `Invalid API key: ${validation.error}`
      });
    }

    // Save the key
    const saved = secretManager.saveSecret('STRIPE_API_KEY', apiKey);

    if (!saved) {
      return res.status(500).json({
        success: false,
        error: 'Failed to save API key'
      });
    }

    res.json({
      success: true,
      message: 'Stripe API key saved successfully',
      data: {
        configured: true,
        maskedKey: secretManager.getMaskedKey('STRIPE_API_KEY')
      }
    });
  } catch (error) {
    console.error('[Settings] Error saving Stripe key:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/settings/integrations/fireflies
 * Delete Fireflies API key (admin-only)
 */
router.delete('/integrations/fireflies', requireAuth, requireAdmin, (req, res) => {
  try {
    const deleted = secretManager.deleteSecret('FIREFLIES_API_KEY');

    if (!deleted) {
      return res.status(500).json({
        success: false,
        error: 'Failed to delete API key'
      });
    }

    res.json({
      success: true,
      message: 'Fireflies API key deleted'
    });
  } catch (error) {
    console.error('[Settings] Error deleting Fireflies key:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/settings/integrations/stripe
 * Delete Stripe API key (admin-only)
 */
router.delete('/integrations/stripe', requireAuth, requireAdmin, (req, res) => {
  try {
    const deleted = secretManager.deleteSecret('STRIPE_API_KEY');

    if (!deleted) {
      return res.status(500).json({
        success: false,
        error: 'Failed to delete API key'
      });
    }

    res.json({
      success: true,
      message: 'Stripe API key deleted'
    });
  } catch (error) {
    console.error('[Settings] Error deleting Stripe key:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/settings/integrations/fireflies/test
 * Test Fireflies connection (uses stored key)
 */
router.post('/integrations/fireflies/test', async (req, res) => {
  try {
    const validation = await secretManager.validateFirefliesKey();

    if (!validation.valid) {
      return res.json({
        success: false,
        connected: false,
        error: validation.error
      });
    }

    res.json({
      success: true,
      connected: true,
      email: validation.email
    });
  } catch (error) {
    console.error('[Settings] Error testing Fireflies connection:', error);
    res.status(500).json({
      success: false,
      connected: false,
      error: error.message
    });
  }
});

/**
 * POST /api/settings/integrations/stripe/test
 * Test Stripe connection (uses stored key)
 * Optionally accepts testEmail in body to verify customer lookup
 */
router.post('/integrations/stripe/test', async (req, res) => {
  try {
    const stripeService = require('../services/stripeEnrichmentService');
    const { testEmail } = req.body || {};

    // Use the enhanced test function that includes mode detection
    const result = await stripeService.testConnectionWithEmail(testEmail || null);

    if (!result.valid) {
      return res.json({
        success: false,
        connected: false,
        error: result.error,
        mode: result.mode || null
      });
    }

    const response = {
      success: true,
      connected: true,
      mode: result.mode, // 'test' or 'live'
      livemode: result.livemode
    };

    // Include test email results if provided
    if (result.testEmail) {
      response.testEmail = result.testEmail;
    }

    res.json(response);
  } catch (error) {
    console.error('[Settings] Error testing Stripe connection:', error);
    res.status(500).json({
      success: false,
      connected: false,
      error: error.message
    });
  }
});

/**
 * GET /api/settings/integrations/stripe/diagnose
 * Comprehensive Stripe integration diagnostic endpoint
 * Returns: API status, connectivity, optional customer lookup, matching capabilities
 * Query params:
 *   - testEmail: (optional) Email to look up in Stripe for verification
 * NEVER returns actual API keys - only masked versions
 */
router.get('/integrations/stripe/diagnose', async (req, res) => {
  const stripeService = require('../services/stripeEnrichmentService');

  const testEmail = req.query.testEmail;
  const diagnosis = {
    timestamp: new Date().toISOString(),
    apiKeyStatus: {
      configured: false,
      maskedKey: 'Not configured',
      keyType: null // 'live' or 'test'
    },
    connectivity: {
      tested: false,
      connected: false,
      error: null
    },
    matchingCapabilities: {
      emailExactMatch: true,       // Priority 1: Exact email match (high confidence)
      emailDomainFallback: true,   // Priority 2: Same domain match (medium confidence)
      nameFallback: true,          // Priority 3: Name-based match (low confidence)
      companyFallback: false,      // Not implemented - would require metadata
      multiCustomerHandling: true, // Now handles multiple customers with same email
      safePagination: true,        // Now uses safe pagination (no 100 customer limit)
      rateLimitHandling: true      // Now has retry/backoff for 429 errors
    },
    customerLookupTest: null,
    recommendations: []
  };

  try {
    // 1. Check API key status using stripeService
    const isConfigured = stripeService.isConfigured();
    diagnosis.apiKeyStatus.configured = isConfigured;
    diagnosis.apiKeyStatus.maskedKey = secretManager.getMaskedKey('STRIPE_API_KEY');
    diagnosis.apiKeyStatus.keyType = stripeService.getKeyMode();

    // 2. Test connectivity using the enhanced test function
    if (isConfigured) {
      diagnosis.connectivity.tested = true;
      const connectionTest = await stripeService.testConnection();
      diagnosis.connectivity.connected = connectionTest.valid;
      diagnosis.connectivity.livemode = connectionTest.livemode;

      if (!connectionTest.valid) {
        diagnosis.connectivity.error = connectionTest.error;
        diagnosis.recommendations.push('Fix API key: ' + connectionTest.error);
      }
    } else {
      diagnosis.recommendations.push('Configure STRIPE_API_KEY in settings to enable Stripe integration');
    }

    // 3. Test customer lookup if email provided
    if (testEmail && diagnosis.connectivity.connected) {
      try {
        const enrichment = await stripeService.getEnrichmentByEmail(testEmail);
        diagnosis.customerLookupTest = {
          email: testEmail,
          matched: enrichment.matched,
          status: enrichment.status,
          customerId: enrichment.customerId || null,
          customerName: enrichment.customerName || null,
          signupDate: enrichment.signupDate || null,
          subscriptionStatus: enrichment.status,
          currentPlan: enrichment.currentPlan || null,
          mrr: enrichment.mrr || 0
        };

        if (!enrichment.matched) {
          diagnosis.recommendations.push(
            `Test email "${testEmail}" not found in Stripe. This is expected if the customer doesn't exist.`
          );
        }
      } catch (lookupError) {
        diagnosis.customerLookupTest = {
          email: testEmail,
          matched: false,
          error: lookupError.message
        };
      }
    }

    // 4. Add recommendations based on current state
    if (diagnosis.connectivity.connected) {
      if (!diagnosis.matchingCapabilities.companyFallback) {
        diagnosis.recommendations.push(
          'Company metadata fallback is not enabled. Consider adding company names to Stripe customer metadata for better matching.'
        );
      }
    }

    // Overall status
    diagnosis.overallStatus = diagnosis.connectivity.connected ? 'WORKING' :
                              (diagnosis.apiKeyStatus.configured ? 'CONNECTIVITY_ISSUE' : 'NOT_CONFIGURED');

    res.json({
      success: true,
      diagnosis
    });

  } catch (error) {
    console.error('[Settings] Error diagnosing Stripe integration:', error);
    diagnosis.overallStatus = 'ERROR';
    diagnosis.error = error.message;
    res.status(500).json({
      success: false,
      diagnosis,
      error: error.message
    });
  }
});

// ========================================
// OpenAI Integration Routes
// ========================================

/**
 * GET /api/settings/integrations/openai
 * Get OpenAI configuration (with masked key)
 * NEVER returns actual API key
 */
router.get('/integrations/openai', (req, res) => {
  try {
    const config = secretManager.getOpenAIConfig();

    res.json({
      success: true,
      data: config
    });
  } catch (error) {
    console.error('[Settings] Error getting OpenAI config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/settings/integrations/openai
 * Save OpenAI API key (admin-only)
 * Accepts key in request body, saves to secrets.json
 * Optional: skipValidation=true to save without validating against OpenAI API
 */
router.post('/integrations/openai', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { apiKey, skipValidation } = req.body;

    if (!apiKey || typeof apiKey !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'API key is required'
      });
    }

    // Basic format check (OpenAI keys start with sk- or sk-proj-)
    const trimmedKey = apiKey.trim();
    if (!trimmedKey.startsWith('sk-')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid API key format. OpenAI keys must start with "sk-"'
      });
    }

    // Validate the key before saving (unless explicitly skipped)
    if (!skipValidation) {
      const validation = await secretManager.validateOpenAIKey(trimmedKey);

      if (!validation.valid) {
        // Provide more detailed error information
        let errorMessage = validation.error || 'Unknown validation error';

        // Check for common issues
        if (errorMessage.includes('fetch') || errorMessage.includes('ENOTFOUND') || errorMessage.includes('network')) {
          errorMessage = 'Network error: Unable to reach OpenAI API. Please check your internet connection.';
        } else if (errorMessage === 'Invalid API key') {
          errorMessage = 'Invalid API key. Please verify your key is correct and has not been revoked.';
        }

        return res.status(400).json({
          success: false,
          error: errorMessage,
          validationError: validation.error // Include original error for debugging
        });
      }
    }

    // Save the key
    const saved = secretManager.saveSecret('OPENAI_API_KEY', trimmedKey);

    if (!saved) {
      return res.status(500).json({
        success: false,
        error: 'Failed to save API key to storage'
      });
    }

    res.json({
      success: true,
      message: skipValidation
        ? 'OpenAI API key saved (validation skipped)'
        : 'OpenAI API key saved and validated successfully',
      data: {
        configured: true,
        maskedKey: secretManager.getMaskedKey('OPENAI_API_KEY'),
        validated: !skipValidation
      }
    });
  } catch (error) {
    console.error('[Settings] Error saving OpenAI key:', error);
    res.status(500).json({
      success: false,
      error: `Server error: ${error.message}`
    });
  }
});

/**
 * PUT /api/settings/integrations/openai/config
 * Update OpenAI model configuration (admin-only)
 * Does NOT trigger re-analysis
 */
router.put('/integrations/openai/config', requireAuth, requireAdmin, (req, res) => {
  try {
    const { model, applyMode } = req.body;

    if (!model || typeof model !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Model is required'
      });
    }

    if (!applyMode || typeof applyMode !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Apply mode is required'
      });
    }

    // Validate and save configuration
    const saved = secretManager.saveOpenAIConfig(model, applyMode);

    if (!saved) {
      return res.status(400).json({
        success: false,
        error: 'Invalid model or apply mode'
      });
    }

    res.json({
      success: true,
      message: 'OpenAI configuration saved successfully',
      data: {
        model,
        applyMode
      }
    });
  } catch (error) {
    console.error('[Settings] Error saving OpenAI config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/settings/integrations/openai
 * Delete OpenAI API key (admin-only)
 */
router.delete('/integrations/openai', requireAuth, requireAdmin, (req, res) => {
  try {
    const deleted = secretManager.deleteSecret('OPENAI_API_KEY');

    if (!deleted) {
      return res.status(500).json({
        success: false,
        error: 'Failed to delete API key'
      });
    }

    res.json({
      success: true,
      message: 'OpenAI API key deleted'
    });
  } catch (error) {
    console.error('[Settings] Error deleting OpenAI key:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/settings/integrations/openai/test
 * Test OpenAI connection (uses stored key)
 * If body.testModel is provided, also tests that specific model with a minimal request
 */
router.post('/integrations/openai/test', async (req, res) => {
  try {
    const { testModel } = req.body || {};
    const startTime = Date.now();

    // First validate the API key
    const validation = await secretManager.validateOpenAIKey();

    if (!validation.valid) {
      return res.json({
        success: false,
        connected: false,
        error: validation.error
      });
    }

    // If a model is specified, run a minimal test with that model
    if (testModel) {
      // Validate the model name first
      const modelValidation = llmService.validateModel(testModel);
      if (!modelValidation.valid) {
        return res.json({
          success: false,
          connected: true, // API key is valid
          error: modelValidation.error,
          model: testModel
        });
      }

      try {
        // Run a minimal, low-cost test request
        const testResult = await llmService.chatCompletion({
          systemPrompt: 'Reply with only the word "OK".',
          userPrompt: 'Test',
          model: testModel,
          maxTokens: 5,
          temperature: 0,
          maxRetries: 1 // Only one attempt for testing
        });

        const latencyMs = Date.now() - startTime;

        if (testResult.success) {
          return res.json({
            success: true,
            connected: true,
            model: testModel,
            modelTest: {
              success: true,
              latencyMs,
              tokensUsed: testResult.usage?.totalTokens || 0
            }
          });
        } else {
          return res.json({
            success: false,
            connected: true, // API key is valid
            model: testModel,
            modelTest: {
              success: false,
              error: testResult.error || 'Model test failed'
            },
            error: testResult.error
          });
        }
      } catch (modelError) {
        // Model test failed - surface the OpenAI error clearly
        return res.json({
          success: false,
          connected: true, // API key is valid
          model: testModel,
          modelTest: {
            success: false,
            error: modelError.message
          },
          error: modelError.message
        });
      }
    }

    // No model specified - just return API key validation result
    res.json({
      success: true,
      connected: true
    });
  } catch (error) {
    console.error('[Settings] Error testing OpenAI connection:', error);
    res.status(500).json({
      success: false,
      connected: false,
      error: error.message
    });
  }
});

// ========================================
// Token Usage Routes
// ========================================

/**
 * GET /api/settings/usage
 * Get token usage statistics for LLM analysis
 *
 * Query params:
 *   - startDate: Start date filter (YYYY-MM-DD)
 *   - endDate: End date filter (YYYY-MM-DD)
 *   - rep: Filter by sales rep name
 *   - forceRefresh: Set to 'true' to bypass cache and re-aggregate from DB
 *   - recentLimit: Number of recent analyses to return (default 10)
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     totalCalls: number,
 *     totalInputTokens: number,
 *     totalOutputTokens: number,
 *     totalTokens: number,
 *     totalCostCents: number,
 *     totalCostDollars: number,
 *     avgTokensPerCall: number,
 *     avgCostPerCall: number,
 *     byModel: { [model]: { calls, inputTokens, outputTokens, totalTokens, costCents } },
 *     byDay: { [date]: { calls, inputTokens, outputTokens, totalTokens, costCents } },
 *     recentAnalyses: [{ callTitle, analyzedAt, model, inputTokens, outputTokens, totalTokens, costCents, repName }],
 *     lastUpdated: ISO timestamp,
 *     modelCosts: pricing reference
 *   }
 * }
 */
router.get('/usage', async (req, res) => {
  try {
    const { startDate, endDate, rep, forceRefresh, recentLimit } = req.query;

    // forceRefresh parameter ensures fresh data from DB (no caching)
    // Currently no caching is implemented, but this parameter signals intent
    // and can be used for future cache invalidation
    const isForceRefresh = forceRefresh === 'true';
    if (isForceRefresh) {
      console.log('[Settings] Force refresh requested for token usage stats');
    }

    const stats = await transcriptDb.getTokenUsageStats({
      startDate: startDate || null,
      endDate: endDate || null,
      rep: rep || null,
      recentLimit: recentLimit ? parseInt(recentLimit, 10) : 10
    });

    // Add model costs info for reference
    const modelCosts = llmService.getModelCosts();

    res.json({
      success: true,
      data: {
        ...stats,
        modelCosts
      }
    });
  } catch (error) {
    console.error('[Settings] Error getting token usage:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/settings/usage/summary
 * Get a quick summary of token usage (for dashboard widgets)
 */
router.get('/usage/summary', async (req, res) => {
  try {
    const stats = await transcriptDb.getTokenUsageStats({});

    res.json({
      success: true,
      data: {
        totalCalls: stats.totalCalls,
        totalTokens: stats.totalTokens,
        totalCostDollars: stats.totalCostDollars,
        avgCostPerCall: stats.avgCostPerCall,
        configured: llmService.isConfigured(),
        currentModel: llmService.getConfiguredModel()
      }
    });
  } catch (error) {
    console.error('[Settings] Error getting usage summary:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ========================================
// Re-analysis Routes
// ========================================

/**
 * GET /api/settings/reanalysis/status
 * Get re-analysis job status and statistics
 */
router.get('/reanalysis/status', async (req, res) => {
  try {
    const stats = await reanalysisService.getReanalysisStats();

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('[Settings] Error getting reanalysis status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/settings/reanalysis/job/:id
 * Get specific re-analysis job details
 */
router.get('/reanalysis/job/:id', async (req, res) => {
  try {
    const jobId = parseInt(req.params.id, 10);

    if (isNaN(jobId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid job ID'
      });
    }

    const job = await reanalysisService.getReanalysisJob(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    res.json({
      success: true,
      data: job
    });
  } catch (error) {
    console.error('[Settings] Error getting reanalysis job:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/settings/reanalysis/trigger
 * Trigger re-analysis of all SALES calls
 * Only works if apply_mode == rerun_all
 */
router.post('/reanalysis/trigger', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Check if apply mode allows re-analysis
    if (!reanalysisService.shouldTriggerReanalysis()) {
      return res.status(400).json({
        success: false,
        error: 'Apply mode is set to future_only. Change to rerun_all to trigger re-analysis.'
      });
    }

    // Start the re-analysis job
    const result = await reanalysisService.startReanalysisIfNeeded();

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error
      });
    }

    res.json({
      success: true,
      message: 'Re-analysis job started',
      data: {
        jobId: result.jobId,
        totalCalls: result.totalCalls,
        model: result.model
      }
    });
  } catch (error) {
    console.error('[Settings] Error triggering reanalysis:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/settings/reanalysis/cancel
 * Cancel the currently running re-analysis job
 */
router.post('/reanalysis/cancel', requireAuth, requireAdmin, async (req, res) => {
  try {
    const cancelled = reanalysisService.cancelReanalysisJob();

    if (!cancelled) {
      return res.status(400).json({
        success: false,
        error: 'No running job to cancel'
      });
    }

    res.json({
      success: true,
      message: 'Re-analysis job cancelled'
    });
  } catch (error) {
    console.error('[Settings] Error cancelling reanalysis:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/settings/reanalysis/resume/:id
 * Resume a paused re-analysis job
 */
router.post('/reanalysis/resume/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const jobId = parseInt(req.params.id, 10);

    if (isNaN(jobId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid job ID'
      });
    }

    const job = await reanalysisService.getReanalysisJob(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    if (job.status !== 'paused') {
      return res.status(400).json({
        success: false,
        error: `Cannot resume job with status: ${job.status}`
      });
    }

    // Run the job asynchronously
    setImmediate(async () => {
      try {
        await reanalysisService.runReanalysisJob(jobId);
      } catch (error) {
        console.error('[Settings] Error running resumed job:', error);
      }
    });

    res.json({
      success: true,
      message: 'Re-analysis job resumed',
      data: {
        jobId,
        processed: job.processed,
        remaining: job.total_calls - job.processed - job.skipped
      }
    });
  } catch (error) {
    console.error('[Settings] Error resuming reanalysis:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ========================================
// SLACK INTEGRATION ROUTES
// ========================================

/**
 * GET /api/settings/integrations/slack
 * Get Slack configuration status (never exposes token)
 */
router.get('/integrations/slack', (req, res) => {
  try {
    // Only check for bot token - channel IDs are pre-configured in slackIngestionService
    const configured = secretManager.isConfigured('SLACK_BOT_TOKEN');

    res.json({
      success: true,
      data: {
        configured,
        maskedToken: secretManager.getMaskedKey('SLACK_BOT_TOKEN'),
        // Channels are pre-configured: Signup C09246QR2AX, Payment C0987US3LSJ
        channelId: 'Pre-configured'
      }
    });
  } catch (error) {
    console.error('[Settings] Error getting Slack config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/settings/integrations/slack
 * Save Slack bot token (channels are pre-configured)
 */
router.post('/integrations/slack', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { botToken } = req.body;

    if (!botToken || typeof botToken !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Bot token is required'
      });
    }

    // Basic format validation
    if (!botToken.startsWith('xoxb-')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid bot token format. Should start with xoxb-'
      });
    }

    // Save the bot token
    const tokenSaved = secretManager.saveSecret('SLACK_BOT_TOKEN', botToken);

    if (!tokenSaved) {
      return res.status(500).json({
        success: false,
        error: 'Failed to save Slack bot token'
      });
    }

    // Test the connection
    const slackService = require('../services/slackIngestionService');
    const testResult = await slackService.testConnection();

    if (!testResult.valid) {
      // Rollback the saved token
      secretManager.deleteSecret('SLACK_BOT_TOKEN');

      return res.status(400).json({
        success: false,
        error: `Connection test failed: ${testResult.error}`
      });
    }

    res.json({
      success: true,
      message: 'Slack configuration saved successfully',
      data: {
        configured: true,
        maskedToken: secretManager.getMaskedKey('SLACK_BOT_TOKEN'),
        teamName: testResult.teamName,
        channels: testResult.channels
      }
    });
  } catch (error) {
    console.error('[Settings] Error saving Slack config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/settings/integrations/slack/test
 * Test Slack connection (uses stored credentials)
 */
router.post('/integrations/slack/test', async (req, res) => {
  try {
    const slackService = require('../services/slackIngestionService');

    const result = await slackService.testConnection();

    if (!result.valid) {
      return res.json({
        success: false,
        connected: false,
        error: result.error
      });
    }

    res.json({
      success: true,
      connected: true,
      teamName: result.teamName,
      channels: result.channels
    });
  } catch (error) {
    console.error('[Settings] Error testing Slack connection:', error);
    res.status(500).json({
      success: false,
      connected: false,
      error: error.message
    });
  }
});

/**
 * POST /api/settings/integrations/slack/sync
 * Run import of Slack lifecycle events
 */
router.post('/integrations/slack/sync', requireAuth, requireAdmin, async (req, res) => {
  try {
    const slackService = require('../services/slackIngestionService');

    if (!slackService.isConfigured()) {
      return res.status(400).json({
        success: false,
        error: 'Slack not configured'
      });
    }

    const result = await slackService.syncEvents();

    res.json({
      success: true,
      message: 'Slack events synced',
      imported: result.imported,
      skipped: result.skipped,
      errors: result.errors,
      total: result.total
    });
  } catch (error) {
    console.error('[Settings] Error syncing Slack events:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/settings/integrations/slack
 * Remove Slack configuration
 */
router.delete('/integrations/slack', requireAuth, requireAdmin, (req, res) => {
  try {
    secretManager.deleteSecret('SLACK_BOT_TOKEN');
    secretManager.deleteSecret('SLACK_CHANNEL_ID');

    res.json({
      success: true,
      message: 'Slack configuration removed'
    });
  } catch (error) {
    console.error('[Settings] Error removing Slack config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/settings/integrations/slack/events
 * Get stored Slack lifecycle events
 */
router.get('/integrations/slack/events', async (req, res) => {
  try {
    const slackService = require('../services/slackIngestionService');

    const { limit = 100, offset = 0, eventType, email } = req.query;

    const events = await slackService.getAllEvents({
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
      eventType,
      email
    });

    const stats = await slackService.getEventStats();

    res.json({
      success: true,
      data: {
        events,
        stats
      }
    });
  } catch (error) {
    console.error('[Settings] Error getting Slack events:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/settings/integrations/slack/status/:email
 * Get Slack lifecycle status for a specific email
 */
router.get('/integrations/slack/status/:email', async (req, res) => {
  try {
    const slackService = require('../services/slackIngestionService');

    const { email } = req.params;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    const events = await slackService.getEventsForEmail(email);
    const status = await slackService.getLatestStatusForEmail(email);

    res.json({
      success: true,
      data: {
        email,
        status,
        events
      }
    });
  } catch (error) {
    console.error('[Settings] Error getting Slack status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==========================================
// CALENDLY INTEGRATION ROUTES
// ==========================================

const calendlyService = require('../services/calendlyService');

/**
 * GET /api/settings/integrations/calendly
 * Get Calendly integration status
 */
router.get('/integrations/calendly', (req, res) => {
  try {
    const configured = calendlyService.isConfigured();

    res.json({
      success: true,
      data: {
        configured,
        maskedKey: secretManager.getMaskedKey('CALENDLY_API_KEY')
      }
    });
  } catch (error) {
    console.error('[Settings] Error getting Calendly status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/settings/integrations/calendly
 * Save Calendly API key
 */
router.post('/integrations/calendly', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { apiKey } = req.body;

    if (!apiKey || typeof apiKey !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'API key is required'
      });
    }

    // Save the key first
    const saved = secretManager.saveSecret('CALENDLY_API_KEY', apiKey);

    if (!saved) {
      return res.status(500).json({
        success: false,
        error: 'Failed to save API key'
      });
    }

    // Test the connection
    const testResult = await calendlyService.testConnection();

    if (!testResult.valid) {
      // Remove invalid key
      secretManager.deleteSecret('CALENDLY_API_KEY');
      return res.status(400).json({
        success: false,
        error: `Invalid API key: ${testResult.error}`
      });
    }

    res.json({
      success: true,
      message: 'Calendly API key saved successfully',
      data: {
        configured: true,
        maskedKey: secretManager.getMaskedKey('CALENDLY_API_KEY'),
        user: testResult.user
      }
    });
  } catch (error) {
    console.error('[Settings] Error saving Calendly key:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/settings/integrations/calendly/test
 * Test Calendly connection
 */
router.post('/integrations/calendly/test', async (req, res) => {
  try {
    const testResult = await calendlyService.testConnection();

    res.json({
      success: true,
      data: testResult
    });
  } catch (error) {
    console.error('[Settings] Error testing Calendly:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/settings/integrations/calendly
 * Remove Calendly API key
 */
router.delete('/integrations/calendly', requireAuth, requireAdmin, (req, res) => {
  try {
    secretManager.deleteSecret('CALENDLY_API_KEY');

    res.json({
      success: true,
      message: 'Calendly API key removed'
    });
  } catch (error) {
    console.error('[Settings] Error deleting Calendly key:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/settings/integrations/calendly/stats
 * Get Calendly event statistics
 */
router.get('/integrations/calendly/stats', async (req, res) => {
  try {
    if (!calendlyService.isConfigured()) {
      return res.status(400).json({
        success: false,
        error: 'Calendly not configured'
      });
    }

    const days = parseInt(req.query.days, 10) || 30;
    const stats = await calendlyService.getEventStats({ days });

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('[Settings] Error getting Calendly stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/settings/integrations/calendly/enrich/:email
 * Test enrichment for a specific email
 */
router.get('/integrations/calendly/enrich/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const { callDatetime } = req.query;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    const result = await calendlyService.enrichWithCalendly({
      email,
      callDatetime
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('[Settings] Error enriching with Calendly:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==========================================
// PERPLEXITY INTEGRATION ROUTES
// ==========================================

const perplexityService = require('../services/perplexityService');

/**
 * GET /api/settings/integrations/perplexity
 * Get Perplexity integration status
 */
router.get('/integrations/perplexity', (req, res) => {
  try {
    const config = secretManager.getPerplexityConfig();

    res.json({
      success: true,
      data: {
        configured: config.configured,
        maskedKey: config.maskedKey
      }
    });
  } catch (error) {
    console.error('[Settings] Error getting Perplexity status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/settings/integrations/perplexity
 * Save Perplexity API key
 */
router.post('/integrations/perplexity', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { apiKey } = req.body;

    if (!apiKey || typeof apiKey !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'API key is required'
      });
    }

    const trimmedKey = apiKey.trim();

    // Validate the key by testing it against the Perplexity API
    const validation = await secretManager.validatePerplexityKey(trimmedKey);

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: `Invalid API key: ${validation.error}`
      });
    }

    // Save the key
    const saved = secretManager.saveSecret('PERPLEXITY_API_KEY', trimmedKey);

    if (!saved) {
      return res.status(500).json({
        success: false,
        error: 'Failed to save API key'
      });
    }

    res.json({
      success: true,
      message: 'Perplexity API key saved successfully',
      data: {
        configured: true,
        maskedKey: secretManager.getMaskedKey('PERPLEXITY_API_KEY')
      }
    });
  } catch (error) {
    console.error('[Settings] Error saving Perplexity key:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/settings/integrations/perplexity/test
 * Test Perplexity connection
 */
router.post('/integrations/perplexity/test', async (req, res) => {
  try {
    const testResult = await perplexityService.testConnection();

    res.json({
      success: true,
      data: testResult
    });
  } catch (error) {
    console.error('[Settings] Error testing Perplexity:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/settings/integrations/perplexity
 * Remove Perplexity API key
 */
router.delete('/integrations/perplexity', requireAuth, requireAdmin, (req, res) => {
  try {
    secretManager.deleteSecret('PERPLEXITY_API_KEY');

    res.json({
      success: true,
      message: 'Perplexity API key removed'
    });
  } catch (error) {
    console.error('[Settings] Error deleting Perplexity key:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/settings/integrations/perplexity/prompt
 * Get Perplexity prompt configuration
 */
router.get('/integrations/perplexity/prompt', requireAuth, (req, res) => {
  try {
    const config = secretManager.getPerplexityConfig();

    res.json({
      success: true,
      data: {
        prompt: config.prompt,
        defaultPrompt: secretManager.DEFAULT_PERPLEXITY_PROMPT
      }
    });
  } catch (error) {
    console.error('[Settings] Error getting Perplexity prompt:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/settings/integrations/perplexity/prompt
 * Update Perplexity prompt configuration
 */
router.put('/integrations/perplexity/prompt', requireAuth, requireAdmin, (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required'
      });
    }

    if (prompt.length < 50) {
      return res.status(400).json({
        success: false,
        error: 'Prompt must be at least 50 characters'
      });
    }

    const saved = secretManager.savePerplexityPrompt(prompt);

    if (!saved) {
      return res.status(500).json({
        success: false,
        error: 'Failed to save prompt'
      });
    }

    res.json({
      success: true,
      message: 'Perplexity prompt saved successfully'
    });
  } catch (error) {
    console.error('[Settings] Error saving Perplexity prompt:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/settings/integrations/perplexity/prompt/reset
 * Reset Perplexity prompt to default
 */
router.post('/integrations/perplexity/prompt/reset', requireAuth, requireAdmin, (req, res) => {
  try {
    const saved = secretManager.savePerplexityPrompt(secretManager.DEFAULT_PERPLEXITY_PROMPT);

    if (!saved) {
      return res.status(500).json({
        success: false,
        error: 'Failed to reset prompt'
      });
    }

    res.json({
      success: true,
      message: 'Perplexity prompt reset to default',
      data: {
        prompt: secretManager.DEFAULT_PERPLEXITY_PROMPT
      }
    });
  } catch (error) {
    console.error('[Settings] Error resetting Perplexity prompt:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================================
// TRANSCRIPT ANALYSIS PROMPTS
// ============================================================================

/**
 * GET /api/settings/prompts/transcript-analysis
 * Get transcript analysis prompts configuration
 */
router.get('/prompts/transcript-analysis', requireAuth, (req, res) => {
  try {
    const leadQualityService = require('../services/leadQualityService');
    const customPrompts = secretManager.getTranscriptAnalysisPrompts();
    const defaults = leadQualityService.getDefaultTranscriptPrompts();

    res.json({
      success: true,
      data: {
        current: {
          system_prompt: customPrompts.system_prompt || defaults.system_prompt,
          scoring_prompt: customPrompts.scoring_prompt || defaults.scoring_prompt
        },
        defaults
      }
    });
  } catch (error) {
    console.error('[Settings] Error getting transcript prompts:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/settings/prompts/transcript-analysis
 * Update transcript analysis prompts (admin-only)
 */
router.put('/prompts/transcript-analysis', requireAuth, requireAdmin, (req, res) => {
  try {
    const { prompts } = req.body;

    if (!prompts || typeof prompts !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'prompts object is required'
      });
    }

    // Validate prompt fields
    const validFields = ['system_prompt', 'scoring_prompt'];
    const updates = {};

    for (const field of validFields) {
      if (prompts[field] && typeof prompts[field] === 'string') {
        updates[field] = prompts[field].trim();
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one valid prompt field is required'
      });
    }

    // Merge with existing prompts
    const existing = secretManager.getTranscriptAnalysisPrompts();
    const merged = { ...existing, ...updates };

    const saved = secretManager.saveTranscriptAnalysisPrompts(merged);

    if (!saved) {
      return res.status(500).json({
        success: false,
        error: 'Failed to save prompts'
      });
    }

    res.json({
      success: true,
      message: 'Transcript analysis prompts updated',
      data: merged
    });
  } catch (error) {
    console.error('[Settings] Error saving transcript prompts:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/settings/prompts/transcript-analysis
 * Reset transcript analysis prompts to defaults (admin-only)
 */
router.delete('/prompts/transcript-analysis', requireAuth, requireAdmin, (req, res) => {
  try {
    const saved = secretManager.saveTranscriptAnalysisPrompts({});

    if (!saved) {
      return res.status(500).json({
        success: false,
        error: 'Failed to reset prompts'
      });
    }

    const leadQualityService = require('../services/leadQualityService');
    const defaults = leadQualityService.getDefaultTranscriptPrompts();

    res.json({
      success: true,
      message: 'Transcript analysis prompts reset to defaults',
      data: defaults
    });
  } catch (error) {
    console.error('[Settings] Error resetting transcript prompts:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
