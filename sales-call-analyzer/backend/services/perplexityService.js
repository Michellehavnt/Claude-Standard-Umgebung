/**
 * Perplexity Service
 *
 * Provides AI-powered lead research using Perplexity's online search models.
 * Used for lead quality scoring by researching companies and contacts.
 *
 * IMPORTANT: This service never logs or exposes API tokens.
 */

const secretManager = require('./secretManager');

// Perplexity API base URL
const PERPLEXITY_API_BASE = 'https://api.perplexity.ai';

// Default model - sonar is optimized for online search
const DEFAULT_MODEL = 'sonar';

// Rate limiting configuration
const RATE_LIMIT_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2
};

// Request timeout (30 seconds)
const REQUEST_TIMEOUT_MS = 30000;

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
 * Get Perplexity API key from secret manager
 */
function getApiKey() {
  return secretManager.getSecret('PERPLEXITY_API_KEY');
}

/**
 * Check if Perplexity is configured
 */
function isConfigured() {
  return secretManager.isConfigured('PERPLEXITY_API_KEY');
}

/**
 * Get the configured research prompt
 */
function getConfiguredPrompt() {
  const config = secretManager.getPerplexityConfig();
  return config.prompt || secretManager.DEFAULT_PERPLEXITY_PROMPT;
}

/**
 * Test Perplexity connection
 * @returns {Promise<Object>} - { valid: boolean, error?: string }
 */
async function testConnection() {
  return secretManager.validatePerplexityKey();
}

/**
 * Make a Perplexity API request with retry logic
 * @param {string} prompt - The user prompt to send
 * @param {Object} options - Request options
 * @returns {Promise<Object>} - API response
 */
async function perplexityRequest(prompt, options = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('PERPLEXITY_API_KEY not configured');
  }

  const {
    model = DEFAULT_MODEL,
    maxTokens = 2000,
    temperature = 0.2,
    systemPrompt = null
  } = options;

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  let lastError;

  for (let attempt = 0; attempt <= RATE_LIMIT_CONFIG.maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(`${PERPLEXITY_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const delayMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : calculateBackoffDelay(attempt);

        console.warn(`[Perplexity] Rate limited. Retrying after ${delayMs}ms`);

        if (attempt < RATE_LIMIT_CONFIG.maxRetries) {
          await sleep(delayMs);
          continue;
        }
        throw new Error('Rate limit exceeded after maximum retries');
      }

      if (!response.ok) {
        // Check content type before parsing
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(`Perplexity API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
        } else {
          // Non-JSON response (might be HTML error page)
          const text = await response.text().catch(() => '');
          if (text.includes('<!DOCTYPE') || text.includes('<html')) {
            throw new Error(`Perplexity API returned an error page (${response.status}). The API may be unavailable.`);
          }
          throw new Error(`Perplexity API error: ${response.status} - Unexpected response format`);
        }
      }

      // Check content type for success response too
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('Perplexity API returned non-JSON response');
      }

      const data = await response.json();
      return {
        content: data.choices?.[0]?.message?.content || '',
        usage: data.usage || {},
        model: data.model
      };
    } catch (error) {
      lastError = error;

      // Handle timeout
      if (error.name === 'AbortError') {
        if (attempt < RATE_LIMIT_CONFIG.maxRetries) {
          const delayMs = calculateBackoffDelay(attempt);
          console.warn(`[Perplexity] Request timeout. Retrying after ${delayMs}ms`);
          await sleep(delayMs);
          continue;
        }
        throw new Error('Request timeout after maximum retries');
      }

      // Retry on network errors
      if (error.name === 'TypeError' || error.code === 'ECONNRESET') {
        if (attempt < RATE_LIMIT_CONFIG.maxRetries) {
          const delayMs = calculateBackoffDelay(attempt);
          console.warn(`[Perplexity] Network error. Retrying after ${delayMs}ms`);
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
 * Research a lead using Perplexity AI
 * @param {Object} leadData - Lead information
 * @param {string} leadData.email - Lead email
 * @param {string} leadData.name - Lead name
 * @param {string} leadData.website - Lead website (if provided)
 * @param {string} leadData.company - Company name (if known)
 * @param {string} leadData.challenge - Lead's stated challenge/problem (from form)
 * @param {string} leadData.formResponses - Full form responses JSON string
 * @returns {Promise<Object>} - Research results
 */
async function researchLead(leadData) {
  if (!isConfigured()) {
    return {
      success: false,
      error: 'Perplexity not configured',
      data: null
    };
  }

  const { email, name, website, company, challenge, formResponses } = leadData;

  if (!email && !name && !website && !company) {
    return {
      success: false,
      error: 'No lead data provided for research',
      data: null
    };
  }

  // Build the research query
  const queryParts = [];
  if (name) queryParts.push(`Name: ${name}`);
  if (email) queryParts.push(`Email: ${email}`);
  if (company) queryParts.push(`Company: ${company}`);
  if (website) queryParts.push(`Website: ${website}`);
  if (challenge) queryParts.push(`Their Challenge: ${challenge}`);

  // Parse and include form responses if available
  if (formResponses) {
    try {
      const responses = typeof formResponses === 'string' ? JSON.parse(formResponses) : formResponses;
      if (Array.isArray(responses) && responses.length > 0) {
        queryParts.push(`\nForm Responses from their booking:`);
        responses.forEach(r => {
          if (r.question && r.answer) {
            queryParts.push(`- ${r.question}: ${r.answer}`);
          }
        });
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  const userPrompt = `Research this lead:\n${queryParts.join('\n')}`;
  const systemPrompt = getConfiguredPrompt();

  try {
    const response = await perplexityRequest(userPrompt, {
      systemPrompt,
      maxTokens: 2000,
      temperature: 0.2
    });

    // Try to parse the JSON response
    let parsedData = null;
    let parseError = null;

    try {
      // Extract JSON from response (may be wrapped in markdown code blocks)
      let jsonStr = response.content;

      // Remove markdown code blocks if present
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }

      parsedData = JSON.parse(jsonStr);
    } catch (e) {
      parseError = e.message;
      console.warn('[Perplexity] Failed to parse JSON response:', e.message);

      // Try to extract partial data
      parsedData = {
        company_info: { name: company || 'Unknown', website: website || null },
        affiliate_signals: { has_affiliate_program: false },
        person_info: { name: name || 'Unknown', role: null },
        sources: [],
        raw_response: response.content
      };
    }

    return {
      success: true,
      data: parsedData,
      parseError,
      usage: response.usage,
      model: response.model
    };
  } catch (error) {
    console.error('[Perplexity] Research error:', error.message);
    return {
      success: false,
      error: error.message,
      data: null
    };
  }
}

/**
 * Batch research multiple leads
 * @param {Object[]} leads - Array of lead data objects
 * @param {Object} options - Batch options
 * @param {number} options.delayMs - Delay between requests (default 1000ms)
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Object[]>} - Array of research results
 */
async function batchResearchLeads(leads, options = {}) {
  const { delayMs = 1000, onProgress } = options;
  const results = [];

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const result = await researchLead(lead);
    results.push({ ...lead, research: result });

    if (onProgress) {
      onProgress({
        current: i + 1,
        total: leads.length,
        lead,
        result
      });
    }

    // Delay between requests to avoid rate limiting
    if (i < leads.length - 1) {
      await sleep(delayMs);
    }
  }

  return results;
}

module.exports = {
  // Configuration
  isConfigured,
  getApiKey,
  getConfiguredPrompt,

  // Connection
  testConnection,

  // Research
  researchLead,
  batchResearchLeads,

  // Raw API access
  perplexityRequest,

  // Constants
  DEFAULT_MODEL
};
