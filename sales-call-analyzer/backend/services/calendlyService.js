/**
 * Calendly Service
 *
 * Enriches transcript data with Calendly meeting information.
 * Uses Calendly API v2 to fetch scheduled events and invitee details.
 *
 * ENRICHMENT DATA:
 * ================
 * - Meeting type (event type name)
 * - Scheduled time
 * - Duration
 * - Meeting link
 * - Invitee responses (questions/answers)
 * - Cancellation/reschedule info
 *
 * MATCHING STRATEGY:
 * ==================
 * 1. Match by invitee email (exact)
 * 2. Match by time window (call time within 30 mins of scheduled time)
 *
 * IMPORTANT: This service never logs or exposes API tokens.
 */

const secretManager = require('./secretManager');

// Calendly API base URL
const CALENDLY_API_BASE = 'https://api.calendly.com';

// Rate limiting configuration
const RATE_LIMIT_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2
};

// Time window for matching (30 minutes in milliseconds)
const MATCH_WINDOW_MS = 30 * 60 * 1000;

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
 * Get Calendly API key from secret manager
 */
function getApiKey() {
  return secretManager.getSecret('CALENDLY_API_KEY');
}

/**
 * Check if Calendly is configured
 */
function isConfigured() {
  return secretManager.isConfigured('CALENDLY_API_KEY');
}

/**
 * Make a Calendly API request with retry logic
 */
async function calendlyRequest(endpoint, params = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('CALENDLY_API_KEY not configured');
  }

  const url = new URL(`${CALENDLY_API_BASE}${endpoint}`);

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
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const delayMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : calculateBackoffDelay(attempt);

        console.warn(`[Calendly] Rate limited. Retrying after ${delayMs}ms`);

        if (attempt < RATE_LIMIT_CONFIG.maxRetries) {
          await sleep(delayMs);
          continue;
        }
        throw new Error('Rate limit exceeded after maximum retries');
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Calendly API error: ${response.status} - ${errorData.message || 'Unknown error'}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;

      // Retry on network errors
      if (error.name === 'TypeError' || error.code === 'ECONNRESET') {
        if (attempt < RATE_LIMIT_CONFIG.maxRetries) {
          const delayMs = calculateBackoffDelay(attempt);
          console.warn(`[Calendly] Network error. Retrying after ${delayMs}ms`);
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
 * Test Calendly connection
 * Validates API key and returns user info
 */
async function testConnection() {
  try {
    if (!isConfigured()) {
      return { valid: false, error: 'Calendly API key not configured' };
    }

    // Get current user info
    const userData = await calendlyRequest('/users/me');

    return {
      valid: true,
      user: {
        name: userData.resource?.name,
        email: userData.resource?.email,
        uri: userData.resource?.uri,
        timezone: userData.resource?.timezone,
        avatarUrl: userData.resource?.avatar_url
      },
      organization: userData.resource?.current_organization
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
}

/**
 * Get the current user's URI (needed for other API calls)
 */
async function getCurrentUserUri() {
  const userData = await calendlyRequest('/users/me');
  return userData.resource?.uri;
}

/**
 * Get the current user's organization URI
 */
async function getOrganizationUri() {
  const userData = await calendlyRequest('/users/me');
  return userData.resource?.current_organization;
}

/**
 * List scheduled events for the current user
 * @param {Object} options - Filter options
 * @param {string} options.minStartTime - ISO timestamp for minimum start time
 * @param {string} options.maxStartTime - ISO timestamp for maximum start time
 * @param {number} options.count - Max events to return (default 100)
 * @param {string} options.status - Event status filter (active, canceled)
 */
async function listScheduledEvents(options = {}) {
  const { minStartTime, maxStartTime, count = 100, status = 'active' } = options;

  const userUri = await getCurrentUserUri();

  const params = {
    user: userUri,
    count: Math.min(count, 100), // Calendly max is 100
    status
  };

  if (minStartTime) params.min_start_time = minStartTime;
  if (maxStartTime) params.max_start_time = maxStartTime;

  const response = await calendlyRequest('/scheduled_events', params);
  return response.collection || [];
}

/**
 * Get event details by URI
 */
async function getEvent(eventUri) {
  if (!eventUri) return null;

  // Extract event UUID from URI
  const uuid = eventUri.split('/').pop();
  const response = await calendlyRequest(`/scheduled_events/${uuid}`);
  return response.resource;
}

/**
 * Get invitees for an event
 */
async function getEventInvitees(eventUri) {
  if (!eventUri) return [];

  // Extract event UUID from URI
  const uuid = eventUri.split('/').pop();
  const response = await calendlyRequest(`/scheduled_events/${uuid}/invitees`);
  return response.collection || [];
}

/**
 * Get event type details
 */
async function getEventType(eventTypeUri) {
  if (!eventTypeUri) return null;

  // Extract event type UUID from URI
  const uuid = eventTypeUri.split('/').pop();
  const response = await calendlyRequest(`/event_types/${uuid}`);
  return response.resource;
}

/**
 * Normalize email for comparison
 */
function normalizeEmail(email) {
  if (!email) return '';
  return email.toLowerCase().trim();
}

/**
 * Find Calendly events by invitee email
 * @param {string} email - Invitee email to search for
 * @param {Object} options - Search options
 * @param {string} options.minStartTime - Minimum event start time
 * @param {string} options.maxStartTime - Maximum event start time
 */
async function findEventsByEmail(email, options = {}) {
  if (!email) return [];

  const normalizedEmail = normalizeEmail(email);

  // Get recent events
  const events = await listScheduledEvents(options);

  // Filter events that have this invitee
  const matchingEvents = [];

  for (const event of events) {
    try {
      const invitees = await getEventInvitees(event.uri);
      const hasInvitee = invitees.some(inv =>
        normalizeEmail(inv.email) === normalizedEmail
      );

      if (hasInvitee) {
        matchingEvents.push({
          ...event,
          invitees
        });
      }
    } catch (error) {
      console.warn(`[Calendly] Error fetching invitees for event: ${error.message}`);
    }
  }

  return matchingEvents;
}

/**
 * Find Calendly event matching a call
 * Tries to match by email and time window
 * @param {Object} callData - Call data containing email and datetime
 * @param {string} callData.email - Contact email
 * @param {string} callData.callDatetime - Call datetime ISO string
 */
async function findMatchingEvent(callData) {
  if (!callData || !callData.email) return null;

  const callTime = callData.callDatetime ? new Date(callData.callDatetime) : null;

  // Define search window (7 days before/after call)
  const minTime = callTime
    ? new Date(callTime.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const maxTime = callTime
    ? new Date(callTime.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
    : new Date().toISOString();

  const events = await findEventsByEmail(callData.email, {
    minStartTime: minTime,
    maxStartTime: maxTime
  });

  if (events.length === 0) return null;

  // If we have call time, find the closest event
  if (callTime) {
    let closestEvent = null;
    let closestDiff = Infinity;

    for (const event of events) {
      const eventTime = new Date(event.start_time);
      const diff = Math.abs(eventTime.getTime() - callTime.getTime());

      // Only match if within the match window
      if (diff < closestDiff && diff <= MATCH_WINDOW_MS) {
        closestDiff = diff;
        closestEvent = event;
      }
    }

    return closestEvent;
  }

  // If no call time, return the most recent event
  return events[0];
}

/**
 * Enrich transcript with Calendly data
 * @param {Object} transcriptData - Transcript data containing contact email and call time
 * @returns {Object} - Calendly enrichment data
 */
async function enrichWithCalendly(transcriptData) {
  if (!isConfigured()) {
    return { enriched: false, reason: 'Calendly not configured' };
  }

  if (!transcriptData || !transcriptData.email) {
    return { enriched: false, reason: 'No email provided' };
  }

  try {
    const event = await findMatchingEvent({
      email: transcriptData.email,
      callDatetime: transcriptData.callDatetime
    });

    if (!event) {
      return {
        enriched: false,
        reason: 'No matching Calendly event found'
      };
    }

    // Get event type details for more info
    let eventTypeDetails = null;
    if (event.event_type) {
      try {
        eventTypeDetails = await getEventType(event.event_type);
      } catch (e) {
        console.warn('[Calendly] Could not fetch event type details:', e.message);
      }
    }

    // Find the matching invitee
    const normalizedEmail = normalizeEmail(transcriptData.email);
    const invitee = event.invitees?.find(inv =>
      normalizeEmail(inv.email) === normalizedEmail
    );

    // Extract invitee responses (form questions/answers)
    const responses = invitee?.questions_and_answers?.map(qa => ({
      question: qa.question,
      answer: qa.answer
    })) || [];

    return {
      enriched: true,
      calendly: {
        eventId: event.uri?.split('/').pop(),
        eventName: event.name,
        eventType: eventTypeDetails?.name || null,
        eventTypeSlug: eventTypeDetails?.slug || null,
        scheduledTime: event.start_time,
        endTime: event.end_time,
        duration: eventTypeDetails?.duration || null,
        status: event.status,
        meetingUrl: event.location?.join_url || null,
        location: event.location?.location || null,
        locationType: event.location?.type || null,
        canceled: event.status === 'canceled',
        canceledAt: event.cancellation?.canceled_at || null,
        cancelReason: event.cancellation?.reason || null,
        rescheduled: !!event.rescheduled,
        invitee: invitee ? {
          name: invitee.name,
          email: invitee.email,
          timezone: invitee.timezone,
          createdAt: invitee.created_at
        } : null,
        responses,
        createdAt: event.created_at,
        updatedAt: event.updated_at
      }
    };
  } catch (error) {
    console.error('[Calendly] Enrichment error:', error.message);
    return {
      enriched: false,
      reason: `Error: ${error.message}`
    };
  }
}

/**
 * Get event statistics for reporting
 */
async function getEventStats(options = {}) {
  const { days = 30 } = options;

  const minTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const maxTime = new Date().toISOString();

  // Get active events
  const activeEvents = await listScheduledEvents({
    minStartTime: minTime,
    maxStartTime: maxTime,
    status: 'active'
  });

  // Get canceled events
  const canceledEvents = await listScheduledEvents({
    minStartTime: minTime,
    maxStartTime: maxTime,
    status: 'canceled'
  });

  return {
    period: `Last ${days} days`,
    totalScheduled: activeEvents.length + canceledEvents.length,
    active: activeEvents.length,
    canceled: canceledEvents.length,
    cancellationRate: activeEvents.length + canceledEvents.length > 0
      ? (canceledEvents.length / (activeEvents.length + canceledEvents.length) * 100).toFixed(1)
      : '0'
  };
}

module.exports = {
  // Configuration
  isConfigured,
  getApiKey,

  // Connection
  testConnection,

  // User/Organization
  getCurrentUserUri,
  getOrganizationUri,

  // Events
  listScheduledEvents,
  getEvent,
  getEventInvitees,
  getEventType,
  findEventsByEmail,
  findMatchingEvent,

  // Enrichment
  enrichWithCalendly,

  // Stats
  getEventStats,

  // Utils
  normalizeEmail
};
