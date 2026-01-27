/**
 * Stripe Client Wrapper
 *
 * Provides safe Stripe API access with:
 * - Safe pagination (auto-paging without limit)
 * - Rate limiting with exponential backoff
 * - Retry logic for transient failures
 * - Email normalization and matching utilities
 *
 * IMPORTANT: This module never logs or exposes API keys.
 */

const secretManager = require('./secretManager');

// Rate limiting configuration
const RATE_LIMIT_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2
};

// Stripe API base URL
const STRIPE_API_BASE = 'https://api.stripe.com/v1';

/**
 * Sleep for a given number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 * @param {number} attempt - Current attempt number (0-based)
 * @returns {number} - Delay in milliseconds
 */
function calculateBackoffDelay(attempt) {
  const delay = RATE_LIMIT_CONFIG.initialDelayMs * Math.pow(RATE_LIMIT_CONFIG.backoffMultiplier, attempt);
  // Add jitter (±20%)
  const jitter = delay * 0.2 * (Math.random() * 2 - 1);
  return Math.min(delay + jitter, RATE_LIMIT_CONFIG.maxDelayMs);
}

/**
 * Get the Stripe API key from secret manager
 * @returns {string|null} - API key or null if not configured
 */
function getApiKey() {
  return secretManager.getSecret('STRIPE_API_KEY');
}

/**
 * Check if Stripe is configured
 * @returns {boolean}
 */
function isConfigured() {
  return secretManager.isConfigured('STRIPE_API_KEY');
}

/**
 * Detect if the configured key is test mode or live mode
 * @returns {'test'|'live'|'unknown'|null}
 */
function getKeyMode() {
  const key = getApiKey();
  if (!key) return null;
  if (key.startsWith('sk_test_')) return 'test';
  if (key.startsWith('sk_live_')) return 'live';
  return 'unknown';
}

/**
 * Make a Stripe API request with retry logic
 * @param {string} endpoint - API endpoint (e.g., 'customers', 'subscriptions')
 * @param {Object} params - Query parameters
 * @param {Object} options - Request options
 * @returns {Promise<Object>} - API response data
 */
async function stripeRequest(endpoint, params = {}, options = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('STRIPE_API_KEY not configured');
  }

  const url = new URL(`${STRIPE_API_BASE}/${endpoint}`);

  // Add query parameters
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, value);
    }
  });

  let lastError;

  for (let attempt = 0; attempt <= RATE_LIMIT_CONFIG.maxRetries; attempt++) {
    try {
      const response = await fetch(url.toString(), {
        method: options.method || 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      // Handle rate limiting (429)
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const delayMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : calculateBackoffDelay(attempt);

        console.warn(`[StripeClient] Rate limited. Retrying after ${delayMs}ms (attempt ${attempt + 1}/${RATE_LIMIT_CONFIG.maxRetries + 1})`);

        if (attempt < RATE_LIMIT_CONFIG.maxRetries) {
          await sleep(delayMs);
          continue;
        }
        throw new Error('Rate limit exceeded after maximum retries');
      }

      // Handle server errors (5xx) with retry
      if (response.status >= 500 && attempt < RATE_LIMIT_CONFIG.maxRetries) {
        const delayMs = calculateBackoffDelay(attempt);
        console.warn(`[StripeClient] Server error ${response.status}. Retrying after ${delayMs}ms`);
        await sleep(delayMs);
        continue;
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(`Stripe API error: ${data.error.message}`);
      }

      return data;
    } catch (error) {
      lastError = error;

      // Retry on network errors
      if (error.name === 'TypeError' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
        if (attempt < RATE_LIMIT_CONFIG.maxRetries) {
          const delayMs = calculateBackoffDelay(attempt);
          console.warn(`[StripeClient] Network error: ${error.message}. Retrying after ${delayMs}ms`);
          await sleep(delayMs);
          continue;
        }
      }

      throw error;
    }
  }

  throw lastError || new Error('Request failed after maximum retries');
}

/**
 * Fetch all customers with safe pagination
 * Uses Stripe's starting_after parameter to paginate through all results
 *
 * @param {Object} options - Fetch options
 * @param {string} options.email - Optional: Filter by email
 * @param {number} options.limit - Page size (default: 100, max: 100)
 * @param {number} options.maxPages - Maximum pages to fetch (default: 10 = 1000 customers)
 * @returns {Promise<Array>} - Array of customer objects
 */
async function fetchAllCustomers(options = {}) {
  const { email, limit = 100, maxPages = 10 } = options;
  const allCustomers = [];
  let hasMore = true;
  let startingAfter = null;
  let pageCount = 0;

  while (hasMore && pageCount < maxPages) {
    const params = {
      limit: Math.min(limit, 100) // Stripe max is 100
    };

    if (email) {
      params.email = email.toLowerCase().trim();
    }

    if (startingAfter) {
      params.starting_after = startingAfter;
    }

    const response = await stripeRequest('customers', params);

    if (response.data && response.data.length > 0) {
      allCustomers.push(...response.data);
      startingAfter = response.data[response.data.length - 1].id;
    }

    hasMore = response.has_more === true;
    pageCount++;
  }

  if (hasMore) {
    console.warn(`[StripeClient] Reached max pages (${maxPages}). Some customers may not be fetched.`);
  }

  return allCustomers;
}

/**
 * Search customers using Stripe Search API
 * More efficient than fetching all customers for specific queries
 *
 * @param {string} query - Stripe Search query (e.g., 'email:"john@example.com"')
 * @param {Object} options - Search options
 * @param {number} options.limit - Results per page (default: 100, max: 100)
 * @param {number} options.maxPages - Maximum pages to fetch (default: 5)
 * @returns {Promise<Array>} - Array of customer objects
 */
async function searchCustomers(query, options = {}) {
  const { limit = 100, maxPages = 5 } = options;
  const allCustomers = [];
  let hasMore = true;
  let nextPage = null;
  let pageCount = 0;

  while (hasMore && pageCount < maxPages) {
    const params = {
      query,
      limit: Math.min(limit, 100)
    };

    if (nextPage) {
      params.page = nextPage;
    }

    const response = await stripeRequest('customers/search', params);

    if (response.data && response.data.length > 0) {
      allCustomers.push(...response.data);
    }

    hasMore = response.has_more === true;
    nextPage = response.next_page || null;
    pageCount++;
  }

  return allCustomers;
}

/**
 * Find customer by exact email match
 * Uses Stripe Search API for efficiency
 *
 * @param {string} email - Email to search for
 * @returns {Promise<Object|null>} - Customer object or null
 */
async function findCustomerByEmail(email) {
  if (!email) return null;

  const normalizedEmail = normalizeEmail(email);

  try {
    // Use Search API for exact email match
    const query = `email:"${normalizedEmail}"`;
    const customers = await searchCustomers(query, { limit: 10 });

    if (customers.length === 0) {
      return null;
    }

    // If multiple customers with same email, prefer one with active subscription
    if (customers.length === 1) {
      return customers[0];
    }

    // Get subscriptions for all matching customers to find the best match
    return await selectBestCustomer(customers);
  } catch (error) {
    // Fallback to list API if Search API fails (e.g., older Stripe accounts)
    console.warn('[StripeClient] Search API failed, falling back to list:', error.message);
    const response = await stripeRequest('customers', {
      email: normalizedEmail,
      limit: 10
    });

    if (!response.data || response.data.length === 0) {
      return null;
    }

    if (response.data.length === 1) {
      return response.data[0];
    }

    return await selectBestCustomer(response.data);
  }
}

/**
 * Select the best customer from multiple matches
 * Priority: active subscription > trialing > most recent
 *
 * @param {Array} customers - Array of customer objects
 * @returns {Promise<Object>} - Best matching customer
 */
async function selectBestCustomer(customers) {
  if (!customers || customers.length === 0) {
    return null;
  }

  if (customers.length === 1) {
    return customers[0];
  }

  // Get subscriptions for all customers
  const customerWithSubs = await Promise.all(
    customers.map(async (customer) => {
      const subs = await getCustomerSubscriptions(customer.id);
      return { customer, subscriptions: subs };
    })
  );

  // Prioritize: active > trialing > past_due > canceled > newest
  const withActive = customerWithSubs.find(c =>
    c.subscriptions.some(s => s.status === 'active')
  );
  if (withActive) return withActive.customer;

  const withTrialing = customerWithSubs.find(c =>
    c.subscriptions.some(s => s.status === 'trialing')
  );
  if (withTrialing) return withTrialing.customer;

  const withPastDue = customerWithSubs.find(c =>
    c.subscriptions.some(s => s.status === 'past_due')
  );
  if (withPastDue) return withPastDue.customer;

  const withCanceled = customerWithSubs.find(c =>
    c.subscriptions.some(s => s.status === 'canceled')
  );
  if (withCanceled) return withCanceled.customer;

  // Fall back to newest customer
  return [...customers].sort((a, b) => b.created - a.created)[0];
}

/**
 * Find customers by email domain
 * Fetches customers and filters by domain match
 *
 * @param {string} domain - Domain to search for (e.g., 'company.com')
 * @param {Object} options - Search options
 * @returns {Promise<Array>} - Array of matching customers
 */
async function findCustomersByDomain(domain, options = {}) {
  if (!domain) return [];

  const normalizedDomain = domain.toLowerCase().trim();

  // Skip common email providers - too many false positives
  const commonProviders = [
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
    'aol.com', 'protonmail.com', 'mail.com', 'gmx.com', 'zoho.com',
    'live.com', 'msn.com', 'ymail.com', 'googlemail.com', 'me.com'
  ];

  if (commonProviders.includes(normalizedDomain)) {
    return [];
  }

  try {
    // Use Search API with email domain filter
    const query = `email~"@${normalizedDomain}"`;
    const customers = await searchCustomers(query, { limit: 100, maxPages: 3 });

    // Double-check domain match (Search API may return partial matches)
    return customers.filter(c => {
      if (!c.email) return false;
      const customerDomain = extractDomain(c.email);
      return customerDomain === normalizedDomain;
    });
  } catch (error) {
    // Fallback to fetching recent customers if Search API fails
    console.warn('[StripeClient] Domain search failed, falling back to pagination:', error.message);

    const allCustomers = await fetchAllCustomers({ maxPages: 3 });
    return allCustomers.filter(c => {
      if (!c.email) return false;
      const customerDomain = extractDomain(c.email);
      return customerDomain === normalizedDomain;
    });
  }
}

/**
 * Get all subscriptions for a customer (including canceled)
 *
 * @param {string} customerId - Stripe customer ID
 * @returns {Promise<Array>} - Array of subscription objects
 */
async function getCustomerSubscriptions(customerId) {
  if (!customerId) return [];

  try {
    const response = await stripeRequest('subscriptions', {
      customer: customerId,
      status: 'all',
      limit: 100
    });

    return response.data || [];
  } catch (error) {
    console.error('[StripeClient] Error getting subscriptions:', error.message);
    return [];
  }
}

/**
 * Normalize email address for consistent matching
 * - Lowercase
 * - Trim whitespace
 * - Remove dots from gmail local part (optional)
 *
 * @param {string} email - Email address
 * @returns {string} - Normalized email
 */
function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return '';
  return email.toLowerCase().trim();
}

/**
 * Extract domain from email address
 *
 * @param {string} email - Email address
 * @returns {string|null} - Domain part or null
 */
function extractDomain(email) {
  if (!email || typeof email !== 'string') return null;
  const parts = email.toLowerCase().trim().split('@');
  if (parts.length !== 2) return null;
  return parts[1];
}

/**
 * Test Stripe connection by fetching balance
 * This is a lightweight endpoint that validates the API key
 *
 * @returns {Promise<Object>} - Test result { valid, mode, error }
 */
async function testConnection() {
  try {
    if (!isConfigured()) {
      return { valid: false, error: 'Stripe API key not configured' };
    }

    const response = await stripeRequest('balance');

    return {
      valid: true,
      mode: getKeyMode(),
      livemode: response.livemode
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message,
      mode: getKeyMode()
    };
  }
}

/**
 * Test connection and optionally verify a test email
 *
 * @param {string} testEmail - Optional email to verify lookup works
 * @returns {Promise<Object>} - Extended test result
 */
async function testConnectionWithEmail(testEmail = null) {
  const baseResult = await testConnection();

  if (!baseResult.valid || !testEmail) {
    return baseResult;
  }

  try {
    const customer = await findCustomerByEmail(testEmail);

    return {
      ...baseResult,
      testEmail: {
        searched: testEmail,
        found: !!customer,
        customerId: customer?.id || null,
        customerName: customer?.name || null,
        customerEmail: customer?.email || null
      }
    };
  } catch (error) {
    return {
      ...baseResult,
      testEmail: {
        searched: testEmail,
        found: false,
        error: error.message
      }
    };
  }
}

module.exports = {
  // Configuration
  isConfigured,
  getKeyMode,

  // Core API functions
  stripeRequest,
  fetchAllCustomers,
  searchCustomers,

  // Customer lookup
  findCustomerByEmail,
  findCustomersByDomain,
  selectBestCustomer,

  // Subscriptions
  getCustomerSubscriptions,

  // Utilities
  normalizeEmail,
  extractDomain,

  // Testing
  testConnection,
  testConnectionWithEmail,

  // Constants (for testing)
  RATE_LIMIT_CONFIG
};
