/**
 * MRR Snapshot Service
 *
 * Captures and retrieves Monthly Recurring Revenue snapshots from Stripe.
 * Handles GBP to USD currency conversion with exchange rate tracking.
 *
 * Features:
 * - Fetches all active subscriptions from Stripe
 * - Computes total MRR in original currency (GBP)
 * - Converts to USD using live exchange rate
 * - Stores snapshots for historical tracking
 * - Provides growth calculations (vs previous week/4 weeks ago)
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

  // Paginate through all active subscriptions
  while (hasMore) {
    const params = {
      status: 'active',
      limit: 100
    };
    if (startingAfter) {
      params.starting_after = startingAfter;
    }

    const response = await stripeClient.stripeRequest('subscriptions', params);

    if (!response.data || response.data.length === 0) {
      break;
    }

    for (const subscription of response.data) {
      activeCount++;

      // Sum MRR from all items in the subscription
      if (subscription.items && subscription.items.data) {
        for (const item of subscription.items.data) {
          const price = item.price;
          if (price && price.unit_amount) {
            // Normalize to monthly
            let monthlyAmount = price.unit_amount;

            if (price.recurring) {
              const interval = price.recurring.interval;
              const intervalCount = price.recurring.interval_count || 1;

              if (interval === 'year') {
                monthlyAmount = Math.round(price.unit_amount / (12 * intervalCount));
              } else if (interval === 'week') {
                monthlyAmount = Math.round(price.unit_amount * 4.33 / intervalCount);
              } else if (interval === 'day') {
                monthlyAmount = Math.round(price.unit_amount * 30 / intervalCount);
              } else if (interval === 'month') {
                monthlyAmount = Math.round(price.unit_amount / intervalCount);
              }
            }

            // Handle quantity
            const quantity = item.quantity || 1;
            totalMrrCents += monthlyAmount * quantity;
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
    currency: 'GBP', // Stripe account is in GBP
    activeCount
  };
}

/**
 * Capture a new MRR snapshot
 * @returns {Promise<Object>} The created snapshot
 */
async function captureSnapshot() {
  const today = new Date().toISOString().split('T')[0];

  // Check if we already have a snapshot for today
  const existing = await dbAdapter.queryOne(
    'SELECT * FROM mrr_snapshots WHERE snapshot_date = $1',
    [today]
  );

  if (existing) {
    // Update existing snapshot
    const stripeData = await fetchCurrentMrrFromStripe();
    const exchangeData = await getExchangeRate();
    const mrrUsdCents = Math.round(stripeData.mrrCents * exchangeData.rate);

    await dbAdapter.execute(
      `UPDATE mrr_snapshots
       SET total_mrr_cents = $1,
           exchange_rate = $2,
           total_mrr_usd_cents = $3,
           active_subscriptions = $4,
           created_at = CURRENT_TIMESTAMP
       WHERE snapshot_date = $5`,
      [stripeData.mrrCents, exchangeData.rate, mrrUsdCents, stripeData.activeCount, today]
    );

    return {
      snapshot_date: today,
      total_mrr_cents: stripeData.mrrCents,
      currency: 'GBP',
      exchange_rate: exchangeData.rate,
      total_mrr_usd_cents: mrrUsdCents,
      active_subscriptions: stripeData.activeCount,
      updated: true
    };
  }

  // Create new snapshot
  const stripeData = await fetchCurrentMrrFromStripe();
  const exchangeData = await getExchangeRate();
  const mrrUsdCents = Math.round(stripeData.mrrCents * exchangeData.rate);

  await dbAdapter.execute(
    `INSERT INTO mrr_snapshots (snapshot_date, total_mrr_cents, currency, exchange_rate, total_mrr_usd_cents, active_subscriptions)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [today, stripeData.mrrCents, 'GBP', exchangeData.rate, mrrUsdCents, stripeData.activeCount]
  );

  return {
    snapshot_date: today,
    total_mrr_cents: stripeData.mrrCents,
    currency: 'GBP',
    exchange_rate: exchangeData.rate,
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

  const snapshots = await dbAdapter.query(
    `SELECT * FROM mrr_snapshots
     WHERE snapshot_date >= $1
     ORDER BY snapshot_date ASC`,
    [minDate]
  );

  return snapshots || [];
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

  return {
    current: {
      mrrUsdCents: currentUsd,
      mrrUsd: currentUsd / 100,
      mrrGbpCents: latest.total_mrr_cents,
      mrrGbp: latest.total_mrr_cents / 100,
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
 * @param {number} weeks - Number of weeks
 * @returns {Promise<Object>} Chart-ready data
 */
async function getChartData(weeks = 4) {
  const snapshots = await getSnapshots(weeks);

  // Build weekly data points (one per week)
  const weeklyData = [];
  const now = new Date();

  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - (i * 7));
    const weekStartStr = weekStart.toISOString().split('T')[0];

    // Find the closest snapshot to this week
    const snapshot = snapshots.find(s => {
      const snapDate = new Date(s.snapshot_date);
      const diffDays = Math.abs((weekStart - snapDate) / (1000 * 60 * 60 * 24));
      return diffDays <= 7;
    });

    weeklyData.push({
      week: i === 0 ? 'This week' : i === 1 ? 'Last week' : `${i} weeks ago`,
      date: weekStartStr,
      mrrUsd: snapshot ? (snapshot.total_mrr_usd_cents / 100) : null,
      mrrGbp: snapshot ? (snapshot.total_mrr_cents / 100) : null,
      subscriptions: snapshot ? snapshot.active_subscriptions : null
    });
  }

  return {
    labels: weeklyData.map(d => d.week).reverse(),
    mrrUsd: weeklyData.map(d => d.mrrUsd).reverse(),
    mrrGbp: weeklyData.map(d => d.mrrGbp).reverse(),
    subscriptions: weeklyData.map(d => d.subscriptions).reverse()
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
