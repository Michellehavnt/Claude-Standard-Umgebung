/**
 * Authentication Middleware
 * Protects routes that require authentication or admin access
 */

const authService = require('../services/authService');

// Cookie name for session ID
const SESSION_COOKIE_NAME = 'session_id';

/**
 * Extract session ID from request
 * Checks: 1) Cookie, 2) Authorization header (Bearer token)
 * @param {Object} req - Express request
 * @returns {string|null} - Session ID or null
 */
function getSessionId(req) {
  // 1. Check cookie
  if (req.cookies && req.cookies[SESSION_COOKIE_NAME]) {
    return req.cookies[SESSION_COOKIE_NAME];
  }

  // 2. Check Authorization header (Bearer token)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  return null;
}

/**
 * Middleware: Require authentication
 * Verifies session and attaches user to req.user
 * Returns 401 Unauthorized if no valid session
 */
async function requireAuth(req, res, next) {
  try {
    const sessionId = getSessionId(req);

    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Authentication required'
      });
    }

    const result = await authService.verifySession(sessionId);

    if (!result.success) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Invalid or expired session'
      });
    }

    // Attach user and session to request
    req.user = result.user;
    req.sessionId = sessionId;

    next();
  } catch (error) {
    console.error('[AuthMiddleware] Error in requireAuth:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Authentication error'
    });
  }
}

/**
 * Middleware: Require admin role
 * Must be used AFTER requireAuth middleware
 * Returns 403 Forbidden if user is not admin
 */
async function requireAdmin(req, res, next) {
  try {
    // requireAuth should have already verified and attached user
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Authentication required'
      });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: 'Admin access required'
      });
    }

    next();
  } catch (error) {
    console.error('[AuthMiddleware] Error in requireAdmin:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Authorization error'
    });
  }
}

/**
 * Middleware: Optional authentication
 * Attaches user to req.user if valid session exists, but doesn't require it
 * Useful for routes that behave differently for authenticated users
 */
async function optionalAuth(req, res, next) {
  try {
    const sessionId = getSessionId(req);

    if (sessionId) {
      const result = await authService.verifySession(sessionId);
      if (result.success) {
        req.user = result.user;
        req.sessionId = sessionId;
      }
    }

    next();
  } catch (error) {
    // Don't fail, just continue without user
    console.error('[AuthMiddleware] Error in optionalAuth:', error);
    next();
  }
}

/**
 * Set session cookie
 * @param {Object} res - Express response
 * @param {string} sessionId - Session ID
 * @param {Date} expiresAt - Expiration date
 */
function setSessionCookie(res, sessionId, expiresAt) {
  res.cookie(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: new Date(expiresAt),
    path: '/'
  });
}

/**
 * Clear session cookie
 * @param {Object} res - Express response
 */
function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/'
  });
}

module.exports = {
  requireAuth,
  requireAdmin,
  optionalAuth,
  getSessionId,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE_NAME
};
