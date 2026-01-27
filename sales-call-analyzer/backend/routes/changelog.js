/**
 * Changelog Routes
 * API endpoints for managing changelog entries
 *
 * Access Control:
 * - GET /api/changelog: All authenticated users can view published entries
 * - GET /api/changelog/all: Admin-only, includes drafts
 * - POST/PUT/DELETE: Admin-only for write operations
 */

const express = require('express');
const router = express.Router();
const transcriptDb = require('../services/transcriptDb');
const { requireAuth, requireAdmin } = require('../middleware/auth');

/**
 * Sanitize user input to prevent XSS
 * Removes HTML tags and trims whitespace
 */
function sanitizeInput(str) {
  if (!str || typeof str !== 'string') return str;
  return str
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .trim();
}

/**
 * GET /api/changelog
 * Get all published changelog entries (for all users)
 * Query params:
 *   - tag: Filter by tag (new, improvement, fix)
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { tag } = req.query;

    const entries = await transcriptDb.getChangelogEntries({
      publishedOnly: true,
      tag: tag || null
    });

    res.json({
      success: true,
      data: entries
    });
  } catch (error) {
    console.error('[Changelog] Error getting entries:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/changelog/all
 * Get all changelog entries including drafts (admin-only)
 * Query params:
 *   - tag: Filter by tag (new, improvement, fix)
 */
router.get('/all', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { tag } = req.query;

    const entries = await transcriptDb.getChangelogEntries({
      publishedOnly: false,
      tag: tag || null
    });

    res.json({
      success: true,
      data: entries
    });
  } catch (error) {
    console.error('[Changelog] Error getting all entries:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/changelog/:id
 * Get a single changelog entry by ID
 * Non-admins can only see published entries
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const entry = await transcriptDb.getChangelogEntryById(id);

    if (!entry) {
      return res.status(404).json({
        success: false,
        error: 'Changelog entry not found'
      });
    }

    // Non-admins can only see published entries
    if (!entry.is_published && req.user.role !== 'admin') {
      return res.status(404).json({
        success: false,
        error: 'Changelog entry not found'
      });
    }

    res.json({
      success: true,
      data: entry
    });
  } catch (error) {
    console.error('[Changelog] Error getting entry:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/changelog
 * Create a new changelog entry (admin-only)
 * Body:
 *   - title: string (required)
 *   - summary: string (required, markdown bullets)
 *   - details: string (optional, additional details)
 *   - tag: string (optional, one of: new, improvement, fix)
 *   - is_published: boolean (default false)
 *   - show_as_new_until: date string (optional, YYYY-MM-DD)
 */
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, summary, details, tag, is_published, show_as_new_until } = req.body;

    // Validate required fields
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Title is required'
      });
    }

    if (!summary || typeof summary !== 'string' || !summary.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Summary is required'
      });
    }

    // Validate tag if provided
    const validTags = ['new', 'improvement', 'fix', null];
    if (tag && !validTags.includes(tag)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid tag. Must be one of: new, improvement, fix'
      });
    }

    // Validate date format if provided
    if (show_as_new_until && !/^\d{4}-\d{2}-\d{2}$/.test(show_as_new_until)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD'
      });
    }

    // Sanitize inputs
    const sanitizedTitle = sanitizeInput(title);
    const sanitizedSummary = sanitizeInput(summary);
    const sanitizedDetails = details ? sanitizeInput(details) : null;

    const entry = await transcriptDb.createChangelogEntry({
      title: sanitizedTitle,
      summary: sanitizedSummary,
      details: sanitizedDetails,
      tag: tag || null,
      is_published: !!is_published,
      show_as_new_until: show_as_new_until || null,
      created_by: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Changelog entry created',
      data: entry
    });
  } catch (error) {
    console.error('[Changelog] Error creating entry:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/changelog/:id
 * Update a changelog entry (admin-only)
 * Body: same as POST, all fields optional
 */
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, summary, details, tag, is_published, show_as_new_until } = req.body;

    // Check if entry exists
    const existing = await transcriptDb.getChangelogEntryById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Changelog entry not found'
      });
    }

    // Validate tag if provided
    const validTags = ['new', 'improvement', 'fix', null];
    if (tag !== undefined && tag !== null && !validTags.includes(tag)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid tag. Must be one of: new, improvement, fix'
      });
    }

    // Validate date format if provided
    if (show_as_new_until && !/^\d{4}-\d{2}-\d{2}$/.test(show_as_new_until)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD'
      });
    }

    // Build updates object with sanitization
    const updates = {};
    if (title !== undefined) updates.title = sanitizeInput(title);
    if (summary !== undefined) updates.summary = sanitizeInput(summary);
    if (details !== undefined) updates.details = details ? sanitizeInput(details) : null;
    if (tag !== undefined) updates.tag = tag;
    if (is_published !== undefined) updates.is_published = !!is_published;
    if (show_as_new_until !== undefined) updates.show_as_new_until = show_as_new_until;

    const updated = await transcriptDb.updateChangelogEntry(id, updates);

    res.json({
      success: true,
      message: 'Changelog entry updated',
      data: updated
    });
  } catch (error) {
    console.error('[Changelog] Error updating entry:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/changelog/:id
 * Delete a changelog entry (admin-only)
 */
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if entry exists
    const existing = await transcriptDb.getChangelogEntryById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Changelog entry not found'
      });
    }

    await transcriptDb.deleteChangelogEntry(id);

    res.json({
      success: true,
      message: 'Changelog entry deleted'
    });
  } catch (error) {
    console.error('[Changelog] Error deleting entry:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/changelog/:id/publish
 * Publish a draft entry (admin-only)
 */
router.post('/:id/publish', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if entry exists
    const existing = await transcriptDb.getChangelogEntryById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Changelog entry not found'
      });
    }

    if (existing.is_published) {
      return res.status(400).json({
        success: false,
        error: 'Entry is already published'
      });
    }

    const updated = await transcriptDb.updateChangelogEntry(id, { is_published: true });

    res.json({
      success: true,
      message: 'Changelog entry published',
      data: updated
    });
  } catch (error) {
    console.error('[Changelog] Error publishing entry:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/changelog/:id/unpublish
 * Unpublish a published entry (admin-only)
 */
router.post('/:id/unpublish', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if entry exists
    const existing = await transcriptDb.getChangelogEntryById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Changelog entry not found'
      });
    }

    if (!existing.is_published) {
      return res.status(400).json({
        success: false,
        error: 'Entry is already unpublished'
      });
    }

    const updated = await transcriptDb.updateChangelogEntry(id, { is_published: false });

    res.json({
      success: true,
      message: 'Changelog entry unpublished',
      data: updated
    });
  } catch (error) {
    console.error('[Changelog] Error unpublishing entry:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
