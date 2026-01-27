/**
 * Authentication Routes
 * API endpoints for email/password authentication
 */

const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const authMiddleware = require('../middleware/auth');
const transcriptDb = require('../services/transcriptDb');
const emailService = require('../services/emailService');
const { loginRateLimiter, verifyRateLimiter, accessRequestRateLimiter } = require('../middleware/rateLimit');

// ========================================
// Password-Based Authentication Endpoints
// ========================================

/**
 * POST /api/auth/request-access
 * Request access with email, password, and optional name
 * Body: { email: string, password: string, name?: string }
 *
 * This is the primary endpoint for new users to request access.
 * - Validates email domain (@affiliatefinder.ai required)
 * - Validates password (min 12 characters)
 * - Creates access request with hashed password
 * - Admin must approve before user can login
 */
router.post('/request-access', accessRequestRateLimiter, async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_EMAIL',
        message: 'Email address is required'
      });
    }

    if (!password || typeof password !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_PASSWORD',
        message: 'Password is required'
      });
    }

    const result = await authService.requestAccess(email, password, name);

    if (!result.success && result.status === 'invalid_domain') {
      return res.status(400).json(result);
    }

    if (!result.success && result.error === 'INVALID_PASSWORD') {
      return res.status(400).json(result);
    }

    if (!result.success && result.status === 'approved') {
      return res.status(400).json({
        ...result,
        message: 'An account with this email already exists. Please login instead.'
      });
    }

    if (!result.success && result.status === 'deactivated') {
      return res.status(400).json(result);
    }

    // For pending requests (new or existing), return success
    return res.status(result.success ? 200 : 200).json({
      success: true,
      status: result.status,
      message: result.message,
      requestId: result.requestId,
      requestedAt: result.requestedAt,
      isReRequest: result.isReRequest || false
    });
  } catch (error) {
    console.error('[Auth] Error in request-access:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred while processing your request'
    });
  }
});

/**
 * POST /api/auth/login-password
 * Login with email and password
 * Body: { email: string, password: string }
 *
 * Only approved users with password set can login.
 * Returns session cookie on success.
 */
router.post('/login-password', loginRateLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_EMAIL',
        message: 'Email address is required'
      });
    }

    if (!password || typeof password !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_PASSWORD',
        message: 'Password is required'
      });
    }

    const result = await authService.loginWithPassword(email, password);

    if (!result.success) {
      // Determine appropriate HTTP status
      let httpStatus = 401;
      if (result.error === 'ACCESS_PENDING') {
        httpStatus = 403;
      } else if (result.error === 'ACCESS_DENIED' || result.error === 'USER_DEACTIVATED') {
        httpStatus = 403;
      }
      return res.status(httpStatus).json(result);
    }

    // Set session cookie
    res.cookie('session_id', result.session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: authService.SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
      path: '/'
    });

    return res.json({
      success: true,
      user: result.user,
      expiresAt: result.session.expiresAt
    });
  } catch (error) {
    console.error('[Auth] Error in login-password:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred while processing your request'
    });
  }
});

/**
 * POST /api/auth/admin/reset-password
 * Admin endpoint to reset a user's password
 * Body: { userId: string, newPassword: string }
 * Requires admin authentication
 */
router.post('/admin/reset-password', authMiddleware.requireAuth, authMiddleware.requireAdmin, async (req, res) => {
  try {
    const { userId, newPassword } = req.body;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_USER_ID',
        message: 'User ID is required'
      });
    }

    if (!newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_PASSWORD',
        message: 'New password is required'
      });
    }

    const result = await authService.adminResetPassword(userId, newPassword, req.user.id);

    if (!result.success) {
      const httpStatus = result.error === 'USER_NOT_FOUND' ? 404 : 400;
      return res.status(httpStatus).json(result);
    }

    return res.json(result);
  } catch (error) {
    console.error('[Auth] Error in admin reset-password:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred while processing your request'
    });
  }
});

/**
 * POST /api/auth/change-password
 * Self-service password change for authenticated users
 * Body: { currentPassword: string, newPassword: string }
 * Requires authentication
 */
router.post('/change-password', authMiddleware.requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || typeof currentPassword !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_PASSWORD',
        message: 'Current password is required'
      });
    }

    if (!newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_PASSWORD',
        message: 'New password is required'
      });
    }

    const result = await authService.changePassword(req.user.id, currentPassword, newPassword);

    if (!result.success) {
      const httpStatus = result.error === 'INVALID_PASSWORD' ? 401 : 400;
      return res.status(httpStatus).json(result);
    }

    return res.json(result);
  } catch (error) {
    console.error('[Auth] Error in change-password:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred while processing your request'
    });
  }
});

// ========================================
// Legacy Magic Link Endpoints (deprecated but kept for backward compatibility)
// ========================================

/**
 * POST /api/auth/login
 * DEPRECATED: Use /api/auth/login-password instead
 * Combined login/access request flow for magic links
 * Body: { email: string, name?: string }
 */
router.post('/login', loginRateLimiter, async (req, res) => {
  try {
    const { email, name } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_EMAIL',
        message: 'Email address is required'
      });
    }

    const result = await authService.authenticateOrRequestAccess(email, name);

    // For approved users, send magic link email
    if (result.status === 'approved') {
      // Send magic link email (async, don't wait)
      emailService.sendMagicLinkEmail(
        result.userEmail,
        null, // Name will be fetched from user record if needed
        result.token,
        { expiresInMinutes: authService.MAGIC_LINK_EXPIRY_MINUTES }
      ).catch(err => console.error('[Auth] Failed to send magic link email:', err));

      const response = {
        success: true,
        status: result.status,
        message: result.message
      };

      // In development, return the token directly (for testing)
      if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
        response.token = result.token;
        response.expiresAt = result.expiresAt;
      }

      return res.json(response);
    }

    // For pending or invalid domain/deactivated, return appropriate status
    // Using 200 for pending (not an error, just a different state)
    // Using 400 for invalid_domain and deactivated (these are error states)
    const httpStatus = (result.status === 'invalid_domain' || result.status === 'deactivated') ? 400 : 200;

    return res.status(httpStatus).json({
      success: result.status === 'pending',  // Pending is technically successful
      status: result.status,
      message: result.message,
      requestId: result.requestId,
      requestedAt: result.requestedAt,
      isReRequest: result.isReRequest
    });
  } catch (error) {
    console.error('[Auth] Error in login flow:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred while processing your request'
    });
  }
});

/**
 * GET /api/auth/status
 * Check access status for an email address
 * Query: { email: string }
 */
router.get('/status', async (req, res) => {
  try {
    const { email } = req.query;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_EMAIL',
        message: 'Email address is required'
      });
    }

    const result = await authService.getAccessStatus(email);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[Auth] Error checking access status:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred while processing your request'
    });
  }
});

/**
 * POST /api/auth/magic-link
 * Request a magic link for login (legacy endpoint, kept for compatibility)
 * Body: { email: string }
 */
router.post('/magic-link', loginRateLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_EMAIL',
        message: 'Email address is required'
      });
    }

    const result = await authService.requestMagicLink(email);

    if (!result.success) {
      // Return 200 even for user not found to prevent email enumeration
      // In production, we'd send an email regardless
      if (result.error === 'USER_NOT_FOUND') {
        return res.json({
          success: true,
          message: 'If an account exists with this email, a login link has been sent'
        });
      }

      return res.status(400).json({
        success: false,
        error: result.error,
        message: result.message
      });
    }

    // In development, return the token directly (for testing)
    // In production, this would send an email instead
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      return res.json({
        success: true,
        message: 'Magic link generated',
        // Only include token in dev/test mode
        token: result.token,
        expiresAt: result.expiresAt
      });
    }

    // Production response - don't leak token
    res.json({
      success: true,
      message: 'If an account exists with this email, a login link has been sent'
    });
  } catch (error) {
    console.error('[Auth] Error requesting magic link:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred while processing your request'
    });
  }
});

/**
 * GET /api/auth/verify
 * Verify a magic link token and create session
 * Query: { token: string }
 */
router.get('/verify', verifyRateLimiter, async (req, res) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_TOKEN',
        message: 'Token is required'
      });
    }

    const result = await authService.verifyMagicLink(token);

    if (!result.success) {
      return res.status(401).json({
        success: false,
        error: result.error,
        message: result.message
      });
    }

    // Set session cookie
    authMiddleware.setSessionCookie(res, result.session.id, result.session.expiresAt);

    res.json({
      success: true,
      message: 'Login successful',
      user: result.user,
      session: {
        expiresAt: result.session.expiresAt
      }
    });
  } catch (error) {
    console.error('[Auth] Error verifying magic link:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred while processing your request'
    });
  }
});

/**
 * POST /api/auth/logout
 * Logout and invalidate current session
 * Requires authentication
 */
router.post('/logout', authMiddleware.requireAuth, async (req, res) => {
  try {
    await authService.logout(req.sessionId);

    // Clear session cookie
    authMiddleware.clearSessionCookie(res);

    res.json({
      success: true,
      message: 'Successfully logged out'
    });
  } catch (error) {
    console.error('[Auth] Error logging out:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred while processing your request'
    });
  }
});

/**
 * POST /api/auth/logout-all
 * Logout from all devices (invalidate all sessions)
 * Requires authentication
 */
router.post('/logout-all', authMiddleware.requireAuth, async (req, res) => {
  try {
    await authService.logoutAll(req.user.id);

    // Clear session cookie
    authMiddleware.clearSessionCookie(res);

    res.json({
      success: true,
      message: 'Successfully logged out from all devices'
    });
  } catch (error) {
    console.error('[Auth] Error logging out from all devices:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred while processing your request'
    });
  }
});

/**
 * GET /api/auth/me
 * Get current user info
 * Requires authentication
 */
router.get('/me', authMiddleware.requireAuth, async (req, res) => {
  try {
    res.json({
      success: true,
      user: req.user
    });
  } catch (error) {
    console.error('[Auth] Error getting current user:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred while processing your request'
    });
  }
});

/**
 * POST /api/auth/extend
 * Extend current session expiry
 * Requires authentication
 */
router.post('/extend', authMiddleware.requireAuth, async (req, res) => {
  try {
    const result = await authService.extendSession(req.sessionId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
        message: result.message
      });
    }

    // Update session cookie with new expiry
    authMiddleware.setSessionCookie(res, req.sessionId, result.expiresAt);

    res.json({
      success: true,
      message: 'Session extended',
      expiresAt: result.expiresAt
    });
  } catch (error) {
    console.error('[Auth] Error extending session:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred while processing your request'
    });
  }
});

/**
 * GET /api/auth/setup-status
 * Check if initial admin setup is needed
 * No authentication required
 */
router.get('/setup-status', async (req, res) => {
  try {
    const needsSetup = await authService.needsInitialSetup();

    res.json({
      success: true,
      needsSetup
    });
  } catch (error) {
    console.error('[Auth] Error checking setup status:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred while processing your request'
    });
  }
});

/**
 * POST /api/auth/setup
 * Perform initial admin setup
 * Body: { email: string, name: string }
 * Only works if no admin exists
 */
router.post('/setup', async (req, res) => {
  try {
    const { email, name, password } = req.body;

    if (!email || !name) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELDS',
        message: 'Email and name are required'
      });
    }

    const result = await authService.setupInitialAdmin({ email, name, password });

    if (!result.success) {
      const status = result.error === 'ADMIN_EXISTS' ? 403 : 400;
      return res.status(status).json({
        success: false,
        error: result.error,
        message: result.message
      });
    }

    // In development, return the token directly
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      return res.json({
        success: true,
        message: 'Admin account created. Use the magic link to login.',
        token: result.token,
        expiresAt: result.expiresAt,
        user: result.user
      });
    }

    // Production response
    res.json({
      success: true,
      message: 'Admin account created. A login link has been sent to your email.',
      user: {
        email: result.user.email,
        name: result.user.name
      }
    });
  } catch (error) {
    console.error('[Auth] Error in initial setup:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred while processing your request'
    });
  }
});

/**
 * POST /api/auth/invite
 * Invite a new user (admin only)
 * Body: { email: string, name: string, role: 'admin' | 'rep' }
 * Requires admin authentication
 */
router.post('/invite', authMiddleware.requireAuth, authMiddleware.requireAdmin, async (req, res) => {
  try {
    const { email, name, role = 'rep' } = req.body;

    if (!email || !name) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELDS',
        message: 'Email and name are required'
      });
    }

    if (role !== 'admin' && role !== 'rep') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_ROLE',
        message: 'Role must be either "admin" or "rep"'
      });
    }

    const result = await authService.inviteUser({ email, name, role });

    if (!result.success) {
      const status = result.error === 'USER_EXISTS' ? 409 : 400;
      return res.status(status).json({
        success: false,
        error: result.error,
        message: result.message
      });
    }

    // In development, return the token directly
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      return res.json({
        success: true,
        message: 'User invited successfully',
        token: result.token,
        expiresAt: result.expiresAt,
        user: result.user
      });
    }

    // Production response
    res.json({
      success: true,
      message: 'User invited successfully. An invitation link has been sent.',
      user: result.user
    });
  } catch (error) {
    console.error('[Auth] Error inviting user:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred while processing your request'
    });
  }
});

// ========================================
// User Management Routes (Admin Only)
// ========================================

/**
 * GET /api/auth/users
 * List all users (admin only)
 * Query: { includeInactive?: boolean }
 */
router.get('/users', authMiddleware.requireAuth, authMiddleware.requireAdmin, async (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const users = await transcriptDb.getUsers({ includeInactive });

    res.json({
      success: true,
      users: users.map(user => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: !!user.is_active,
        createdAt: user.created_at,
        lastLogin: user.last_login
      }))
    });
  } catch (error) {
    console.error('[Auth] Error listing users:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred while processing your request'
    });
  }
});

/**
 * GET /api/auth/users/:id
 * Get a specific user (admin only)
 */
router.get('/users/:id', authMiddleware.requireAuth, authMiddleware.requireAdmin, async (req, res) => {
  try {
    const user = await transcriptDb.getUserById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: !!user.is_active,
        createdAt: user.created_at,
        lastLogin: user.last_login
      }
    });
  } catch (error) {
    console.error('[Auth] Error getting user:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred while processing your request'
    });
  }
});

/**
 * PUT /api/auth/users/:id
 * Update a user (admin only)
 * Body: { name?: string, role?: 'admin' | 'rep' }
 */
router.put('/users/:id', authMiddleware.requireAuth, authMiddleware.requireAdmin, async (req, res) => {
  try {
    const { name, role } = req.body;
    const userId = req.params.id;

    // Check if user exists
    const existingUser = await transcriptDb.getUserById(userId);
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    // Validate role if provided
    if (role && role !== 'admin' && role !== 'rep') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_ROLE',
        message: 'Role must be either "admin" or "rep"'
      });
    }

    // Prevent demoting yourself from admin
    if (userId === req.user.id && role === 'rep' && req.user.role === 'admin') {
      return res.status(400).json({
        success: false,
        error: 'CANNOT_DEMOTE_SELF',
        message: 'You cannot demote yourself from admin'
      });
    }

    // Build updates object
    const updates = {};
    if (name) updates.name = name;
    if (role) updates.role = role;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'NO_UPDATES',
        message: 'No valid updates provided'
      });
    }

    const updatedUser = await transcriptDb.updateUser(userId, updates);

    res.json({
      success: true,
      message: 'User updated successfully',
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
        isActive: !!updatedUser.is_active,
        createdAt: updatedUser.created_at,
        lastLogin: updatedUser.last_login
      }
    });
  } catch (error) {
    console.error('[Auth] Error updating user:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred while processing your request'
    });
  }
});

/**
 * DELETE /api/auth/users/:id
 * Deactivate a user (admin only)
 * Note: This deactivates rather than deletes for audit purposes
 */
router.delete('/users/:id', authMiddleware.requireAuth, authMiddleware.requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    // Check if user exists
    const existingUser = await transcriptDb.getUserById(userId);
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    // Prevent deactivating yourself
    if (userId === req.user.id) {
      return res.status(400).json({
        success: false,
        error: 'CANNOT_DEACTIVATE_SELF',
        message: 'You cannot deactivate your own account'
      });
    }

    // Deactivate user and invalidate all their sessions
    await transcriptDb.deactivateUser(userId);
    await transcriptDb.deleteSessionsForUser(userId);
    await transcriptDb.deleteMagicLinksForUser(userId);

    res.json({
      success: true,
      message: 'User deactivated successfully'
    });
  } catch (error) {
    console.error('[Auth] Error deactivating user:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred while processing your request'
    });
  }
});

/**
 * POST /api/auth/users/:id/reactivate
 * Reactivate a deactivated user (admin only)
 */
router.post('/users/:id/reactivate', authMiddleware.requireAuth, authMiddleware.requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    // Check if user exists
    const existingUser = await transcriptDb.getUserById(userId);
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    if (existingUser.is_active) {
      return res.status(400).json({
        success: false,
        error: 'USER_ALREADY_ACTIVE',
        message: 'User is already active'
      });
    }

    // Reactivate user
    const updatedUser = await transcriptDb.updateUser(userId, { is_active: 1 });

    res.json({
      success: true,
      message: 'User reactivated successfully',
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
        isActive: !!updatedUser.is_active
      }
    });
  } catch (error) {
    console.error('[Auth] Error reactivating user:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred while processing your request'
    });
  }
});

/**
 * POST /api/auth/users/:id/resend-invite
 * Resend invitation link to a user (admin only)
 */
router.post('/users/:id/resend-invite', authMiddleware.requireAuth, authMiddleware.requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    // Check if user exists
    const existingUser = await transcriptDb.getUserById(userId);
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    if (!existingUser.is_active) {
      return res.status(400).json({
        success: false,
        error: 'USER_DEACTIVATED',
        message: 'Cannot send invite to deactivated user'
      });
    }

    // Generate new magic link
    const result = await authService.requestMagicLink(existingUser.email);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
        message: result.message
      });
    }

    // In development, return the token directly
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      return res.json({
        success: true,
        message: 'Invitation link resent',
        token: result.token,
        expiresAt: result.expiresAt
      });
    }

    res.json({
      success: true,
      message: 'Invitation link sent to user\'s email'
    });
  } catch (error) {
    console.error('[Auth] Error resending invite:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred while processing your request'
    });
  }
});

// ========================================
// Access Request Management Routes (Admin Only)
// ========================================

/**
 * GET /api/auth/access-requests
 * List all access requests (admin only)
 * Query: { status?: 'pending' | 'approved' | 'denied' }
 */
router.get('/access-requests', authMiddleware.requireAuth, authMiddleware.requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;

    // Validate status if provided
    if (status && !['pending', 'approved', 'denied'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_STATUS',
        message: 'Status must be pending, approved, or denied'
      });
    }

    const requests = await authService.getAccessRequests({ status });

    res.json({
      success: true,
      requests: requests.map(request => ({
        id: request.id,
        email: request.email,
        name: request.name,
        status: request.status,
        createdAt: request.created_at,
        lastRequestedAt: request.last_requested_at,
        decidedAt: request.decided_at,
        decidedBy: request.decided_by,
        notes: request.notes
      }))
    });
  } catch (error) {
    console.error('[Auth] Error listing access requests:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred while processing your request'
    });
  }
});

/**
 * GET /api/auth/access-requests/:id
 * Get a specific access request (admin only)
 */
router.get('/access-requests/:id', authMiddleware.requireAuth, authMiddleware.requireAdmin, async (req, res) => {
  try {
    const request = await transcriptDb.getAccessRequestById(req.params.id);

    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'REQUEST_NOT_FOUND',
        message: 'Access request not found'
      });
    }

    // Get admin user info if decided_by is set
    let decidedByUser = null;
    if (request.decided_by) {
      decidedByUser = await transcriptDb.getUserById(request.decided_by);
    }

    res.json({
      success: true,
      request: {
        id: request.id,
        email: request.email,
        name: request.name,
        status: request.status,
        createdAt: request.created_at,
        lastRequestedAt: request.last_requested_at,
        decidedAt: request.decided_at,
        decidedBy: decidedByUser ? {
          id: decidedByUser.id,
          email: decidedByUser.email,
          name: decidedByUser.name
        } : null,
        notes: request.notes
      }
    });
  } catch (error) {
    console.error('[Auth] Error getting access request:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred while processing your request'
    });
  }
});

/**
 * POST /api/auth/access-requests/:id/approve
 * Approve an access request and create user account (admin only)
 * Body: { name?: string, role?: 'admin' | 'rep', notes?: string }
 */
router.post('/access-requests/:id/approve', authMiddleware.requireAuth, authMiddleware.requireAdmin, async (req, res) => {
  try {
    const { name, role, notes } = req.body;

    // Validate role if provided
    if (role && role !== 'admin' && role !== 'rep') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_ROLE',
        message: 'Role must be either "admin" or "rep"'
      });
    }

    const result = await authService.approveAccessRequest(
      req.params.id,
      req.user.id,
      { name, role, notes }
    );

    if (!result.success) {
      const status = result.error === 'REQUEST_NOT_FOUND' ? 404 : 400;
      return res.status(status).json({
        success: false,
        error: result.error,
        message: result.message
      });
    }

    // Send approval notification email (async, don't wait)
    emailService.sendApprovalNotification(
      result.user.email,
      result.user.name
    ).catch(err => console.error('[Auth] Failed to send approval notification:', err));

    res.json({
      success: true,
      message: result.message,
      user: result.user,
      request: result.request
    });
  } catch (error) {
    console.error('[Auth] Error approving access request:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred while processing your request'
    });
  }
});

/**
 * POST /api/auth/access-requests/:id/deny
 * Deny an access request (admin only)
 * Body: { reason?: string }
 */
router.post('/access-requests/:id/deny', authMiddleware.requireAuth, authMiddleware.requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body;

    const result = await authService.denyAccessRequest(
      req.params.id,
      req.user.id,
      reason
    );

    if (!result.success) {
      const status = result.error === 'REQUEST_NOT_FOUND' ? 404 : 400;
      return res.status(status).json({
        success: false,
        error: result.error,
        message: result.message
      });
    }

    // Send denial notification email (async, don't wait)
    emailService.sendDenialNotification(
      result.request.email,
      reason
    ).catch(err => console.error('[Auth] Failed to send denial notification:', err));

    res.json({
      success: true,
      message: result.message,
      request: result.request
    });
  } catch (error) {
    console.error('[Auth] Error denying access request:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred while processing your request'
    });
  }
});

/**
 * DELETE /api/auth/access-requests/:id
 * Delete an access request (admin only)
 * Note: This permanently deletes the request record
 */
router.delete('/access-requests/:id', authMiddleware.requireAuth, authMiddleware.requireAdmin, async (req, res) => {
  try {
    const request = await transcriptDb.getAccessRequestById(req.params.id);

    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'REQUEST_NOT_FOUND',
        message: 'Access request not found'
      });
    }

    await transcriptDb.deleteAccessRequest(req.params.id);

    res.json({
      success: true,
      message: 'Access request deleted'
    });
  } catch (error) {
    console.error('[Auth] Error deleting access request:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An error occurred while processing your request'
    });
  }
});

module.exports = router;
