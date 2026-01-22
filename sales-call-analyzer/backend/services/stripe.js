/**
 * Stripe Integration Service
 * Verifies customer subscription status (active/churned)
 */

const STRIPE_API_KEY = process.env.STRIPE_API_KEY;
const STRIPE_API_BASE = 'https://api.stripe.com/v1';

/**
 * Make a Stripe API request
 */
async function stripeRequest(endpoint, method = 'GET', params = {}) {
  if (!STRIPE_API_KEY) {
    throw new Error('STRIPE_API_KEY not configured');
  }

  const url = new URL(`${STRIPE_API_BASE}/${endpoint}`);

  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${STRIPE_API_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  };

  if (method === 'GET' && Object.keys(params).length > 0) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value);
      }
    });
  } else if (method === 'POST') {
    options.body = new URLSearchParams(params).toString();
  }

  const response = await fetch(url.toString(), options);
  const data = await response.json();

  if (data.error) {
    throw new Error(`Stripe API error: ${data.error.message}`);
  }

  return data;
}

/**
 * Search for a customer by email
 */
async function findCustomerByEmail(email) {
  if (!email) return null;

  try {
    const result = await stripeRequest('customers', 'GET', {
      email: email.toLowerCase(),
      limit: 1
    });

    return result.data?.[0] || null;
  } catch (error) {
    console.error('Error finding customer by email:', error.message);
    return null;
  }
}

/**
 * Search for customers by name (partial match)
 */
async function findCustomersByName(name) {
  if (!name) return [];

  try {
    // Stripe doesn't support name search directly, so we fetch recent customers
    // and filter. For production, you might want to use a database or search index.
    const result = await stripeRequest('customers', 'GET', {
      limit: 100
    });

    const searchName = name.toLowerCase();
    const matches = (result.data || []).filter(customer => {
      const customerName = customer.name?.toLowerCase() || '';
      const customerEmail = customer.email?.toLowerCase() || '';
      return customerName.includes(searchName) || customerEmail.includes(searchName);
    });

    return matches;
  } catch (error) {
    console.error('Error finding customers by name:', error.message);
    return [];
  }
}

/**
 * Get customer's subscriptions
 */
async function getCustomerSubscriptions(customerId) {
  if (!customerId) return [];

  try {
    const result = await stripeRequest('subscriptions', 'GET', {
      customer: customerId,
      limit: 10,
      status: 'all'
    });

    return result.data || [];
  } catch (error) {
    console.error('Error getting subscriptions:', error.message);
    return [];
  }
}

/**
 * Get customer's recent payments/charges
 */
async function getCustomerCharges(customerId, limit = 10) {
  if (!customerId) return [];

  try {
    const result = await stripeRequest('charges', 'GET', {
      customer: customerId,
      limit
    });

    return result.data || [];
  } catch (error) {
    console.error('Error getting charges:', error.message);
    return [];
  }
}

/**
 * Get customer's invoices
 */
async function getCustomerInvoices(customerId, limit = 10) {
  if (!customerId) return [];

  try {
    const result = await stripeRequest('invoices', 'GET', {
      customer: customerId,
      limit
    });

    return result.data || [];
  } catch (error) {
    console.error('Error getting invoices:', error.message);
    return [];
  }
}

/**
 * Determine customer status from Stripe data
 */
function determineCustomerStatus(customer, subscriptions, charges) {
  if (!customer) {
    return {
      found: false,
      status: 'not_found'
    };
  }

  // Check subscriptions
  const activeSubscription = subscriptions.find(sub =>
    ['active', 'trialing'].includes(sub.status)
  );

  const canceledSubscription = subscriptions.find(sub =>
    sub.status === 'canceled'
  );

  const pastDueSubscription = subscriptions.find(sub =>
    sub.status === 'past_due'
  );

  // Determine status
  let status = 'unknown';
  let plan = null;
  let mrr = 0;

  if (activeSubscription) {
    status = 'active';
    plan = activeSubscription.items?.data?.[0]?.price?.nickname ||
           activeSubscription.items?.data?.[0]?.price?.product ||
           'Unknown Plan';
    mrr = (activeSubscription.items?.data?.[0]?.price?.unit_amount || 0) / 100;
  } else if (pastDueSubscription) {
    status = 'past_due';
    plan = pastDueSubscription.items?.data?.[0]?.price?.nickname;
  } else if (canceledSubscription) {
    status = 'churned';
    plan = canceledSubscription.items?.data?.[0]?.price?.nickname;
  } else if (charges.length > 0) {
    // Has charges but no subscription - might be a one-time purchase
    status = 'one_time_purchase';
  }

  // Get last payment date
  const lastCharge = charges.find(c => c.status === 'succeeded');
  const lastPaymentDate = lastCharge ? new Date(lastCharge.created * 1000) : null;

  // Calculate lifetime value
  const ltv = charges
    .filter(c => c.status === 'succeeded')
    .reduce((sum, c) => sum + (c.amount / 100), 0);

  return {
    found: true,
    customerId: customer.id,
    email: customer.email,
    name: customer.name,
    status,
    isActive: status === 'active' || status === 'trialing',
    isChurned: status === 'churned',
    isPastDue: status === 'past_due',
    plan,
    mrr,
    ltv,
    lastPaymentDate: lastPaymentDate?.toISOString() || null,
    subscriptionCount: subscriptions.length,
    chargeCount: charges.length,
    createdAt: new Date(customer.created * 1000).toISOString()
  };
}

/**
 * Get full customer status by email
 */
async function getCustomerStatusByEmail(email) {
  const customer = await findCustomerByEmail(email);

  if (!customer) {
    return { found: false, status: 'not_found' };
  }

  const [subscriptions, charges] = await Promise.all([
    getCustomerSubscriptions(customer.id),
    getCustomerCharges(customer.id)
  ]);

  return determineCustomerStatus(customer, subscriptions, charges);
}

/**
 * Get full customer status by name
 */
async function getCustomerStatusByName(name) {
  const customers = await findCustomersByName(name);

  if (customers.length === 0) {
    return { found: false, status: 'not_found' };
  }

  // If multiple matches, return the first one but note there are more
  const customer = customers[0];

  const [subscriptions, charges] = await Promise.all([
    getCustomerSubscriptions(customer.id),
    getCustomerCharges(customer.id)
  ]);

  const status = determineCustomerStatus(customer, subscriptions, charges);
  status.multipleMatches = customers.length > 1;
  status.matchCount = customers.length;

  return status;
}

/**
 * Get customer status by any identifier (email, name, or company)
 */
async function getCustomerStatus(email, name, company) {
  // Try email first (most accurate)
  if (email) {
    const result = await getCustomerStatusByEmail(email);
    if (result.found) {
      result.matchedBy = 'email';
      return result;
    }
  }

  // Try name
  if (name) {
    const result = await getCustomerStatusByName(name);
    if (result.found) {
      result.matchedBy = 'name';
      return result;
    }
  }

  // Try company name
  if (company) {
    const result = await getCustomerStatusByName(company);
    if (result.found) {
      result.matchedBy = 'company';
      return result;
    }
  }

  return { found: false, status: 'not_found' };
}

/**
 * Check if Stripe is configured
 */
function isStripeConfigured() {
  return !!STRIPE_API_KEY;
}

/**
 * Get subscription stats summary
 */
async function getSubscriptionStats() {
  try {
    const [activeResult, canceledResult, trialingResult] = await Promise.all([
      stripeRequest('subscriptions', 'GET', { status: 'active', limit: 1 }),
      stripeRequest('subscriptions', 'GET', { status: 'canceled', limit: 1 }),
      stripeRequest('subscriptions', 'GET', { status: 'trialing', limit: 1 })
    ]);

    // Note: This gives us counts via has_more, but for accurate counts
    // you'd need to paginate through all or use Stripe's reporting API
    return {
      hasActiveSubscriptions: (activeResult.data?.length || 0) > 0,
      hasCanceledSubscriptions: (canceledResult.data?.length || 0) > 0,
      hasTrialingSubscriptions: (trialingResult.data?.length || 0) > 0
    };
  } catch (error) {
    console.error('Error getting subscription stats:', error.message);
    return null;
  }
}

module.exports = {
  findCustomerByEmail,
  findCustomersByName,
  getCustomerSubscriptions,
  getCustomerCharges,
  getCustomerInvoices,
  getCustomerStatusByEmail,
  getCustomerStatusByName,
  getCustomerStatus,
  isStripeConfigured,
  getSubscriptionStats
};
