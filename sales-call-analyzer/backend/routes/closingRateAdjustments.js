/**
 * Closing Rate Adjustments Routes
 *
 * Provides endpoints for manual adjustments to closing rate metrics:
 * - Manual DFY closes (won deals)
 * - Lifecycle overrides (signup/churn status)
 * - Call inclusion/exclusion from metrics
 */

const express = require('express');
const router = express.Router();
const transcriptDb = require('../services/transcriptDb');

// ============================================
// Manual Closes (DFY Won Deals)
// ============================================

/**
 * GET /api/closing-rate/manual-closes
 * Get all manual closes with optional filters
 *
 * Query params:
 * - start_date: Filter by close date (YYYY-MM-DD)
 * - end_date: Filter by close date (YYYY-MM-DD)
 * - rep: Filter by rep name
 */
router.get('/manual-closes', async (req, res) => {
  try {
    const { start_date, end_date, rep } = req.query;

    const closes = await transcriptDb.getManualCloses({
      startDate: start_date,
      endDate: end_date,
      rep
    });

    res.json({
      success: true,
      data: closes
    });
  } catch (error) {
    console.error('[ClosingRateAdjustments] Error getting manual closes:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/closing-rate/manual-closes
 * Create a new manual close entry
 *
 * Body:
 * - email (required): Prospect email
 * - company: Company name
 * - website: Company website
 * - rep: Sales rep (default: Phil)
 * - close_date (required): Date closed (YYYY-MM-DD)
 * - amount: Deal amount
 * - notes: Additional notes
 * - linked_call_id: Link to a call/transcript
 * - override_duplicate: Allow duplicate if true
 */
router.post('/manual-closes', async (req, res) => {
  try {
    const {
      email,
      company,
      website,
      rep,
      close_date,
      amount,
      notes,
      linked_call_id,
      override_duplicate
    } = req.body;

    // Validate required fields
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    if (!close_date) {
      return res.status(400).json({
        success: false,
        error: 'Close date is required'
      });
    }

    // Check for duplicates unless override is set
    if (!override_duplicate) {
      const existing = await transcriptDb.getManualCloseByEmail(email);
      if (existing) {
        return res.status(409).json({
          success: false,
          error: 'A manual close already exists for this email',
          existing: existing
        });
      }
    }

    // Get user ID from session if available
    const userId = req.user?.id || null;

    const result = await transcriptDb.createManualClose({
      email,
      company,
      website,
      rep: rep || 'Phil',
      close_date,
      amount: amount ? parseFloat(amount) : null,
      notes,
      linked_call_id,
      created_by: userId
    });

    res.status(201).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('[ClosingRateAdjustments] Error creating manual close:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/closing-rate/manual-closes/:id
 * Update a manual close entry
 */
router.put('/manual-closes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Validate email if provided
    if (updates.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(updates.email)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid email format'
        });
      }
    }

    // Parse amount if provided
    if (updates.amount !== undefined && updates.amount !== null) {
      updates.amount = parseFloat(updates.amount);
    }

    const result = await transcriptDb.updateManualClose(id, updates);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'Manual close not found'
      });
    }

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('[ClosingRateAdjustments] Error updating manual close:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/closing-rate/manual-closes/:id
 * Delete a manual close entry
 */
router.delete('/manual-closes/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if exists
    const existing = await transcriptDb.getManualCloseById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Manual close not found'
      });
    }

    await transcriptDb.deleteManualClose(id);

    res.json({
      success: true,
      message: 'Manual close deleted'
    });
  } catch (error) {
    console.error('[ClosingRateAdjustments] Error deleting manual close:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// Lifecycle Overrides
// ============================================

/**
 * GET /api/closing-rate/lifecycle-overrides
 * Get all lifecycle overrides
 */
router.get('/lifecycle-overrides', async (req, res) => {
  try {
    const overrides = await transcriptDb.getAllLifecycleOverrides();

    res.json({
      success: true,
      data: overrides
    });
  } catch (error) {
    console.error('[ClosingRateAdjustments] Error getting lifecycle overrides:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/closing-rate/lifecycle-overrides/:callId
 * Get lifecycle override for a specific call
 */
router.get('/lifecycle-overrides/:callId', async (req, res) => {
  try {
    const { callId } = req.params;
    const override = await transcriptDb.getLifecycleOverrideByCallId(callId);

    if (!override) {
      return res.status(404).json({
        success: false,
        error: 'No override found for this call'
      });
    }

    res.json({
      success: true,
      data: override
    });
  } catch (error) {
    console.error('[ClosingRateAdjustments] Error getting lifecycle override:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/closing-rate/lifecycle-overrides
 * Create or update a lifecycle override
 *
 * Body:
 * - call_id (required): Call/transcript ID
 * - prospect_email: Prospect email (for reference)
 * - status (required): 'signed_up', 'active', 'churned', 'team', or 'no_close'
 * - notes: Additional notes
 */
router.post('/lifecycle-overrides', async (req, res) => {
  try {
    const { call_id, prospect_email, status, notes } = req.body;

    // Validate required fields
    if (!call_id) {
      return res.status(400).json({
        success: false,
        error: 'Call ID is required'
      });
    }

    if (!status) {
      return res.status(400).json({
        success: false,
        error: 'Status is required'
      });
    }

    // Validate status value
    const validStatuses = ['signed_up', 'active', 'churned', 'team', 'no_close'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    // Verify call exists
    const call = await transcriptDb.getTranscriptById(call_id);
    if (!call) {
      return res.status(404).json({
        success: false,
        error: 'Call not found'
      });
    }

    const userId = req.user?.id || null;

    const result = await transcriptDb.setLifecycleOverride({
      call_id,
      prospect_email,
      status,
      notes,
      created_by: userId
    });

    res.status(201).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('[ClosingRateAdjustments] Error setting lifecycle override:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/closing-rate/lifecycle-overrides/:callId
 * Remove lifecycle override for a call
 */
router.delete('/lifecycle-overrides/:callId', async (req, res) => {
  try {
    const { callId } = req.params;

    // Check if exists
    const existing = await transcriptDb.getLifecycleOverrideByCallId(callId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'No override found for this call'
      });
    }

    await transcriptDb.deleteLifecycleOverride(callId);

    res.json({
      success: true,
      message: 'Lifecycle override removed'
    });
  } catch (error) {
    console.error('[ClosingRateAdjustments] Error deleting lifecycle override:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// Call Inclusions
// ============================================

/**
 * GET /api/closing-rate/inclusions
 * Get all call inclusion statuses
 */
router.get('/inclusions', async (req, res) => {
  try {
    const inclusionsMap = await transcriptDb.getAllCallInclusions();

    // Convert Map to array of objects for JSON serialization
    const inclusions = Array.from(inclusionsMap.entries()).map(([call_id, included]) => ({
      call_id,
      included: included ? 1 : 0
    }));

    res.json({
      success: true,
      data: inclusions
    });
  } catch (error) {
    console.error('[ClosingRateAdjustments] Error getting call inclusions:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/closing-rate/inclusions/:callId
 * Get inclusion status for a single call
 */
router.get('/inclusions/:callId', async (req, res) => {
  try {
    const { callId } = req.params;
    const inclusion = await transcriptDb.getCallInclusion(callId);

    // If no record exists, default to included (true)
    if (!inclusion) {
      return res.json({
        success: true,
        data: { call_id: callId, included: true }
      });
    }

    res.json({
      success: true,
      data: inclusion
    });
  } catch (error) {
    console.error('[ClosingRateAdjustments] Error getting call inclusion:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/closing-rate/inclusions/:callId
 * Set inclusion status for a single call
 *
 * Body:
 * - included (required): true/false
 */
router.put('/inclusions/:callId', async (req, res) => {
  try {
    const { callId } = req.params;
    const { included } = req.body;

    if (included === undefined) {
      return res.status(400).json({
        success: false,
        error: 'included field is required'
      });
    }

    // Verify call exists
    const call = await transcriptDb.getTranscriptById(callId);
    if (!call) {
      return res.status(404).json({
        success: false,
        error: 'Call not found'
      });
    }

    const userId = req.user?.id || null;
    const result = await transcriptDb.setCallInclusion(callId, Boolean(included), userId);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('[ClosingRateAdjustments] Error setting call inclusion:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/closing-rate/inclusions/bulk
 * Set inclusion status for multiple calls
 *
 * Body:
 * - call_ids (required): Array of call IDs
 * - included (required): true/false
 */
router.post('/inclusions/bulk', async (req, res) => {
  try {
    const { call_ids, included } = req.body;

    if (!Array.isArray(call_ids) || call_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'call_ids must be a non-empty array'
      });
    }

    if (included === undefined) {
      return res.status(400).json({
        success: false,
        error: 'included field is required'
      });
    }

    const userId = req.user?.id || null;
    const result = await transcriptDb.setCallInclusionBulk(call_ids, Boolean(included), userId);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('[ClosingRateAdjustments] Error setting bulk call inclusions:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
