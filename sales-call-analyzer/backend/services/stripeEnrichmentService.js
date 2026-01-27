/**
 * Stripe Enrichment Service
 *
 * Enriches call data with Stripe customer/subscription status.
 *
 * MATCHING LOGIC (Priority Order):
 * ================================
 * 1. Email Exact Match: participant email -> Stripe customer email (highest confidence)
 * 2. Domain Fallback: participant email domain -> Stripe customer email domain (medium confidence)
 * 3. Name Fallback: participant name -> Stripe customer name (lower confidence)
 * 4. If no match: mark as "unmatched"
 *
 * MATCH CONFIDENCE:
 * =================
 * - 'email_exact': Direct email match (high reliability)
 * - 'email_domain': Same email domain match (medium reliability)
 * - 'name': Name-based match (low reliability, may have false positives)
 *
 * MULTI-CUSTOMER HANDLING:
 * ========================
 * When multiple customers share the same email, we prefer:
 * 1. Customer with active subscription
 * 2. Customer with trialing subscription
 * 3. Customer with past_due subscription
 * 4. Customer with canceled subscription
 * 5. Most recently created customer
 *
 * SUBSCRIPTION STATUS VALUES:
 * ===========================
 * - never_subscribed: Customer exists but never had a subscription
 * - trialing: Currently on trial
 * - active: Has active subscription
 * - past_due: Subscription payment failed
 * - canceled: Subscription was canceled
 * - unmatched: No matching customer found in Stripe
 *
 * DATES EXTRACTED:
 * ================
 * - signupDate: When customer was created in Stripe
 * - subscriptionStartDate: When subscription started
 * - cancelDate: When subscription was canceled (if applicable)
 */

const stripeClient = require('./stripeClient');

/**
 * Check if Stripe is configured
 */
function isConfigured() {
  return stripeClient.isConfigured();
}

/**
 * Get Stripe key mode (test/live)
 * @returns {'test'|'live'|'unknown'|null}
 */
function getKeyMode() {
  return stripeClient.getKeyMode();
}

/**
 * Find customer by email (exact match only)
 * Uses stripeClient with safe pagination and prefers active subscriptions
 * @param {string} email - Email to search for
 * @returns {Object|null} - Stripe customer or null
 */
async function findCustomerByEmail(email) {
  if (!email) return null;

  try {
    // Use the new stripeClient which handles multiple customers and prefers active subscriptions
    return await stripeClient.findCustomerByEmail(email);
  } catch (error) {
    console.error('[StripeEnrichment] Error finding customer:', error.message);
    return null;
  }
}

/**
 * Extract domain from email address
 * @param {string} email - Email address
 * @returns {string|null} - Domain part or null
 */
function extractDomain(email) {
  return stripeClient.extractDomain(email);
}

/**
 * Normalize email for consistent matching
 * @param {string} email - Email address
 * @returns {string} - Normalized email
 */
function normalizeEmail(email) {
  return stripeClient.normalizeEmail(email);
}

/**
 * Find customers by email domain
 * Uses stripeClient with safe pagination (no more 100 customer limit)
 * @param {string} domain - Domain to search for (e.g., 'company.com')
 * @returns {Array} - Array of matching Stripe customers
 */
async function findCustomersByDomain(domain) {
  if (!domain) return [];

  try {
    // Use the new stripeClient which uses Search API with safe pagination
    return await stripeClient.findCustomersByDomain(domain);
  } catch (error) {
    console.error('[StripeEnrichment] Error finding customers by domain:', error.message);
    return [];
  }
}

/**
 * Find customers by name (fuzzy match)
 * Uses stripeClient with safe pagination (no more 100 customer limit)
 * @param {string} name - Name to search for
 * @returns {Array} - Array of matching Stripe customers
 */
async function findCustomersByName(name) {
  if (!name || typeof name !== 'string') return [];

  const searchName = name.toLowerCase().trim();

  // Skip very short names or common words
  if (searchName.length < 3) return [];

  try {
    // Fetch customers with safe pagination
    const allCustomers = await stripeClient.fetchAllCustomers({ maxPages: 3 });

    const matches = allCustomers.filter(customer => {
      const customerName = customer.name?.toLowerCase() || '';
      // Check if customer name contains the search name or vice versa
      return customerName.includes(searchName) || searchName.includes(customerName);
    });

    return matches;
  } catch (error) {
    console.error('[StripeEnrichment] Error finding customers by name:', error.message);
    return [];
  }
}

/**
 * Get all subscriptions for a customer (including canceled)
 * Uses stripeClient with retry/backoff
 * @param {string} customerId - Stripe customer ID
 * @returns {Array} - Array of subscriptions
 */
async function getCustomerSubscriptions(customerId) {
  if (!customerId) return [];

  try {
    return await stripeClient.getCustomerSubscriptions(customerId);
  } catch (error) {
    console.error('[StripeEnrichment] Error getting subscriptions:', error.message);
    return [];
  }
}

/**
 * Determine subscription status from subscriptions array
 * Priority: active > trialing > past_due > canceled > never_subscribed
 * @param {Array} subscriptions - Array of Stripe subscriptions
 * @returns {Object} - Status details
 */
function determineSubscriptionStatus(subscriptions) {
  if (!subscriptions || subscriptions.length === 0) {
    return {
      status: 'never_subscribed',
      subscriptionStartDate: null,
      cancelDate: null,
      currentPlan: null,
      mrr: 0
    };
  }

  // Sort by created date descending to get most recent first
  const sorted = [...subscriptions].sort((a, b) => b.created - a.created);

  // Find by priority
  const active = sorted.find(s => s.status === 'active');
  const trialing = sorted.find(s => s.status === 'trialing');
  const pastDue = sorted.find(s => s.status === 'past_due');
  const canceled = sorted.find(s => s.status === 'canceled');

  let status, relevantSub;

  if (active) {
    status = 'active';
    relevantSub = active;
  } else if (trialing) {
    status = 'trialing';
    relevantSub = trialing;
  } else if (pastDue) {
    status = 'past_due';
    relevantSub = pastDue;
  } else if (canceled) {
    status = 'canceled';
    relevantSub = canceled;
  } else {
    // Has subscriptions but none in expected states
    status = 'unknown';
    relevantSub = sorted[0];
  }

  // Extract dates
  const subscriptionStartDate = relevantSub?.start_date
    ? new Date(relevantSub.start_date * 1000).toISOString()
    : (relevantSub?.created ? new Date(relevantSub.created * 1000).toISOString() : null);

  const cancelDate = (status === 'canceled' && relevantSub?.canceled_at)
    ? new Date(relevantSub.canceled_at * 1000).toISOString()
    : null;

  // Get plan info
  const priceInfo = relevantSub?.items?.data?.[0]?.price;
  const currentPlan = priceInfo?.nickname || priceInfo?.id || null;
  const mrr = priceInfo?.unit_amount ? priceInfo.unit_amount / 100 : 0;

  return {
    status,
    subscriptionStartDate,
    cancelDate,
    currentPlan,
    mrr,
    subscriptionId: relevantSub?.id || null
  };
}

/**
 * Get enrichment data for an email
 * @param {string} email - Email to look up
 * @returns {Object} - Enrichment data
 */
async function getEnrichmentByEmail(email) {
  if (!email) {
    return {
      matched: false,
      status: 'unmatched',
      reason: 'No email provided'
    };
  }

  const customer = await findCustomerByEmail(email);

  if (!customer) {
    return {
      matched: false,
      status: 'unmatched',
      email: email,
      reason: 'No matching customer in Stripe'
    };
  }

  const subscriptions = await getCustomerSubscriptions(customer.id);
  const subStatus = determineSubscriptionStatus(subscriptions);

  return {
    matched: true,
    email: customer.email,
    customerId: customer.id,
    customerName: customer.name || null,
    signupDate: new Date(customer.created * 1000).toISOString(),
    status: subStatus.status,
    subscriptionStartDate: subStatus.subscriptionStartDate,
    cancelDate: subStatus.cancelDate,
    currentPlan: subStatus.currentPlan,
    mrr: subStatus.mrr,
    totalSubscriptions: subscriptions.length
  };
}

/**
 * Build enrichment result from customer and match method
 * @param {Object} customer - Stripe customer object
 * @param {string} matchMethod - How the customer was matched ('email_exact', 'email_domain', 'name')
 * @param {Object} additionalInfo - Extra info about the match
 * @returns {Object} - Enrichment result
 */
async function buildEnrichmentFromCustomer(customer, matchMethod, additionalInfo = {}) {
  const subscriptions = await getCustomerSubscriptions(customer.id);
  const subStatus = determineSubscriptionStatus(subscriptions);

  return {
    matched: true,
    matchMethod,
    matchConfidence: matchMethod === 'email_exact' ? 'high' :
                     matchMethod === 'email_domain' ? 'medium' : 'low',
    email: customer.email,
    customerId: customer.id,
    customerName: customer.name || null,
    signupDate: new Date(customer.created * 1000).toISOString(),
    status: subStatus.status,
    subscriptionStartDate: subStatus.subscriptionStartDate,
    cancelDate: subStatus.cancelDate,
    currentPlan: subStatus.currentPlan,
    mrr: subStatus.mrr,
    totalSubscriptions: subscriptions.length,
    ...additionalInfo
  };
}

/**
 * Enrich a call/transcript with Stripe data
 * Uses cascading match strategy: email exact -> domain fallback -> name fallback
 * @param {Object} transcript - Transcript object with participants
 * @returns {Object} - Enrichment result
 */
async function enrichCall(transcript) {
  if (!isConfigured()) {
    return {
      enriched: false,
      reason: 'Stripe not configured'
    };
  }

  // Extract participant info
  const participantEmails = extractEmails(transcript);
  const participantNames = extractNames(transcript);
  const triedMethods = [];

  // ========================================
  // STEP 1: Try exact email match (highest priority)
  // ========================================
  if (participantEmails.length > 0) {
    triedMethods.push('email_exact');
    for (const email of participantEmails) {
      const customer = await findCustomerByEmail(email);
      if (customer) {
        const result = await buildEnrichmentFromCustomer(customer, 'email_exact', {
          matchedEmail: email
        });
        return {
          enriched: true,
          ...result
        };
      }
    }
  }

  // ========================================
  // STEP 2: Try domain fallback
  // ========================================
  if (participantEmails.length > 0) {
    triedMethods.push('email_domain');
    const triedDomains = new Set();

    for (const email of participantEmails) {
      const domain = extractDomain(email);
      if (!domain || triedDomains.has(domain)) continue;
      triedDomains.add(domain);

      const domainMatches = await findCustomersByDomain(domain);
      if (domainMatches.length > 0) {
        // Use selectBestCustomer to prefer customer with active subscription
        const customer = await stripeClient.selectBestCustomer(domainMatches);
        const result = await buildEnrichmentFromCustomer(customer, 'email_domain', {
          matchedDomain: domain,
          originalEmail: email,
          multipleMatches: domainMatches.length > 1,
          matchCount: domainMatches.length
        });
        return {
          enriched: true,
          ...result
        };
      }
    }
  }

  // ========================================
  // STEP 3: Try name fallback (lowest priority)
  // ========================================
  if (participantNames.length > 0) {
    triedMethods.push('name');
    for (const name of participantNames) {
      const nameMatches = await findCustomersByName(name);
      if (nameMatches.length > 0) {
        // Use selectBestCustomer to prefer customer with active subscription
        const customer = await stripeClient.selectBestCustomer(nameMatches);
        const result = await buildEnrichmentFromCustomer(customer, 'name', {
          matchedName: name,
          multipleMatches: nameMatches.length > 1,
          matchCount: nameMatches.length
        });
        return {
          enriched: true,
          ...result
        };
      }
    }
  }

  // ========================================
  // No match found by any method
  // ========================================
  return {
    enriched: true,
    matched: false,
    status: 'unmatched',
    triedEmails: participantEmails,
    triedNames: participantNames,
    triedMethods,
    reason: participantEmails.length === 0 && participantNames.length === 0
      ? 'No participant emails or names available'
      : 'No match found via email, domain, or name'
  };
}

/**
 * Extract emails from transcript/call data
 * @param {Object} transcript - Transcript object
 * @returns {Array} - Array of email strings
 */
function extractEmails(transcript) {
  const emails = new Set();

  // From participants array
  if (Array.isArray(transcript.participants)) {
    for (const p of transcript.participants) {
      if (typeof p === 'string' && p.includes('@')) {
        emails.add(p.toLowerCase().trim());
      } else if (p && typeof p === 'object' && p.email) {
        emails.add(p.email.toLowerCase().trim());
      }
    }
  }

  // From participants JSON string
  if (typeof transcript.participants === 'string') {
    try {
      const parsed = JSON.parse(transcript.participants);
      if (Array.isArray(parsed)) {
        for (const p of parsed) {
          if (typeof p === 'string' && p.includes('@')) {
            emails.add(p.toLowerCase().trim());
          } else if (p && typeof p === 'object' && p.email) {
            emails.add(p.email.toLowerCase().trim());
          }
        }
      }
    } catch (e) {
      // Not JSON, ignore
    }
  }

  // Exclude sales rep emails
  // Known domains to exclude (internal team domains)
  const salesRepDomains = ['affiliatefinder.io', 'affiliatefinder.ai', 'kniroo.com'];
  // Known exact sales rep emails
  // Jamie I.F. uses jamie@increasing.com
  // Phil uses phil@affiliatefinder.ai
  const salesRepExactEmails = [
    'phil@affiliatefinder.ai',
    'phil@affiliatefinder.io',
    'phil@kniroo.com',
    'jamie@increasing.com',
    'jamie@affiliatefinder.io',
    'jamie@kniroo.com'
  ];

  const filtered = Array.from(emails).filter(email => {
    // Exclude exact sales rep emails
    if (salesRepExactEmails.includes(email)) {
      return false;
    }
    // Exclude internal domains (affiliatefinder, kniroo)
    const domain = email.split('@')[1];
    if (salesRepDomains.includes(domain)) {
      return false;
    }
    return true;
  });

  return filtered;
}

/**
 * Extract names from transcript/call data
 * @param {Object} transcript - Transcript object
 * @returns {Array} - Array of name strings (excluding sales reps)
 */
function extractNames(transcript) {
  const names = new Set();

  // Helper to add a name if valid (minimum 3 chars to avoid initials/short strings)
  const addName = (name) => {
    if (!name || typeof name !== 'string') return;
    const trimmed = name.trim();
    if (trimmed.length >= 3) {
      names.add(trimmed);
    }
  };

  // From participants array
  if (Array.isArray(transcript.participants)) {
    for (const p of transcript.participants) {
      if (typeof p === 'string' && !p.includes('@')) {
        addName(p);
      } else if (p && typeof p === 'object') {
        if (p.name) addName(p.name);
        if (p.displayName) addName(p.displayName);
      }
    }
  }

  // From participants JSON string
  if (typeof transcript.participants === 'string') {
    try {
      const parsed = JSON.parse(transcript.participants);
      if (Array.isArray(parsed)) {
        for (const p of parsed) {
          if (typeof p === 'string' && !p.includes('@')) {
            addName(p);
          } else if (p && typeof p === 'object') {
            if (p.name) addName(p.name);
            if (p.displayName) addName(p.displayName);
          }
        }
      }
    } catch (e) {
      // Not JSON, ignore
    }
  }

  // Also check call_title for prospect names (often contains "Call with {Name}")
  if (transcript.call_title) {
    const titleMatch = transcript.call_title.match(/(?:call with|meeting with|demo with)\s+(.+)/i);
    if (titleMatch && titleMatch[1]) {
      addName(titleMatch[1].split(/[-–—]/)[0].trim()); // Take first part before any dash
    }
  }

  // Exclude sales rep names
  const salesRepNames = ['phil', 'jamie', 'phil norris', 'jamie if'];

  const filtered = Array.from(names).filter(name => {
    const lowerName = name.toLowerCase();
    return !salesRepNames.some(rep => lowerName.includes(rep));
  });

  return filtered;
}

/**
 * Get conversion metrics for dashboard
 * Analyzes all calls with Stripe data to calculate conversion rates
 * @param {Array} transcriptsWithStripe - Array of transcripts with stripe_data
 * @returns {Object} - Conversion metrics
 */
function calculateConversionMetrics(transcriptsWithStripe) {
  const metrics = {
    totalCalls: transcriptsWithStripe.length,
    matchedCalls: 0,
    unmatchedCalls: 0,

    // Status breakdown
    neverSubscribed: 0,
    trialing: 0,
    active: 0,
    pastDue: 0,
    canceled: 0,

    // Conversion metrics
    signupCount: 0,
    churnCount: 0,
    conversionRate: 0,
    churnRate: 0,

    // Revenue
    totalMRR: 0
  };

  for (const t of transcriptsWithStripe) {
    const stripeData = t.stripeData || t.stripe_data;

    if (!stripeData || !stripeData.matched) {
      metrics.unmatchedCalls++;
      continue;
    }

    metrics.matchedCalls++;

    // Count by status
    switch (stripeData.status) {
      case 'never_subscribed':
        metrics.neverSubscribed++;
        break;
      case 'trialing':
        metrics.trialing++;
        metrics.signupCount++;
        break;
      case 'active':
        metrics.active++;
        metrics.signupCount++;
        metrics.totalMRR += stripeData.mrr || 0;
        break;
      case 'past_due':
        metrics.pastDue++;
        metrics.signupCount++;
        break;
      case 'canceled':
        metrics.canceled++;
        metrics.signupCount++;
        metrics.churnCount++;
        break;
    }
  }

  // Calculate rates
  if (metrics.matchedCalls > 0) {
    metrics.conversionRate = Math.round((metrics.signupCount / metrics.matchedCalls) * 100);
  }

  if (metrics.signupCount > 0) {
    metrics.churnRate = Math.round((metrics.churnCount / metrics.signupCount) * 100);
  }

  return metrics;
}

/**
 * Batch enrich multiple calls
 * @param {Array} transcripts - Array of transcript objects
 * @returns {Array} - Array of enrichment results
 */
async function batchEnrich(transcripts) {
  const results = [];

  for (const transcript of transcripts) {
    try {
      const enrichment = await enrichCall(transcript);
      results.push({
        id: transcript.id,
        ...enrichment
      });
    } catch (error) {
      console.error(`[StripeEnrichment] Error enriching ${transcript.id}:`, error.message);
      results.push({
        id: transcript.id,
        enriched: false,
        error: error.message
      });
    }
  }

  return results;
}

/**
 * Test Stripe connection
 * @returns {Promise<Object>} - Test result { valid, mode, error }
 */
async function testConnection() {
  return stripeClient.testConnection();
}

/**
 * Test Stripe connection with optional email verification
 * @param {string} testEmail - Optional email to verify lookup works
 * @returns {Promise<Object>} - Extended test result
 */
async function testConnectionWithEmail(testEmail = null) {
  return stripeClient.testConnectionWithEmail(testEmail);
}

module.exports = {
  isConfigured,
  getKeyMode,
  findCustomerByEmail,
  findCustomersByDomain,
  findCustomersByName,
  getCustomerSubscriptions,
  determineSubscriptionStatus,
  getEnrichmentByEmail,
  enrichCall,
  extractEmails,
  extractNames,
  extractDomain,
  normalizeEmail,
  calculateConversionMetrics,
  batchEnrich,
  testConnection,
  testConnectionWithEmail
};
