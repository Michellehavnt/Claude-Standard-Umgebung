/**
 * MRR Snapshot Service
 *
 * Captures and retrieves Monthly Recurring Revenue snapshots from Stripe.
 * Auto-detects currency and handles USD natively.
 *
 * Features:
 * - Fetches all active subscriptions from Stripe
 * - Only counts monthly subscriptions (not yearly) for MRR
 * - Only counts subscriptions with at least one paid invoice
 * - Excludes subscriptions scheduled to cancel (churn)
 * - Auto-detects currency (typically USD)
 * - Stores snapshots for historical tracking
 * - Provides growth calculations (vs previous week/4 weeks ago)
 *
 * Note: MRR values may differ slightly from Stripe Billing Overview due to
 * differences in calculation methodology (e.g., handling of trials, prorations).
 */

const stripeClient = require('./stripeClient');
const dbAdapter = require('./dbAdapter');

// Exchange rate API (free tier)
const EXCHANGE_RATE_API = 'https://api.exchangerate-api.com/v4/latest/GBP';

/**
 * Fetch current GBP to USD exchange rate
 * @returns {Promise<{rate: number, timestamp: string}>}
 */
async function getExchangeRate() {
  try {
    const response = await fetch(EXCHANGE_RATE_API);
    if (!response.ok) {
      throw new Error(`Exchange rate API error: ${response.status}`);
    }
    const data = await response.json();
    return {
      rate: data.rates.USD,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('[MrrSnapshot] Error fetching exchange rate:', error.message);
    // Fallback to approximate rate if API fails
    return {
      rate: 1.27,
      timestamp: new Date().toISOString(),
      fallback: true
    };
  }
}

/**
 * Fetch all active subscriptions from Stripe and compute total MRR
 * Only counts subscriptions where the latest invoice has been paid.
 * @returns {Promise<{mrrCents: number, currency: string, activeCount: number}>}
 */
async function fetchCurrentMrrFromStripe() {
  if (!stripeClient.isConfigured()) {
    throw new Error('Stripe is not configured');
  }

  let totalMrrCents = 0;
  let activeCount = 0;
  let hasMore = true;
  let startingAfter = null;
  let detectedCurrency = null;

  // Paginate through all active subscriptions
  // Include latest_invoice expansion to check payment status
  while (hasMore) {
    const params = {
      status: 'active',
      limit: 100,
      'expand[]': 'data.latest_invoice'
    };
    if (startingAfter) {
      params.starting_after = startingAfter;
    }

    const response = await stripeClient.stripeRequest('subscriptions', params);

    if (!response.data || response.data.length === 0) {
      break;
    }

    for (const subscription of response.data) {
      // Skip subscriptions scheduled to cancel (churn) - they shouldn't count towards MRR
      if (subscription.cancel_at_period_end) {
        continue;
      }

      // Only count subscriptions that have been paid at least once
      // Check if latest invoice exists and has been paid
      const invoice = subscription.latest_invoice;
      const isPaid = invoice && typeof invoice === 'object' &&
        (invoice.status === 'paid' || invoice.amount_paid > 0);

      if (!isPaid) {
        // Skip unpaid subscriptions (e.g., draft invoices, failed payments)
        continue;
      }

      activeCount++;

      // Detect currency from subscription
      if (!detectedCurrency && subscription.currency) {
        detectedCurrency = subscription.currency.toUpperCase();
      }

      // Sum MRR from all items in the subscription
      // Note: Only count MONTHLY subscriptions for MRR (matches Stripe's MRR definition)
      // Yearly subscriptions are tracked separately as ARR
      if (subscription.items && subscription.items.data) {
        for (const item of subscription.items.data) {
          const price = item.price;
          if (price && price.unit_amount && price.recurring) {
            const interval = price.recurring.interval;
            const intervalCount = price.recurring.interval_count || 1;

            // Only include monthly subscriptions in MRR
            if (interval === 'month') {
              const monthlyAmount = Math.round(price.unit_amount / intervalCount);
              const quantity = item.quantity || 1;
              totalMrrCents += monthlyAmount * quantity;
            }
            // Skip yearly/weekly/daily subscriptions - they don't count towards MRR
          }
        }
      }
    }

    hasMore = response.has_more;
    if (hasMore && response.data.length > 0) {
      startingAfter = response.data[response.data.length - 1].id;
    }
  }

  return {
    mrrCents: totalMrrCents,
    currency: detectedCurrency || 'USD', // Auto-detect from subscriptions (usually USD)
    activeCount
  };
}

/**
 * Capture a new MRR snapshot
 * @returns {Promise<Object>} The created snapshot
 */
async function captureSnapshot() {
  const today = new Date().toISOString().split('T')[0];

  // Get Stripe data first to know the currency
  const stripeData = await fetchCurrentMrrFromStripe();

  // Determine USD amount based on source currency
  let mrrUsdCents;
  let exchangeRate;

  if (stripeData.currency === 'USD') {
    // Subscriptions are already in USD, no conversion needed
    mrrUsdCents = stripeData.mrrCents;
    exchangeRate = 1.0;
  } else {
    // Convert from source currency (e.g., GBP) to USD
    const exchangeData = await getExchangeRate();
    mrrUsdCents = Math.round(stripeData.mrrCents * exchangeData.rate);
    exchangeRate = exchangeData.rate;
  }

  // Check if we already have a snapshot for today
  const existing = await dbAdapter.queryOne(
    'SELECT * FROM mrr_snapshots WHERE snapshot_date = $1',
    [today]
  );

  if (existing) {
    // Update existing snapshot
    await dbAdapter.execute(
      `UPDATE mrr_snapshots
       SET total_mrr_cents = $1,
           exchange_rate = $2,
           total_mrr_usd_cents = $3,
           active_subscriptions = $4,
           created_at = CURRENT_TIMESTAMP
       WHERE snapshot_date = $5`,
      [stripeData.mrrCents, exchangeRate, mrrUsdCents, stripeData.activeCount, today]
    );

    return {
      snapshot_date: today,
      total_mrr_cents: stripeData.mrrCents,
      currency: stripeData.currency,
      exchange_rate: exchangeRate,
      total_mrr_usd_cents: mrrUsdCents,
      active_subscriptions: stripeData.activeCount,
      updated: true
    };
  }

  // Create new snapshot
  await dbAdapter.execute(
    `INSERT INTO mrr_snapshots (snapshot_date, total_mrr_cents, currency, exchange_rate, total_mrr_usd_cents, active_subscriptions)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [today, stripeData.mrrCents, stripeData.currency, exchangeRate, mrrUsdCents, stripeData.activeCount]
  );

  return {
    snapshot_date: today,
    total_mrr_cents: stripeData.mrrCents,
    currency: stripeData.currency,
    exchange_rate: exchangeRate,
    total_mrr_usd_cents: mrrUsdCents,
    active_subscriptions: stripeData.activeCount,
    created: true
  };
}

/**
 * Get snapshots for the last N weeks
 * @param {number} weeks - Number of weeks to retrieve (default 4)
 * @returns {Promise<Array>} Array of snapshots
 */
async function getSnapshots(weeks = 4) {
  const daysBack = weeks * 7;
  // Compute date in JavaScript for cross-database compatibility
  const minDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const result = await dbAdapter.query(
    `SELECT * FROM mrr_snapshots
     WHERE snapshot_date >= $1
     ORDER BY snapshot_date ASC`,
    [minDate]
  );

  return result?.rows || [];
}

/**
 * Get the latest snapshot
 * @returns {Promise<Object|null>}
 */
async function getLatestSnapshot() {
  return await dbAdapter.queryOne(
    'SELECT * FROM mrr_snapshots ORDER BY snapshot_date DESC LIMIT 1'
  );
}

/**
 * Get current MRR with growth calculations
 * @returns {Promise<Object>} Current MRR data with deltas
 */
async function getCurrentMrrWithGrowth() {
  // Get latest snapshot or capture new one
  let latest = await getLatestSnapshot();
  const today = new Date().toISOString().split('T')[0];

  // If no snapshot or snapshot is old, capture a new one
  if (!latest || latest.snapshot_date !== today) {
    try {
      latest = await captureSnapshot();
    } catch (error) {
      console.error('[MrrSnapshot] Error capturing snapshot:', error.message);
      if (!latest) {
        throw error;
      }
      // Use stale data if capture fails
    }
  }

  // Get snapshot from ~1 week ago (compute date in JavaScript for cross-database compatibility)
  const oneWeekAgoDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const oneWeekAgo = await dbAdapter.queryOne(
    `SELECT * FROM mrr_snapshots
     WHERE snapshot_date <= $1
     ORDER BY snapshot_date DESC LIMIT 1`,
    [oneWeekAgoDate]
  );

  // Get snapshot from ~4 weeks ago
  const fourWeeksAgoDate = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const fourWeeksAgo = await dbAdapter.queryOne(
    `SELECT * FROM mrr_snapshots
     WHERE snapshot_date <= $1
     ORDER BY snapshot_date DESC LIMIT 1`,
    [fourWeeksAgoDate]
  );

  // Calculate deltas
  const currentUsd = latest.total_mrr_usd_cents || 0;

  let deltaWeek = null;
  let deltaWeekPercent = null;
  if (oneWeekAgo) {
    const prevUsd = oneWeekAgo.total_mrr_usd_cents || 0;
    deltaWeek = currentUsd - prevUsd;
    deltaWeekPercent = prevUsd > 0 ? Math.round((deltaWeek / prevUsd) * 100) : null;
  }

  let deltaMonth = null;
  let deltaMonthPercent = null;
  if (fourWeeksAgo) {
    const prevUsd = fourWeeksAgo.total_mrr_usd_cents || 0;
    deltaMonth = currentUsd - prevUsd;
    deltaMonthPercent = prevUsd > 0 ? Math.round((deltaMonth / prevUsd) * 100) : null;
  }

  // Determine source currency (stored in DB, or default to USD if not set)
  const sourceCurrency = latest.currency || 'USD';

  return {
    current: {
      mrrUsdCents: currentUsd,
      mrrUsd: currentUsd / 100,
      // Source currency fields (for backwards compatibility, keep GBP names but values may be in USD)
      mrrGbpCents: latest.total_mrr_cents,
      mrrGbp: latest.total_mrr_cents / 100,
      // New generic source currency fields
      mrrSourceCents: latest.total_mrr_cents,
      mrrSource: latest.total_mrr_cents / 100,
      sourceCurrency: sourceCurrency,
      exchangeRate: latest.exchange_rate,
      activeSubscriptions: latest.active_subscriptions,
      snapshotDate: latest.snapshot_date,
      lastUpdated: latest.created_at
    },
    growth: {
      vsLastWeek: {
        deltaCents: deltaWeek,
        deltaUsd: deltaWeek !== null ? deltaWeek / 100 : null,
        percent: deltaWeekPercent
      },
      vs4WeeksAgo: {
        deltaCents: deltaMonth,
        deltaUsd: deltaMonth !== null ? deltaMonth / 100 : null,
        percent: deltaMonthPercent
      }
    }
  };
}

/**
 * Get chart data for last N weeks
 * Returns data points with date labels (e.g., "Jan 7", "Jan 14")
 * Oldest week on left, current week on right
 * @param {number} weeks - Number of weeks
 * @returns {Promise<Object>} Chart-ready data
 */
async function getChartData(weeks = 4) {
  const snapshots = await getSnapshots(weeks);

  // Build data points - oldest first (left), newest (current) last (right)
  const dataPoints = [];
  const now = new Date();

  // Format date as "Jan 4", "Jan 11", etc.
  const formatDateLabel = (date) => {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Manual fallback values for missing historical data (in USD)
  // Used when no snapshot exists for a given week
  const manualFallbacks = {
    1: 11800  // Last week: $11,800
  };

  for (let i = weeks - 1; i >= 0; i--) {
    const weekDate = new Date(now);
    weekDate.setDate(now.getDate() - (i * 7));
    const weekDateStr = weekDate.toISOString().split('T')[0];

    // Find the closest snapshot to this date
    const snapshot = snapshots.find(s => {
      const snapDate = new Date(s.snapshot_date);
      const diffDays = Math.abs((weekDate - snapDate) / (1000 * 60 * 60 * 24));
      return diffDays <= 7;
    });

    // Use snapshot if available, otherwise use manual fallback
    let mrrUsd = snapshot ? (snapshot.total_mrr_usd_cents / 100) : null;
    if (mrrUsd === null && manualFallbacks[i] !== undefined) {
      mrrUsd = manualFallbacks[i];
    }

    dataPoints.push({
      label: formatDateLabel(weekDate),
      date: weekDateStr,
      mrrUsd: mrrUsd,
      mrrGbp: snapshot ? (snapshot.total_mrr_cents / 100) : null,
      subscriptions: snapshot ? snapshot.active_subscriptions : null
    });
  }

  // Data is in chronological order: oldest (left) to newest/current (right)
  return {
    labels: dataPoints.map(d => d.label),
    mrrUsd: dataPoints.map(d => d.mrrUsd),
    mrrGbp: dataPoints.map(d => d.mrrGbp),
    subscriptions: dataPoints.map(d => d.subscriptions)
  };
}

/**
 * Check if Stripe is configured
 */
function isConfigured() {
  return stripeClient.isConfigured();
}

module.exports = {
  captureSnapshot,
  getSnapshots,
  getLatestSnapshot,
  getCurrentMrrWithGrowth,
  getChartData,
  getExchangeRate,
  fetchCurrentMrrFromStripe,
  isConfigured
};
