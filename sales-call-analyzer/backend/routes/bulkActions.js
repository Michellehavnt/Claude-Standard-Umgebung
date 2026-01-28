/**
 * Bulk Actions Routes
 * Endpoints for bulk operations on calls (delete, analyze)
 */

const express = require('express');
const router = express.Router();
const transcriptDb = require('../services/transcriptDb');
const callAnalysisService = require('../services/callAnalysisService');

// Throttle configuration
const ANALYSIS_DELAY_MS = 5000; // 5 seconds between analyses
const MAX_RETRY_ATTEMPTS = 3;
const INITIAL_BACKOFF_MS = 10000; // 10 seconds initial backoff on rate limit

// Track bulk analysis progress
let bulkAnalysisInProgress = false;
let bulkAnalysisProgress = null;

/**
 * POST /api/bulk/delete
 * Soft delete multiple calls (set deleted_at timestamp)
 * Calls will remain in database but hidden from active views
 */
router.post('/delete', async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'ids array is required'
      });
    }

    console.log(`[Bulk] Soft deleting ${ids.length} calls...`);

    const result = await transcriptDb.softDeleteTranscripts(ids, 'manual');

    console.log(`[Bulk] Soft deleted ${result.deletedCount}/${ids.length} calls`);

    res.json({
      success: result.success,
      deletedCount: result.deletedCount,
      requestedCount: ids.length,
      errors: result.errors
    });

  } catch (error) {
    console.error('[Bulk] Delete error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/bulk/restore
 * Restore soft-deleted calls
 */
router.post('/restore', async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'ids array is required'
      });
    }

    console.log(`[Bulk] Restoring ${ids.length} calls...`);

    let restoredCount = 0;
    const errors = [];

    for (const id of ids) {
      try {
        const result = await transcriptDb.restoreTranscript(id);
        if (result.restored) {
          restoredCount++;
        } else if (result.error) {
          errors.push({ id, error: result.error });
        }
      } catch (error) {
        errors.push({ id, error: error.message });
      }
    }

    console.log(`[Bulk] Restored ${restoredCount}/${ids.length} calls`);

    res.json({
      success: errors.length === 0,
      restoredCount,
      requestedCount: ids.length,
      errors
    });

  } catch (error) {
    console.error('[Bulk] Restore error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/bulk/analyze
 * Analyze multiple calls sequentially with throttling
 * Skips already-analyzed calls by default
 */
router.post('/analyze', async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'ids array is required'
      });
    }

    if (bulkAnalysisInProgress) {
      return res.status(409).json({
        success: false,
        error: 'Bulk analysis already in progress',
        progress: bulkAnalysisProgress
      });
    }

    console.log(`[Bulk] Starting analysis of ${ids.length} calls...`);

    // Start bulk analysis in background
    bulkAnalysisInProgress = true;
    bulkAnalysisProgress = {
      status: 'running',
      total: ids.length,
      processed: 0,
      analyzed: 0,
      skipped: 0,
      alreadyAnalyzed: 0,
      notSalesCall: 0,
      errors: 0,
      currentCall: null,
      startedAt: new Date().toISOString()
    };

    // Run analysis asynchronously
    runBulkAnalysis(ids).catch(error => {
      console.error('[Bulk] Analysis error:', error);
      bulkAnalysisProgress.status = 'error';
      bulkAnalysisProgress.error = error.message;
    }).finally(() => {
      bulkAnalysisInProgress = false;
    });

    // Return immediately with job info
    res.json({
      success: true,
      message: `Started bulk analysis of ${ids.length} calls`,
      progress: bulkAnalysisProgress
    });

  } catch (error) {
    console.error('[Bulk] Analyze error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/bulk/analyze/status
 * Get current bulk analysis status
 */
router.get('/analyze/status', async (req, res) => {
  try {
    res.json({
      success: true,
      inProgress: bulkAnalysisInProgress,
      progress: bulkAnalysisProgress
    });
  } catch (error) {
    console.error('[Bulk] Status error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/bulk/analyze/cancel
 * Cancel current bulk analysis
 */
router.post('/analyze/cancel', async (req, res) => {
  try {
    if (!bulkAnalysisInProgress) {
      return res.status(400).json({
        success: false,
        error: 'No bulk analysis in progress'
      });
    }

    bulkAnalysisProgress.status = 'cancelled';
    console.log('[Bulk] Analysis cancelled by user');

    res.json({
      success: true,
      message: 'Bulk analysis cancelled',
      progress: bulkAnalysisProgress
    });
  } catch (error) {
    console.error('[Bulk] Cancel error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Run bulk analysis sequentially with throttling
 * @param {Array<string>} ids - Transcript IDs to analyze
 */
async function runBulkAnalysis(ids) {
  const results = [];

  for (let i = 0; i < ids.length; i++) {
    // Check if cancelled
    if (bulkAnalysisProgress.status === 'cancelled') {
      console.log('[Bulk] Analysis cancelled, stopping...');
      break;
    }

    const id = ids[i];
    bulkAnalysisProgress.currentCall = id;

    try {
      // Check if already analyzed (skip by default)
      const hasExisting = await transcriptDb.hasAnalysis(id, callAnalysisService.ANALYSIS_VERSION);

      if (hasExisting) {
        console.log(`[Bulk] Skipping ${id} - already analyzed`);
        bulkAnalysisProgress.skipped++;
        bulkAnalysisProgress.alreadyAnalyzed++;
        bulkAnalysisProgress.processed++;
        results.push({ id, status: 'skipped', reason: 'already_analyzed' });
        continue;
      }

      // Analyze with retry logic for rate limits
      let success = false;
      let attempt = 0;
      let lastError = null;

      while (!success && attempt < MAX_RETRY_ATTEMPTS) {
        attempt++;

        try {
          console.log(`[Bulk] Analyzing ${id} (${i + 1}/${ids.length})${attempt > 1 ? ` - attempt ${attempt}` : ''}`);

          const result = await callAnalysisService.analyzeCall(id, { force: false });

          if (result.success) {
            success = true;
            bulkAnalysisProgress.analyzed++;
            results.push({ id, status: 'analyzed' });
          } else if (result.skipped) {
            success = true;
            bulkAnalysisProgress.skipped++;
            // Check if skipped because not a sales call
            if (result.message && result.message.includes('not a sales call')) {
              bulkAnalysisProgress.notSalesCall++;
            }
            results.push({ id, status: 'skipped', reason: result.message });
          } else {
            lastError = result.error || 'Unknown error';
          }
        } catch (analysisError) {
          lastError = analysisError.message;

          // Check for rate limit error (429 or specific error messages)
          if (isRateLimitError(analysisError)) {
            const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
            console.log(`[Bulk] Rate limit hit, backing off ${backoffMs / 1000}s...`);
            await sleep(backoffMs);
          } else {
            // Non-rate-limit error, don't retry
            break;
          }
        }
      }

      if (!success) {
        console.log(`[Bulk] Failed to analyze ${id}: ${lastError}`);
        bulkAnalysisProgress.errors++;
        results.push({ id, status: 'error', error: lastError });
      }

      bulkAnalysisProgress.processed++;

      // Throttle between calls (skip if this is the last one)
      if (i < ids.length - 1 && bulkAnalysisProgress.status !== 'cancelled') {
        await sleep(ANALYSIS_DELAY_MS);
      }

    } catch (error) {
      console.error(`[Bulk] Error processing ${id}:`, error);
      bulkAnalysisProgress.errors++;
      bulkAnalysisProgress.processed++;
      results.push({ id, status: 'error', error: error.message });
    }
  }

  bulkAnalysisProgress.status = bulkAnalysisProgress.status === 'cancelled' ? 'cancelled' : 'completed';
  bulkAnalysisProgress.completedAt = new Date().toISOString();
  bulkAnalysisProgress.currentCall = null;
  bulkAnalysisProgress.results = results;

  console.log(`[Bulk] Analysis complete: ${bulkAnalysisProgress.analyzed} analyzed, ${bulkAnalysisProgress.skipped} skipped, ${bulkAnalysisProgress.errors} errors`);

  return results;
}

/**
 * Check if error is a rate limit error
 */
function isRateLimitError(error) {
  if (!error) return false;
  const message = error.message || error.toString();
  return (
    message.includes('429') ||
    message.includes('rate limit') ||
    message.includes('Rate limit') ||
    message.includes('Too many requests') ||
    message.includes('quota')
  );
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = router;
