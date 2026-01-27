/**
 * Rate Limiting Middleware
 * Simple in-memory rate limiter for auth endpoints
 *
 * Note: For production with multiple server instances,
 * consider using Redis-based rate limiting instead.
 */

// In-memory store for rate limiting
// Key: IP address or email, Value: { count, resetTime }
const store = new Map();

// Cleanup old entries periodically (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of store.entries()) {
    if (value.resetTime < now) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Create a rate limiter middleware
 * @param {Object} options - Rate limiter options
 * @param {number} options.windowMs - Time window in milliseconds (default: 15 minutes)
 * @param {number} options.max - Maximum number of requests per window (default: 5)
 * @param {string} options.message - Error message when rate limited
 * @param {Function} options.keyGenerator - Function to generate rate limit key from request
 * @param {boolean} options.skipSuccessfulRequests - Don't count successful requests
 * @returns {Function} - Express middleware
 */
function createRateLimiter(options = {}) {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 5,
    message = 'Too many requests, please try again later.',
    keyGenerator = (req) => req.ip,
    skipSuccessfulRequests = false
  } = options;

  return (req, res, next) => {
    const key = keyGenerator(req);
    const now = Date.now();

    // Get or create entry
    let entry = store.get(key);

    if (!entry || entry.resetTime < now) {
      // Create new entry
      entry = {
        count: 0,
        resetTime: now + windowMs
      };
      store.set(key, entry);
    }

    // Check if rate limited
    if (entry.count >= max) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);

      return res.status(429).json({
        success: false,
        error: 'RATE_LIMITED',
        message: message,
        retryAfter: retryAfter
      });
    }

    // Increment count
    entry.count++;

    // If skipSuccessfulRequests, decrement on successful response
    if (skipSuccessfulRequests) {
      const originalJson = res.json.bind(res);
      res.json = function(data) {
        if (res.statusCode < 400) {
          entry.count = Math.max(0, entry.count - 1);
        }
        return originalJson(data);
      };
    }

    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - entry.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetTime / 1000));

    next();
  };
}

/**
 * Rate limiter for login/magic-link requests
 * Limits by email address to prevent spam
 * 5 requests per 15 minutes per email
 */
const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: 'Too many login attempts. Please try again in 15 minutes.',
  keyGenerator: (req) => {
    // Use email if provided, otherwise fall back to IP
    const email = req.body?.email?.toLowerCase?.();
    return email ? `email:${email}` : `ip:${req.ip}`;
  }
});

/**
 * Rate limiter for access request submissions
 * Limits by IP address to prevent abuse
 * 3 requests per hour per IP
 */
const accessRequestRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: 'Too many access requests. Please try again later.',
  keyGenerator: (req) => `access:${req.ip}`
});

/**
 * Stricter rate limiter for token verification
 * Prevents brute force attacks on magic link tokens
 * 10 attempts per 5 minutes per IP
 */
const verifyRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10,
  message: 'Too many verification attempts. Please try again later.',
  keyGenerator: (req) => `verify:${req.ip}`
});

/**
 * General API rate limiter
 * 100 requests per minute per IP
 */
const generalRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  message: 'Too many requests. Please slow down.',
  keyGenerator: (req) => `general:${req.ip}`
});

module.exports = {
  createRateLimiter,
  loginRateLimiter,
  accessRequestRateLimiter,
  verifyRateLimiter,
  generalRateLimiter
};
