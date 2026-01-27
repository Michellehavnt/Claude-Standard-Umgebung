/**
 * Authentication Service
 * Handles email/password authentication, session management, and user verification
 *
 * Authentication Flow:
 * 1. User enters email + password on access request page
 * 2. System checks if email domain is @affiliatefinder.ai (required)
 * 3. System creates access request with password hash stored
 * 4. Admin approves/denies requests via admin panel
 * 5. On approval: user account created with password hash copied
 * 6. Approved users can login with email + password
 * 7. If user tries to login before approval: show "pending approval" message
 */

const transcriptDb = require('./transcriptDb');
const bcrypt = require('bcrypt');

// Session configuration
const SESSION_EXPIRY_DAYS = 30;  // User requested 30 days
const MAGIC_LINK_EXPIRY_MINUTES = 60;  // Kept for potential future use (password reset tokens)

// Password configuration
const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 12;

// Domain restriction
const ALLOWED_EMAIL_DOMAIN = 'affiliatefinder.ai';

// Admin emails from environment (comma-separated)
// These users are auto-granted admin role when approved
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(email => email.toLowerCase().trim())
  .filter(email => email.length > 0);

/**
 * Check if an email has the allowed domain
 * @param {string} email - Email address to check
 * @returns {boolean} - True if domain is allowed
 */
function isAllowedDomain(email) {
  if (!email || typeof email !== 'string') return false;
  const domain = email.toLowerCase().split('@')[1];
  return domain === ALLOWED_EMAIL_DOMAIN;
}

/**
 * Check if an email is in the admin allowlist
 * @param {string} email - Email address to check
 * @returns {boolean} - True if email is in admin allowlist
 */
function isAdminEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return ADMIN_EMAILS.includes(email.toLowerCase().trim());
}

/**
 * Validate password meets requirements
 * @param {string} password - Password to validate
 * @returns {Object} - { valid: boolean, error?: string }
 */
function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  return { valid: true };
}

/**
 * Hash a password using bcrypt
 * @param {string} password - Plain text password
 * @returns {Promise<string>} - Hashed password
 */
async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Verify a password against a hash
 * @param {string} password - Plain text password
 * @param {string} hash - Hashed password
 * @returns {Promise<boolean>} - True if password matches
 */
async function verifyPassword(password, hash) {
  if (!password || !hash) return false;
  return bcrypt.compare(password, hash);
}

/**
 * Combined authentication flow - handles login with access request workflow
 * This is the main entry point for the login page
 *
 * Flow:
 * 1. Validate email domain (@affiliatefinder.ai required)
 * 2. Check if user is approved (exists in users table and is_active)
 * 3. If approved: generate magic link
 * 4. If not approved: handle access request workflow
 *
 * @param {string} email - User email address
 * @param {string} name - Optional name for access request
 * @returns {Object} - Result with status and message
 */
async function authenticateOrRequestAccess(email, name = null) {
  const normalizedEmail = email.toLowerCase().trim();

  // Step 1: Validate email domain
  if (!isAllowedDomain(normalizedEmail)) {
    return {
      success: false,
      error: 'INVALID_DOMAIN',
      status: 'invalid_domain',
      message: `Only @${ALLOWED_EMAIL_DOMAIN} email addresses are allowed`
    };
  }

  // Step 2: Check if user is already approved (exists in users table)
  const user = await transcriptDb.getUserByEmail(normalizedEmail);

  if (user) {
    // User exists - check if active
    if (!user.is_active) {
      return {
        success: false,
        error: 'USER_DEACTIVATED',
        status: 'deactivated',
        message: 'Your account has been deactivated. Please contact an administrator.'
      };
    }

    // User is active - generate magic link
    const magicLink = await transcriptDb.createMagicLink(user.id, MAGIC_LINK_EXPIRY_MINUTES);
    return {
      success: true,
      status: 'approved',
      message: 'Magic link sent! Check your email.',
      token: magicLink.token,
      expiresAt: magicLink.expires_at,
      userId: user.id,
      userEmail: user.email
    };
  }

  // Step 3: User not in users table - check access request status
  const existingRequest = await transcriptDb.getAccessRequestByEmail(normalizedEmail);

  if (existingRequest) {
    switch (existingRequest.status) {
      case 'pending':
        return {
          success: false,
          error: 'ACCESS_PENDING',
          status: 'pending',
          message: 'Your access request is pending admin approval.',
          requestId: existingRequest.id,
          requestedAt: existingRequest.created_at
        };

      case 'denied':
        // Allow re-request - create new pending request
        const reRequest = await transcriptDb.createAccessRequest({
          email: normalizedEmail,
          name: name || existingRequest.name
        });
        return {
          success: false,
          error: 'ACCESS_REQUESTED',
          status: 'pending',
          message: 'Your access request has been resubmitted for admin approval.',
          requestId: reRequest.id,
          isReRequest: true
        };

      case 'approved':
        // This shouldn't happen (user should be in users table), but handle it
        return {
          success: false,
          error: 'SYSTEM_ERROR',
          status: 'error',
          message: 'Account setup incomplete. Please contact an administrator.'
        };

      default:
        return {
          success: false,
          error: 'UNKNOWN_STATUS',
          status: 'error',
          message: 'An error occurred. Please try again.'
        };
    }
  }

  // Step 4: No existing request - create new access request
  const newRequest = await transcriptDb.createAccessRequest({
    email: normalizedEmail,
    name: name
  });

  return {
    success: false,
    error: 'ACCESS_REQUESTED',
    status: 'pending',
    message: 'Access request submitted. An administrator will review your request.',
    requestId: newRequest.id,
    requestedAt: newRequest.created_at
  };
}

/**
 * Request access with email, password, and optional name
 * This is the main entry point for new users requesting access
 *
 * @param {string} email - User email address
 * @param {string} password - User password (will be hashed)
 * @param {string} name - Optional name
 * @returns {Object} - Result with status and message
 */
async function requestAccess(email, password, name = null) {
  const normalizedEmail = email.toLowerCase().trim();

  // Step 1: Validate email domain
  if (!isAllowedDomain(normalizedEmail)) {
    return {
      success: false,
      error: 'INVALID_DOMAIN',
      status: 'invalid_domain',
      message: `Only @${ALLOWED_EMAIL_DOMAIN} email addresses are allowed`
    };
  }

  // Step 2: Validate password
  const passwordValidation = validatePassword(password);
  if (!passwordValidation.valid) {
    return {
      success: false,
      error: 'INVALID_PASSWORD',
      status: 'error',
      message: passwordValidation.error
    };
  }

  // Step 3: Check if user already exists (approved)
  const existingUser = await transcriptDb.getUserByEmail(normalizedEmail);
  if (existingUser) {
    if (existingUser.is_active) {
      return {
        success: false,
        error: 'USER_EXISTS',
        status: 'approved',
        message: 'An account with this email already exists. Please login instead.'
      };
    } else {
      return {
        success: false,
        error: 'USER_DEACTIVATED',
        status: 'deactivated',
        message: 'Your account has been deactivated. Please contact an administrator.'
      };
    }
  }

  // Step 4: Check if there's already a pending request
  const existingRequest = await transcriptDb.getAccessRequestByEmail(normalizedEmail);
  if (existingRequest && existingRequest.status === 'pending') {
    return {
      success: false,
      error: 'ACCESS_PENDING',
      status: 'pending',
      message: 'Your access request is already pending admin approval.',
      requestId: existingRequest.id,
      requestedAt: existingRequest.created_at
    };
  }

  // Step 5: Hash the password
  const passwordHash = await hashPassword(password);

  // Step 6: Create or update access request with password hash
  const request = await transcriptDb.createAccessRequest({
    email: normalizedEmail,
    name: name,
    password_hash: passwordHash
  });

  const isReRequest = request.isReRequest || false;

  return {
    success: true,
    status: 'pending',
    message: isReRequest
      ? 'Your access request has been resubmitted for admin approval.'
      : 'Access request submitted. An administrator will review your request.',
    requestId: request.id,
    requestedAt: request.created_at || request.last_requested_at,
    isReRequest
  };
}

/**
 * Login with email and password
 * Only approved users with password set can login
 *
 * @param {string} email - User email address
 * @param {string} password - User password
 * @returns {Object} - Result with session or error
 */
async function loginWithPassword(email, password) {
  const normalizedEmail = email.toLowerCase().trim();

  // Step 1: Validate email domain
  if (!isAllowedDomain(normalizedEmail)) {
    return {
      success: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password'  // Generic message to prevent enumeration
    };
  }

  // Step 2: Check if user exists
  const user = await transcriptDb.getUserByEmail(normalizedEmail);

  if (!user) {
    // Check if there's a pending access request
    const existingRequest = await transcriptDb.getAccessRequestByEmail(normalizedEmail);
    if (existingRequest) {
      if (existingRequest.status === 'pending') {
        return {
          success: false,
          error: 'ACCESS_PENDING',
          status: 'pending',
          message: 'Your access request is pending admin approval. Please wait for approval before logging in.',
          requestId: existingRequest.id
        };
      } else if (existingRequest.status === 'denied') {
        return {
          success: false,
          error: 'ACCESS_DENIED',
          status: 'denied',
          message: 'Your access request was denied. You can submit a new request.'
        };
      }
    }
    return {
      success: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password'
    };
  }

  // Step 3: Check if user is active
  if (!user.is_active) {
    return {
      success: false,
      error: 'USER_DEACTIVATED',
      status: 'deactivated',
      message: 'Your account has been deactivated. Please contact an administrator.'
    };
  }

  // Step 4: Check if user has password set
  if (!user.password_hash) {
    return {
      success: false,
      error: 'PASSWORD_NOT_SET',
      message: 'Password not set. Please contact an administrator.'
    };
  }

  // Step 5: Verify password
  const isValidPassword = await verifyPassword(password, user.password_hash);
  if (!isValidPassword) {
    return {
      success: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password'
    };
  }

  // Step 6: Create session
  const session = await transcriptDb.createSession(user.id, SESSION_EXPIRY_DAYS);

  // Step 7: Update last login
  await transcriptDb.updateUserLastLogin(user.id);

  return {
    success: true,
    session: {
      id: session.id,
      expiresAt: session.expires_at
    },
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    }
  };
}

/**
 * Admin reset password for a user
 * Generates a new password and updates the user's password hash
 *
 * @param {string} userId - User ID to reset password for
 * @param {string} newPassword - New password
 * @param {string} adminUserId - ID of admin making the change
 * @returns {Object} - Result
 */
async function adminResetPassword(userId, newPassword, adminUserId) {
  // Validate password
  const passwordValidation = validatePassword(newPassword);
  if (!passwordValidation.valid) {
    return {
      success: false,
      error: 'INVALID_PASSWORD',
      message: passwordValidation.error
    };
  }

  // Get user
  const user = await transcriptDb.getUserById(userId);
  if (!user) {
    return {
      success: false,
      error: 'USER_NOT_FOUND',
      message: 'User not found'
    };
  }

  // Hash new password
  const passwordHash = await hashPassword(newPassword);

  // Update user's password
  await transcriptDb.updateUserPassword(userId, passwordHash);

  // Invalidate all existing sessions for security
  await transcriptDb.deleteSessionsForUser(userId);

  return {
    success: true,
    message: 'Password reset successfully. User will need to login again.'
  };
}

/**
 * Change password for authenticated user (self-service)
 * Verifies current password before allowing change.
 *
 * @param {string} userId - User ID
 * @param {string} currentPassword - Current password
 * @param {string} newPassword - New password
 * @returns {Object} - Result
 */
async function changePassword(userId, currentPassword, newPassword) {
  // Get user
  const user = await transcriptDb.getUserById(userId);
  if (!user) {
    return {
      success: false,
      error: 'USER_NOT_FOUND',
      message: 'User not found'
    };
  }

  // Verify current password
  if (!user.password_hash) {
    return {
      success: false,
      error: 'INVALID_PASSWORD',
      message: 'No password set for this account'
    };
  }

  const isValid = await verifyPassword(currentPassword, user.password_hash);
  if (!isValid) {
    return {
      success: false,
      error: 'INVALID_PASSWORD',
      message: 'Current password is incorrect'
    };
  }

  // Validate new password
  const passwordValidation = validatePassword(newPassword);
  if (!passwordValidation.valid) {
    return {
      success: false,
      error: 'INVALID_PASSWORD',
      message: passwordValidation.error
    };
  }

  // Hash new password
  const passwordHash = await hashPassword(newPassword);

  // Update user's password
  await transcriptDb.updateUserPassword(userId, passwordHash);

  return {
    success: true,
    message: 'Password changed successfully'
  };
}

/**
 * Approve an access request and create user account
 * @param {string} requestId - Access request ID
 * @param {string} adminUserId - ID of admin making the decision
 * @param {Object} options - Optional settings
 * @param {string} options.name - Name for the new user (overrides request name)
 * @param {string} options.role - Role for new user (default: auto-detect from ADMIN_EMAILS)
 * @param {string} options.notes - Optional notes about the approval
 * @returns {Object} - Result with user info or error
 */
async function approveAccessRequest(requestId, adminUserId, options = {}) {
  const request = await transcriptDb.getAccessRequestById(requestId);

  if (!request) {
    return {
      success: false,
      error: 'REQUEST_NOT_FOUND',
      message: 'Access request not found'
    };
  }

  if (request.status !== 'pending') {
    return {
      success: false,
      error: 'INVALID_REQUEST_STATUS',
      message: `Cannot approve request with status: ${request.status}`
    };
  }

  // Determine role (admin if in ADMIN_EMAILS, otherwise user)
  const role = options.role || (isAdminEmail(request.email) ? 'admin' : 'rep');

  // Create user account with password hash from access request
  const userName = options.name || request.name || request.email.split('@')[0];
  const user = await transcriptDb.createUser({
    email: request.email,
    name: userName,
    role: role,
    password_hash: request.password_hash  // Copy password hash from access request
  });

  // Update request status
  await transcriptDb.updateAccessRequestStatus(
    requestId,
    'approved',
    adminUserId,
    options.notes || null
  );

  return {
    success: true,
    message: 'Access request approved. User account created.',
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    },
    request: {
      id: requestId,
      status: 'approved'
    }
  };
}

/**
 * Deny an access request
 * @param {string} requestId - Access request ID
 * @param {string} adminUserId - ID of admin making the decision
 * @param {string} reason - Optional reason for denial
 * @returns {Object} - Result
 */
async function denyAccessRequest(requestId, adminUserId, reason = null) {
  const request = await transcriptDb.getAccessRequestById(requestId);

  if (!request) {
    return {
      success: false,
      error: 'REQUEST_NOT_FOUND',
      message: 'Access request not found'
    };
  }

  if (request.status !== 'pending') {
    return {
      success: false,
      error: 'INVALID_REQUEST_STATUS',
      message: `Cannot deny request with status: ${request.status}`
    };
  }

  // Update request status
  await transcriptDb.updateAccessRequestStatus(
    requestId,
    'denied',
    adminUserId,
    reason
  );

  return {
    success: true,
    message: 'Access request denied.',
    request: {
      id: requestId,
      email: request.email,
      status: 'denied'
    }
  };
}

/**
 * Get all access requests (for admin view)
 * @param {Object} options - Filter options
 * @param {string} options.status - Filter by status (pending, approved, denied)
 * @returns {Array} - List of access requests
 */
async function getAccessRequests(options = {}) {
  return transcriptDb.getAccessRequests(options);
}

/**
 * Get access request status for an email
 * @param {string} email - Email address
 * @returns {Object} - Status info
 */
async function getAccessStatus(email) {
  const normalizedEmail = email.toLowerCase().trim();

  // Check domain first
  if (!isAllowedDomain(normalizedEmail)) {
    return {
      status: 'invalid_domain',
      message: `Only @${ALLOWED_EMAIL_DOMAIN} email addresses are allowed`
    };
  }

  // Check if user exists
  const user = await transcriptDb.getUserByEmail(normalizedEmail);
  if (user) {
    if (user.is_active) {
      return { status: 'approved', message: 'Account is active' };
    } else {
      return { status: 'deactivated', message: 'Account has been deactivated' };
    }
  }

  // Check access request
  const request = await transcriptDb.getAccessRequestByEmail(normalizedEmail);
  if (request) {
    return {
      status: request.status,
      message: request.status === 'pending'
        ? 'Access request is pending admin approval'
        : request.status === 'denied'
          ? 'Access request was denied'
          : 'Access request was approved',
      requestId: request.id,
      requestedAt: request.created_at,
      decidedAt: request.decided_at
    };
  }

  // No user or request
  return {
    status: 'none',
    message: 'No account or access request found'
  };
}

/**
 * Request a magic link for a user by email
 * Creates user if they don't exist (for first-time admin setup)
 * @param {string} email - User email address
 * @param {Object} options - Optional settings
 * @param {boolean} options.createIfNotExists - Create user if not found (for admin setup)
 * @param {string} options.name - Name for new user (required if createIfNotExists)
 * @param {string} options.role - Role for new user (default: 'rep')
 * @returns {Object} - Result with token or error
 */
async function requestMagicLink(email, options = {}) {
  const normalizedEmail = email.toLowerCase().trim();

  // Look up user by email
  let user = await transcriptDb.getUserByEmail(normalizedEmail);

  // Handle user not found
  if (!user) {
    if (options.createIfNotExists && options.name) {
      // Create new user (for admin setup or invitation)
      user = await transcriptDb.createUser({
        email: normalizedEmail,
        name: options.name,
        role: options.role || 'rep'
      });
    } else {
      return {
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'No account found with this email address'
      };
    }
  }

  // Check if user is active
  if (!user.is_active) {
    return {
      success: false,
      error: 'USER_DEACTIVATED',
      message: 'This account has been deactivated'
    };
  }

  // Generate magic link token
  const magicLink = await transcriptDb.createMagicLink(user.id, MAGIC_LINK_EXPIRY_MINUTES);

  return {
    success: true,
    token: magicLink.token,
    expiresAt: magicLink.expires_at,
    userId: user.id,
    userEmail: user.email
  };
}

/**
 * Verify a magic link token and create a session
 * @param {string} token - Magic link token
 * @returns {Object} - Result with session or error
 */
async function verifyMagicLink(token) {
  if (!token) {
    return {
      success: false,
      error: 'INVALID_TOKEN',
      message: 'Token is required'
    };
  }

  // Validate and consume the magic link
  const user = await transcriptDb.validateAndUseMagicLink(token);

  if (!user) {
    return {
      success: false,
      error: 'INVALID_TOKEN',
      message: 'Invalid, expired, or already used token'
    };
  }

  // Check if user is active
  if (!user.is_active) {
    return {
      success: false,
      error: 'USER_DEACTIVATED',
      message: 'This account has been deactivated'
    };
  }

  // Create session
  const session = await transcriptDb.createSession(user.id, SESSION_EXPIRY_DAYS);

  // Update user's last login
  await transcriptDb.updateUserLastLogin(user.id);

  return {
    success: true,
    session: {
      id: session.id,
      expiresAt: session.expires_at
    },
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    }
  };
}

/**
 * Verify a session and return the user
 * @param {string} sessionId - Session ID
 * @returns {Object} - Result with user or error
 */
async function verifySession(sessionId) {
  if (!sessionId) {
    return {
      success: false,
      error: 'NO_SESSION',
      message: 'Session ID is required'
    };
  }

  const user = await transcriptDb.validateSession(sessionId);

  if (!user) {
    return {
      success: false,
      error: 'INVALID_SESSION',
      message: 'Invalid or expired session'
    };
  }

  return {
    success: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    }
  };
}

/**
 * Logout - destroy a session
 * @param {string} sessionId - Session ID
 * @returns {Object} - Result
 */
async function logout(sessionId) {
  if (!sessionId) {
    return {
      success: false,
      error: 'NO_SESSION',
      message: 'Session ID is required'
    };
  }

  await transcriptDb.deleteSession(sessionId);

  return {
    success: true,
    message: 'Successfully logged out'
  };
}

/**
 * Logout from all devices - destroy all sessions for a user
 * @param {string} userId - User ID
 * @returns {Object} - Result
 */
async function logoutAll(userId) {
  if (!userId) {
    return {
      success: false,
      error: 'NO_USER',
      message: 'User ID is required'
    };
  }

  await transcriptDb.deleteSessionsForUser(userId);

  return {
    success: true,
    message: 'Successfully logged out from all devices'
  };
}

/**
 * Get current user info from session
 * @param {string} sessionId - Session ID
 * @returns {Object} - User info or error
 */
async function getCurrentUser(sessionId) {
  return verifySession(sessionId);
}

/**
 * Invite a new user (admin only)
 * Creates user and generates magic link
 * @param {Object} userData - User data
 * @param {string} userData.email - User email
 * @param {string} userData.name - User name
 * @param {string} userData.role - User role ('admin' or 'rep')
 * @returns {Object} - Result with invite link or error
 */
async function inviteUser(userData) {
  const { email, name, role = 'rep' } = userData;

  if (!email || !name) {
    return {
      success: false,
      error: 'MISSING_FIELDS',
      message: 'Email and name are required'
    };
  }

  // Check if user already exists
  const existingUser = await transcriptDb.getUserByEmail(email);
  if (existingUser) {
    return {
      success: false,
      error: 'USER_EXISTS',
      message: 'A user with this email already exists'
    };
  }

  // Create user and magic link
  const result = await requestMagicLink(email, {
    createIfNotExists: true,
    name,
    role
  });

  if (!result.success) {
    return result;
  }

  return {
    success: true,
    token: result.token,
    expiresAt: result.expiresAt,
    user: {
      id: result.userId,
      email: result.userEmail,
      name,
      role
    }
  };
}

/**
 * Check if initial admin setup is needed
 * Returns true if no admin users exist
 * @returns {boolean}
 */
async function needsInitialSetup() {
  const hasAdmin = await transcriptDb.hasAdminUser();
  return !hasAdmin;
}

/**
 * Perform initial admin setup
 * Creates the first admin user with password
 * @param {Object} adminData - Admin user data
 * @param {string} adminData.email - Admin email
 * @param {string} adminData.name - Admin name
 * @param {string} adminData.password - Admin password (optional for backward compatibility)
 * @returns {Object} - Result with user info or error
 */
async function setupInitialAdmin(adminData) {
  const { email, name, password } = adminData;

  if (!email || !name) {
    return {
      success: false,
      error: 'MISSING_FIELDS',
      message: 'Email and name are required'
    };
  }

  // Check if admin already exists
  const hasAdmin = await transcriptDb.hasAdminUser();
  if (hasAdmin) {
    return {
      success: false,
      error: 'ADMIN_EXISTS',
      message: 'An admin user already exists. Initial setup is not available.'
    };
  }

  // If password is provided, use password-based setup
  if (password) {
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return {
        success: false,
        error: 'INVALID_PASSWORD',
        message: passwordValidation.error
      };
    }

    const passwordHash = await hashPassword(password);

    // Create admin user with password
    const user = await transcriptDb.createUser({
      email,
      name,
      role: 'admin',
      password_hash: passwordHash
    });

    return {
      success: true,
      message: 'Admin account created. You can now sign in.',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    };
  }

  // Legacy: Create admin user with magic link (backward compatibility)
  return inviteUser({
    email,
    name,
    role: 'admin'
  });
}

/**
 * Extend a session's expiry
 * @param {string} sessionId - Session ID
 * @returns {Object} - Result with new expiry or error
 */
async function extendSession(sessionId) {
  if (!sessionId) {
    return {
      success: false,
      error: 'NO_SESSION',
      message: 'Session ID is required'
    };
  }

  const session = await transcriptDb.extendSession(sessionId, SESSION_EXPIRY_DAYS);

  if (!session) {
    return {
      success: false,
      error: 'INVALID_SESSION',
      message: 'Session not found'
    };
  }

  return {
    success: true,
    expiresAt: session.expires_at
  };
}

/**
 * Cleanup expired tokens and sessions
 * Should be called periodically (e.g., daily cron job)
 * @returns {Object} - Cleanup stats
 */
async function cleanupExpired() {
  const expiredLinks = await transcriptDb.deleteExpiredMagicLinks();
  const expiredSessions = await transcriptDb.deleteExpiredSessions();

  return {
    deletedMagicLinks: expiredLinks,
    deletedSessions: expiredSessions
  };
}

module.exports = {
  // Password auth functions (primary)
  requestAccess,
  loginWithPassword,
  adminResetPassword,
  changePassword,
  verifySession,
  logout,
  logoutAll,
  getCurrentUser,

  // Password utilities
  validatePassword,
  hashPassword,
  verifyPassword,

  // Legacy magic link functions (kept for backward compatibility)
  requestMagicLink,
  verifyMagicLink,

  // Access request workflow
  authenticateOrRequestAccess,  // Legacy - kept for backward compatibility
  approveAccessRequest,
  denyAccessRequest,
  getAccessRequests,
  getAccessStatus,

  // Domain validation
  isAllowedDomain,
  isAdminEmail,

  // User management
  inviteUser,
  needsInitialSetup,
  setupInitialAdmin,

  // Session management
  extendSession,
  cleanupExpired,

  // Constants (exported for testing)
  SESSION_EXPIRY_DAYS,
  MAGIC_LINK_EXPIRY_MINUTES,
  ALLOWED_EMAIL_DOMAIN,
  ADMIN_EMAILS,
  MIN_PASSWORD_LENGTH,
  BCRYPT_ROUNDS
};
