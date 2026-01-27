/**
 * Slack Ingestion Service
 *
 * Ingests lifecycle events from Slack channel messages.
 * Parses messages into structured events and stores them in DB.
 *
 * EVENT TYPES:
 * ============
 * - registered: User created an account
 * - trialing: User started a trial
 * - active: User has active subscription
 * - canceled: User canceled subscription
 * - payment_failed: Payment failed
 *
 * IDEMPOTENCY:
 * ============
 * Uses message_ts + email + event_type as unique key to prevent duplicates.
 *
 * IMPORTANT: This service never logs or exposes API tokens.
 */

const secretManager = require('./secretManager');
const transcriptDb = require('./transcriptDb');

// Slack API base URL
const SLACK_API_BASE = 'https://slack.com/api';

// Rate limiting configuration
const RATE_LIMIT_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2
};

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 */
function calculateBackoffDelay(attempt) {
  const delay = RATE_LIMIT_CONFIG.initialDelayMs * Math.pow(RATE_LIMIT_CONFIG.backoffMultiplier, attempt);
  const jitter = delay * 0.2 * (Math.random() * 2 - 1);
  return Math.min(delay + jitter, RATE_LIMIT_CONFIG.maxDelayMs);
}

/**
 * Get Slack bot token from secret manager
 */
function getBotToken() {
  return secretManager.getSecret('SLACK_BOT_TOKEN');
}

/**
 * Get Slack signup channel ID
 * Default: C09246QR2AX (pre-configured)
 */
function getSignupChannelId() {
  return secretManager.getSecret('SLACK_SIGNUP_CHANNEL_ID') || 'C09246QR2AX';
}

/**
 * Get Slack payment channel ID
 * Default: C0987US3LSJ (pre-configured)
 */
function getPaymentChannelId() {
  return secretManager.getSecret('SLACK_PAYMENT_CHANNEL_ID') || 'C0987US3LSJ';
}

/**
 * Get Slack channel ID (legacy - returns signup channel)
 * @deprecated Use getSignupChannelId or getPaymentChannelId
 */
function getChannelId() {
  return secretManager.getSecret('SLACK_CHANNEL_ID') || getSignupChannelId();
}

/**
 * Check if Slack is configured
 * Only requires bot token since channel IDs have defaults
 */
function isConfigured() {
  return secretManager.isConfigured('SLACK_BOT_TOKEN');
}

/**
 * Make a Slack API request with retry logic
 */
async function slackRequest(endpoint, params = {}) {
  const botToken = getBotToken();
  if (!botToken) {
    throw new Error('SLACK_BOT_TOKEN not configured');
  }

  const url = new URL(`${SLACK_API_BASE}/${endpoint}`);

  // Add query parameters
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, String(value));
    }
  });

  let lastError;

  for (let attempt = 0; attempt <= RATE_LIMIT_CONFIG.maxRetries; attempt++) {
    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${botToken}`,
          'Content-Type': 'application/json'
        }
      });

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const delayMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : calculateBackoffDelay(attempt);

        console.warn(`[SlackIngestion] Rate limited. Retrying after ${delayMs}ms`);

        if (attempt < RATE_LIMIT_CONFIG.maxRetries) {
          await sleep(delayMs);
          continue;
        }
        throw new Error('Rate limit exceeded after maximum retries');
      }

      const data = await response.json();

      if (!data.ok) {
        throw new Error(`Slack API error: ${data.error}`);
      }

      return data;
    } catch (error) {
      lastError = error;

      // Retry on network errors
      if (error.name === 'TypeError' || error.code === 'ECONNRESET') {
        if (attempt < RATE_LIMIT_CONFIG.maxRetries) {
          const delayMs = calculateBackoffDelay(attempt);
          console.warn(`[SlackIngestion] Network error. Retrying after ${delayMs}ms`);
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
 * Test Slack connection
 * Validates token and channel access for both signup and payment channels
 */
async function testConnection() {
  try {
    if (!isConfigured()) {
      return { valid: false, error: 'Slack bot token not configured' };
    }

    // Test auth
    const authTest = await slackRequest('auth.test');

    // Test signup channel access
    const signupChannelId = getSignupChannelId();
    let signupChannel = null;
    try {
      const signupInfo = await slackRequest('conversations.info', { channel: signupChannelId });
      signupChannel = signupInfo.channel?.name;
    } catch (e) {
      console.warn('[SlackIngestion] Could not access signup channel:', e.message);
    }

    // Test payment channel access
    const paymentChannelId = getPaymentChannelId();
    let paymentChannel = null;
    try {
      const paymentInfo = await slackRequest('conversations.info', { channel: paymentChannelId });
      paymentChannel = paymentInfo.channel?.name;
    } catch (e) {
      console.warn('[SlackIngestion] Could not access payment channel:', e.message);
    }

    return {
      valid: true,
      teamName: authTest.team,
      teamId: authTest.team_id,
      botUserId: authTest.user_id,
      channels: {
        signup: {
          id: signupChannelId,
          name: signupChannel,
          accessible: !!signupChannel
        },
        payment: {
          id: paymentChannelId,
          name: paymentChannel,
          accessible: !!paymentChannel
        }
      },
      // Legacy fields for backward compatibility
      channelName: signupChannel || paymentChannel,
      channelId: signupChannelId
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
}

/**
 * Fetch messages from a channel with pagination
 * @param {Object} options - Fetch options
 * @param {string} options.channelId - Channel ID to fetch from
 * @param {number} options.limit - Messages per page (max 200)
 * @param {string} options.oldest - Oldest timestamp to fetch
 * @param {string} options.latest - Latest timestamp to fetch
 * @param {number} options.maxPages - Max pages to fetch
 */
async function fetchChannelMessages(options = {}) {
  const { channelId, limit = 200, oldest = null, latest = null, maxPages = 10 } = options;

  if (!channelId) {
    throw new Error('Channel ID is required');
  }

  const allMessages = [];
  let hasMore = true;
  let cursor = null;
  let pageCount = 0;

  while (hasMore && pageCount < maxPages) {
    const params = {
      channel: channelId,
      limit: Math.min(limit, 200) // Slack max is 200
    };

    if (oldest) params.oldest = oldest;
    if (latest) params.latest = latest;
    if (cursor) params.cursor = cursor;

    const response = await slackRequest('conversations.history', params);

    if (response.messages && response.messages.length > 0) {
      // Add channel source to each message
      const messagesWithSource = response.messages.map(m => ({
        ...m,
        _channelId: channelId
      }));
      allMessages.push(...messagesWithSource);
    }

    hasMore = response.has_more === true;
    cursor = response.response_metadata?.next_cursor || null;
    pageCount++;
  }

  return allMessages;
}

/**
 * Parse a Slack message into lifecycle events
 * Returns an array of events (some messages may contain multiple events)
 */
function parseMessage(message) {
  const events = [];

  if (!message || !message.text) {
    return events;
  }

  const text = message.text;
  const timestamp = message.ts;
  const messageDate = new Date(parseFloat(timestamp) * 1000).toISOString();

  // Common patterns for lifecycle events
  // These patterns should be customized based on your Slack notification format
  const patterns = [
    // Registered patterns
    {
      type: 'registered',
      patterns: [
        /(?:new\s+user|user\s+registered|signed?\s*up|created\s+account).*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
        /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}).*?(?:registered|signed?\s*up|created\s+account)/i
      ]
    },
    // Trialing patterns
    {
      type: 'trialing',
      patterns: [
        /(?:started?\s+trial|trial\s+started|trialing).*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
        /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}).*?(?:started?\s+trial|is\s+now\s+trialing)/i
      ]
    },
    // Active/Subscribed patterns
    {
      type: 'active',
      patterns: [
        /(?:subscribed|subscription\s+active|became\s+customer|converted|upgraded).*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
        /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}).*?(?:subscribed|is\s+now\s+active|converted|upgraded)/i
      ]
    },
    // Canceled patterns
    {
      type: 'canceled',
      patterns: [
        /(?:cancel(?:led|ed)?|churned?|subscription\s+ended).*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
        /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}).*?(?:cancel(?:led|ed)?|churned?|ended\s+subscription)/i
      ]
    },
    // Payment failed patterns
    {
      type: 'payment_failed',
      patterns: [
        /(?:payment\s+failed|billing\s+failed|charge\s+failed).*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
        /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}).*?(?:payment\s+failed|billing\s+issue)/i
      ]
    }
  ];

  // Try each pattern type
  for (const { type, patterns: typePatterns } of patterns) {
    for (const pattern of typePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const email = match[1].toLowerCase().trim();

        // Extract additional info if available
        let plan = null;
        let cancellationReason = null;

        // Try to extract plan name
        const planMatch = text.match(/(?:plan|tier|package)[\s:]*([A-Za-z]+(?:\s+[A-Za-z]+)?)/i);
        if (planMatch) {
          plan = planMatch[1];
        }

        // Try to extract cancellation reason
        if (type === 'canceled') {
          const reasonMatch = text.match(/(?:reason|because|due\s+to)[\s:]*(.+?)(?:\.|$)/i);
          if (reasonMatch) {
            cancellationReason = reasonMatch[1].trim();
          }
        }

        events.push({
          event_type: type,
          email,
          timestamp: messageDate,
          message_ts: timestamp,
          plan,
          cancellation_reason: cancellationReason,
          raw_message: text,
          parse_confidence: 'high'
        });

        // Only match one event type per message (first match wins)
        return events;
      }
    }
  }

  // If no pattern matched but text contains an email, store as unparsed
  const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) {
    events.push({
      event_type: 'unparsed',
      email: emailMatch[1].toLowerCase().trim(),
      timestamp: messageDate,
      message_ts: timestamp,
      raw_message: text,
      parse_confidence: 'low'
    });
  }

  return events;
}

/**
 * Ensure the slack_lifecycle_events table exists
 */
async function ensureTable() {
  const database = await transcriptDb.getDb();

  // Create table
  database.run(`
    CREATE TABLE IF NOT EXISTS slack_lifecycle_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      email TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      message_ts TEXT NOT NULL,
      plan TEXT,
      cancellation_reason TEXT,
      raw_message TEXT,
      parse_confidence TEXT DEFAULT 'high',
      channel_source TEXT DEFAULT 'signup',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(message_ts, email, event_type)
    )
  `);

  // Create indexes
  database.run('CREATE INDEX IF NOT EXISTS idx_slack_events_email ON slack_lifecycle_events(email)');
  database.run('CREATE INDEX IF NOT EXISTS idx_slack_events_type ON slack_lifecycle_events(event_type)');
  database.run('CREATE INDEX IF NOT EXISTS idx_slack_events_timestamp ON slack_lifecycle_events(timestamp)');
  database.run('CREATE INDEX IF NOT EXISTS idx_slack_events_channel ON slack_lifecycle_events(channel_source)');

  console.log('[SlackIngestion] Table ensured');
}

/**
 * Store a lifecycle event in the database
 * Uses UNIQUE constraint for idempotency
 */
async function storeEvent(event) {
  const database = await transcriptDb.getDb();

  // Check if event already exists
  const existingResult = database.exec(
    `SELECT id FROM slack_lifecycle_events WHERE message_ts = ? AND email = ? AND event_type = ?`,
    [event.message_ts, event.email, event.event_type]
  );

  if (existingResult.length > 0 && existingResult[0].values.length > 0) {
    // Already exists, skip
    return { inserted: false, id: existingResult[0].values[0][0] };
  }

  // Insert new event
  database.run(
    `INSERT INTO slack_lifecycle_events
    (event_type, email, timestamp, message_ts, plan, cancellation_reason, raw_message, parse_confidence, channel_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.event_type,
      event.email,
      event.timestamp,
      event.message_ts,
      event.plan || null,
      event.cancellation_reason || null,
      event.raw_message || null,
      event.parse_confidence || 'high',
      event.channel_source || 'signup'
    ]
  );

  // Get the last inserted id
  const lastIdResult = database.exec('SELECT last_insert_rowid()');
  const lastId = lastIdResult.length > 0 && lastIdResult[0].values.length > 0
    ? lastIdResult[0].values[0][0]
    : null;

  return { inserted: true, id: lastId };
}

/**
 * Sync messages from Slack channels and store as events
 * Fetches from both signup and payment channels
 */
async function syncEvents(options = {}) {
  await ensureTable();

  const signupChannelId = getSignupChannelId();
  const paymentChannelId = getPaymentChannelId();

  const results = {
    total: 0,
    imported: 0,
    skipped: 0,
    errors: 0,
    events: [],
    channels: {
      signup: { total: 0, imported: 0 },
      payment: { total: 0, imported: 0 }
    }
  };

  // Fetch from signup channel
  try {
    console.log(`[SlackIngestion] Fetching from signup channel: ${signupChannelId}`);
    const signupMessages = await fetchChannelMessages({
      ...options,
      channelId: signupChannelId
    });
    results.channels.signup.total = signupMessages.length;
    results.total += signupMessages.length;

    for (const message of signupMessages) {
      try {
        const events = parseMessage(message);

        for (const event of events) {
          event.channel_source = 'signup';
          const result = await storeEvent(event);

          if (result.inserted) {
            results.imported++;
            results.channels.signup.imported++;
            results.events.push({
              id: result.id,
              event_type: event.event_type,
              email: event.email
            });
          } else {
            results.skipped++;
          }
        }
      } catch (error) {
        console.error('[SlackIngestion] Error processing signup message:', error.message);
        results.errors++;
      }
    }
  } catch (error) {
    console.error('[SlackIngestion] Error fetching signup channel:', error.message);
  }

  // Fetch from payment channel
  try {
    console.log(`[SlackIngestion] Fetching from payment channel: ${paymentChannelId}`);
    const paymentMessages = await fetchChannelMessages({
      ...options,
      channelId: paymentChannelId
    });
    results.channels.payment.total = paymentMessages.length;
    results.total += paymentMessages.length;

    for (const message of paymentMessages) {
      try {
        const events = parseMessage(message);

        for (const event of events) {
          event.channel_source = 'payment';
          const result = await storeEvent(event);

          if (result.inserted) {
            results.imported++;
            results.channels.payment.imported++;
            results.events.push({
              id: result.id,
              event_type: event.event_type,
              email: event.email
            });
          } else {
            results.skipped++;
          }
        }
      } catch (error) {
        console.error('[SlackIngestion] Error processing payment message:', error.message);
        results.errors++;
      }
    }
  } catch (error) {
    console.error('[SlackIngestion] Error fetching payment channel:', error.message);
  }

  return results;
}

/**
 * Get lifecycle events for an email
 */
async function getEventsForEmail(email) {
  if (!email) return [];

  const database = await transcriptDb.getDb();

  const result = database.exec(
    `SELECT * FROM slack_lifecycle_events WHERE email = ? ORDER BY timestamp DESC`,
    [email.toLowerCase().trim()]
  );

  if (!result.length) return [];

  const columns = result[0].columns;
  return result[0].values.map(row => {
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });
}

/**
 * Get the latest status for an email based on Slack events
 * Priority: active > trialing > canceled > payment_failed > registered > unparsed
 */
async function getLatestStatusForEmail(email) {
  if (!email) return null;

  const events = await getEventsForEmail(email);

  if (events.length === 0) {
    return null;
  }

  // Sort by timestamp descending
  const sorted = [...events].sort((a, b) =>
    new Date(b.timestamp) - new Date(a.timestamp)
  );

  // Priority mapping
  const priorityMap = {
    'active': 1,
    'trialing': 2,
    'canceled': 3,
    'payment_failed': 4,
    'registered': 5,
    'unparsed': 6
  };

  // Find the most significant recent event
  const prioritized = [...sorted].sort((a, b) => {
    const aPriority = priorityMap[a.event_type] || 99;
    const bPriority = priorityMap[b.event_type] || 99;
    return aPriority - bPriority;
  });

  const latestEvent = prioritized[0];

  return {
    status: latestEvent.event_type,
    timestamp: latestEvent.timestamp,
    plan: latestEvent.plan,
    allEvents: events.length,
    source: 'slack'
  };
}

/**
 * Get all events with optional filters
 */
async function getAllEvents(options = {}) {
  const { limit = 100, offset = 0, eventType = null, email = null } = options;

  const database = await transcriptDb.getDb();

  let sql = 'SELECT * FROM slack_lifecycle_events WHERE 1=1';
  const params = [];

  if (eventType) {
    sql += ' AND event_type = ?';
    params.push(eventType);
  }

  if (email) {
    sql += ' AND email = ?';
    params.push(email.toLowerCase().trim());
  }

  sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const result = database.exec(sql, params);

  if (!result.length) return [];

  const columns = result[0].columns;
  return result[0].values.map(row => {
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });
}

/**
 * Get event statistics
 */
async function getEventStats() {
  const database = await transcriptDb.getDb();

  const result = database.exec(`
    SELECT
      event_type,
      COUNT(*) as count,
      MAX(timestamp) as latest
    FROM slack_lifecycle_events
    GROUP BY event_type
    ORDER BY count DESC
  `);

  if (!result.length) return [];

  const columns = result[0].columns;
  return result[0].values.map(row => {
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });
}

module.exports = {
  // Configuration
  isConfigured,
  getBotToken,
  getChannelId,
  getSignupChannelId,
  getPaymentChannelId,

  // Connection
  testConnection,

  // Fetching
  fetchChannelMessages,

  // Parsing
  parseMessage,

  // Storage
  ensureTable,
  storeEvent,

  // Sync
  syncEvents,

  // Queries
  getEventsForEmail,
  getLatestStatusForEmail,
  getAllEvents,
  getEventStats
};
