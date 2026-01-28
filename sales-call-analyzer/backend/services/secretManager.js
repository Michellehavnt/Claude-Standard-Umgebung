/**
 * Secret Manager Service
 * Securely manages API keys - reads from .env.local or secrets.json
 * NEVER exposes raw keys via API endpoints
 */

const fs = require('fs');
const path = require('path');

// Paths for secret storage
const ENV_LOCAL_PATH = path.join(__dirname, '..', '.env.local');
const SECRETS_JSON_PATH = path.join(__dirname, '..', 'secrets.json');

// Supported API key types
const KEY_TYPES = {
  FIREFLIES_API_KEY: 'fireflies',
  STRIPE_API_KEY: 'stripe',
  OPENAI_API_KEY: 'openai',
  CALENDLY_API_KEY: 'calendly',
  SLACK_BOT_TOKEN: 'slack',
  PERPLEXITY_API_KEY: 'perplexity'
};

// Default Perplexity prompt for lead research
const DEFAULT_PERPLEXITY_PROMPT = `Research this lead and return a JSON object with the following structure:
{
  "company_info": {
    "name": "Company name",
    "website": "Company website URL",
    "description": "Brief company description",
    "employee_count": "Estimated number (e.g., '10-50' or '100+')",
    "industry": "Industry/vertical",
    "founded_year": null or year number,
    "funding": "Funding status if known (e.g., 'Series A', 'Bootstrapped')"
  },
  "affiliate_signals": {
    "has_affiliate_program": true/false,
    "affiliate_software_detected": ["List of detected affiliate platforms like Impact, PartnerStack, Rewardful"],
    "affiliate_page_url": "URL to their affiliate/partners page or null",
    "affiliate_terms_found": true/false,
    "partner_mentions": true/false
  },
  "person_info": {
    "name": "Person's full name",
    "role": "Job title/role",
    "linkedin_url": "LinkedIn profile URL or null",
    "authority_level": "junior|mid|senior|executive"
  },
  "sources": ["List of URLs used for research"]
}

Research the company and person thoroughly. Look for:
1. Company website, LinkedIn, Crunchbase for company info
2. Check for /affiliates, /partners, /referrals pages on their website
3. Look for mentions of affiliate software (Impact, PartnerStack, Rewardful, FirstPromoter, etc.)
4. Find the person's LinkedIn profile and role

Return ONLY valid JSON, no additional text.`;

// Supported OpenAI models
const OPENAI_MODELS = [
  { id: 'gpt-5-mini', name: 'GPT-5 Mini', description: 'Advanced reasoning with balanced speed and cost' },
  { id: 'gpt-5-nano', name: 'GPT-5 Nano', description: 'Ultra-fast, lowest cost, ideal for simple tasks' },
  { id: 'gpt-4o', name: 'GPT-4o', description: 'Most capable model, best for complex analysis' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast and cost-effective' },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'High performance with large context' },
  { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', description: 'Fastest, most economical' }
];

// Apply modes for model changes
const APPLY_MODES = {
  FUTURE_ONLY: 'future_only',
  RERUN_ALL: 'rerun_all',
  RERUN_LAST_DAY: 'rerun_last_day',
  RERUN_LAST_WEEK: 'rerun_last_week'
};

// In-memory cache (loaded on startup)
let secretsCache = {};

/**
 * Load secrets from .env.local file
 * @returns {Object} - Key-value pairs from .env.local
 */
function loadEnvLocal() {
  const secrets = {};

  if (fs.existsSync(ENV_LOCAL_PATH)) {
    const content = fs.readFileSync(ENV_LOCAL_PATH, 'utf8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          secrets[key.trim()] = valueParts.join('=').trim();
        }
      }
    }
  }

  return secrets;
}

/**
 * Load secrets from secrets.json file
 * @returns {Object} - Secrets object
 */
function loadSecretsJson() {
  if (fs.existsSync(SECRETS_JSON_PATH)) {
    try {
      const content = fs.readFileSync(SECRETS_JSON_PATH, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      console.error('[SecretManager] Error reading secrets.json:', error.message);
      return {};
    }
  }
  return {};
}

/**
 * Load all secrets from available sources
 * Priority: .env.local > secrets.json > process.env
 */
function loadSecrets() {
  const envLocalSecrets = loadEnvLocal();
  const jsonSecrets = loadSecretsJson();

  // Merge with priority: .env.local > secrets.json > process.env
  secretsCache = {
    FIREFLIES_API_KEY: envLocalSecrets.FIREFLIES_API_KEY ||
                       jsonSecrets.FIREFLIES_API_KEY ||
                       process.env.FIREFLIES_API_KEY || null,
    STRIPE_API_KEY: envLocalSecrets.STRIPE_API_KEY ||
                    jsonSecrets.STRIPE_API_KEY ||
                    process.env.STRIPE_API_KEY || null,
    OPENAI_API_KEY: envLocalSecrets.OPENAI_API_KEY ||
                    jsonSecrets.OPENAI_API_KEY ||
                    process.env.OPENAI_API_KEY || null,
    CALENDLY_API_KEY: envLocalSecrets.CALENDLY_API_KEY ||
                      jsonSecrets.CALENDLY_API_KEY ||
                      process.env.CALENDLY_API_KEY || null,
    SLACK_BOT_TOKEN: envLocalSecrets.SLACK_BOT_TOKEN ||
                     jsonSecrets.SLACK_BOT_TOKEN ||
                     process.env.SLACK_BOT_TOKEN || null,
    SLACK_SIGNUP_CHANNEL_ID: envLocalSecrets.SLACK_SIGNUP_CHANNEL_ID ||
                             jsonSecrets.SLACK_SIGNUP_CHANNEL_ID || null,
    SLACK_PAYMENT_CHANNEL_ID: envLocalSecrets.SLACK_PAYMENT_CHANNEL_ID ||
                              jsonSecrets.SLACK_PAYMENT_CHANNEL_ID || null,
    // Perplexity configuration
    PERPLEXITY_API_KEY: envLocalSecrets.PERPLEXITY_API_KEY ||
                        jsonSecrets.PERPLEXITY_API_KEY ||
                        process.env.PERPLEXITY_API_KEY || null,
    PERPLEXITY_PROMPT: jsonSecrets.PERPLEXITY_PROMPT || DEFAULT_PERPLEXITY_PROMPT,
    LEAD_QUALITY_TRACKED_REPS: jsonSecrets.LEAD_QUALITY_TRACKED_REPS || '[]',
    // Model configuration (non-secret, stored in secrets.json for simplicity)
    OPENAI_MODEL: jsonSecrets.OPENAI_MODEL || 'gpt-5-nano',
    OPENAI_APPLY_MODE: jsonSecrets.OPENAI_APPLY_MODE || APPLY_MODES.FUTURE_ONLY
  };

  return secretsCache;
}

/**
 * Initialize secrets - call on server startup
 */
function initSecrets() {
  loadSecrets();
  console.log('[SecretManager] Secrets loaded');
  console.log('[SecretManager] Fireflies configured:', !!secretsCache.FIREFLIES_API_KEY);
  console.log('[SecretManager] Stripe configured:', !!secretsCache.STRIPE_API_KEY);
  console.log('[SecretManager] OpenAI configured:', !!secretsCache.OPENAI_API_KEY);
  console.log('[SecretManager] Calendly configured:', !!secretsCache.CALENDLY_API_KEY);
  console.log('[SecretManager] Slack configured:', !!secretsCache.SLACK_BOT_TOKEN);
  console.log('[SecretManager] Perplexity configured:', !!secretsCache.PERPLEXITY_API_KEY);
  console.log('[SecretManager] OpenAI model:', secretsCache.OPENAI_MODEL || 'gpt-4o');
}

/**
 * Get a secret by key name (for internal backend use only)
 * @param {string} keyName - The secret key name (e.g., 'FIREFLIES_API_KEY')
 * @returns {string|null} - The secret value or null
 */
function getSecret(keyName) {
  if (!secretsCache[keyName]) {
    loadSecrets();
  }
  return secretsCache[keyName] || null;
}

/**
 * Check if a specific API key is configured
 * @param {string} keyName - The secret key name
 * @returns {boolean} - True if configured
 */
function isConfigured(keyName) {
  const secret = getSecret(keyName);
  return !!secret && secret.length > 0;
}

/**
 * Get masked version of a key (for display in UI)
 * Shows first 4 and last 4 characters with asterisks in between
 * @param {string} keyName - The secret key name
 * @returns {string} - Masked key or 'Not configured'
 */
function getMaskedKey(keyName) {
  const secret = getSecret(keyName);

  if (!secret || secret.length === 0) {
    return 'Not configured';
  }

  if (secret.length <= 8) {
    return '****' + secret.slice(-2);
  }

  const first4 = secret.slice(0, 4);
  const last4 = secret.slice(-4);
  const middleLength = Math.min(secret.length - 8, 12);
  const asterisks = '*'.repeat(middleLength);

  return `${first4}${asterisks}${last4}`;
}

/**
 * Save a secret to secrets.json
 * @param {string} keyName - The secret key name
 * @param {string} value - The secret value
 * @returns {boolean} - Success status
 */
function saveSecret(keyName, value) {
  try {
    // Load existing secrets
    let secrets = {};
    if (fs.existsSync(SECRETS_JSON_PATH)) {
      const content = fs.readFileSync(SECRETS_JSON_PATH, 'utf8');
      secrets = JSON.parse(content);
    }

    // Update or add the secret
    secrets[keyName] = value;

    // Write back to file
    fs.writeFileSync(SECRETS_JSON_PATH, JSON.stringify(secrets, null, 2), 'utf8');

    // Update cache
    secretsCache[keyName] = value;

    console.log(`[SecretManager] Secret ${keyName} saved successfully`);
    return true;
  } catch (error) {
    console.error(`[SecretManager] Error saving secret ${keyName}:`, error.message);
    return false;
  }
}

/**
 * Delete a secret from secrets.json
 * @param {string} keyName - The secret key name
 * @returns {boolean} - Success status
 */
function deleteSecret(keyName) {
  try {
    if (!fs.existsSync(SECRETS_JSON_PATH)) {
      return true; // Nothing to delete
    }

    const content = fs.readFileSync(SECRETS_JSON_PATH, 'utf8');
    const secrets = JSON.parse(content);

    delete secrets[keyName];

    fs.writeFileSync(SECRETS_JSON_PATH, JSON.stringify(secrets, null, 2), 'utf8');

    // Update cache
    delete secretsCache[keyName];

    console.log(`[SecretManager] Secret ${keyName} deleted`);
    return true;
  } catch (error) {
    console.error(`[SecretManager] Error deleting secret ${keyName}:`, error.message);
    return false;
  }
}

/**
 * Get status of all integrations (for API response - NEVER returns actual keys)
 * @returns {Object} - Integration status with masked keys
 */
function getIntegrationStatus() {
  loadSecrets(); // Refresh cache

  return {
    fireflies: {
      configured: isConfigured('FIREFLIES_API_KEY'),
      maskedKey: getMaskedKey('FIREFLIES_API_KEY')
    },
    stripe: {
      configured: isConfigured('STRIPE_API_KEY'),
      maskedKey: getMaskedKey('STRIPE_API_KEY')
    },
    openai: {
      configured: isConfigured('OPENAI_API_KEY'),
      maskedKey: getMaskedKey('OPENAI_API_KEY'),
      model: secretsCache.OPENAI_MODEL || 'gpt-5-nano',
      applyMode: secretsCache.OPENAI_APPLY_MODE || APPLY_MODES.FUTURE_ONLY
    },
    calendly: {
      configured: isConfigured('CALENDLY_API_KEY'),
      maskedKey: getMaskedKey('CALENDLY_API_KEY')
    },
    slack: {
      configured: isConfigured('SLACK_BOT_TOKEN'),
      maskedKey: getMaskedKey('SLACK_BOT_TOKEN')
    },
    perplexity: {
      configured: isConfigured('PERPLEXITY_API_KEY'),
      maskedKey: getMaskedKey('PERPLEXITY_API_KEY')
    }
  };
}

/**
 * Get OpenAI configuration (model and apply mode)
 * @returns {Object} - OpenAI configuration
 */
function getOpenAIConfig() {
  loadSecrets(); // Refresh cache

  return {
    configured: isConfigured('OPENAI_API_KEY'),
    maskedKey: getMaskedKey('OPENAI_API_KEY'),
    model: secretsCache.OPENAI_MODEL || 'gpt-5-nano',
    applyMode: secretsCache.OPENAI_APPLY_MODE || APPLY_MODES.FUTURE_ONLY,
    availableModels: OPENAI_MODELS
  };
}

/**
 * Save OpenAI model configuration
 * @param {string} model - The model ID to use
 * @param {string} applyMode - The apply mode (future_only, rerun_all, rerun_last_day, rerun_last_week)
 * @returns {boolean} - Success status
 */
function saveOpenAIConfig(model, applyMode) {
  try {
    // Validate model
    const validModel = OPENAI_MODELS.find(m => m.id === model);
    if (!validModel) {
      console.error('[SecretManager] Invalid model:', model);
      return false;
    }

    // Validate apply mode
    const validModes = Object.values(APPLY_MODES);
    if (!validModes.includes(applyMode)) {
      console.error('[SecretManager] Invalid apply mode:', applyMode);
      return false;
    }

    // Load existing secrets
    let secrets = {};
    if (fs.existsSync(SECRETS_JSON_PATH)) {
      const content = fs.readFileSync(SECRETS_JSON_PATH, 'utf8');
      secrets = JSON.parse(content);
    }

    // Update configuration
    secrets.OPENAI_MODEL = model;
    secrets.OPENAI_APPLY_MODE = applyMode;

    // Write back to file
    fs.writeFileSync(SECRETS_JSON_PATH, JSON.stringify(secrets, null, 2), 'utf8');

    // Update cache
    secretsCache.OPENAI_MODEL = model;
    secretsCache.OPENAI_APPLY_MODE = applyMode;

    console.log(`[SecretManager] OpenAI config saved: model=${model}, applyMode=${applyMode}`);
    return true;
  } catch (error) {
    console.error('[SecretManager] Error saving OpenAI config:', error.message);
    return false;
  }
}

/**
 * Validate Fireflies API key by making a test request
 * @param {string} apiKey - The API key to test (optional, uses stored key if not provided)
 * @returns {Promise<Object>} - Validation result
 */
async function validateFirefliesKey(apiKey = null) {
  const key = apiKey || getSecret('FIREFLIES_API_KEY');

  if (!key) {
    return { valid: false, error: 'No API key provided' };
  }

  try {
    const response = await fetch('https://api.fireflies.ai/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        query: '{ user { email } }'
      })
    });

    const data = await response.json();

    if (data.errors) {
      return { valid: false, error: data.errors[0]?.message || 'Invalid API key' };
    }

    if (data.data?.user?.email) {
      return { valid: true, email: data.data.user.email };
    }

    return { valid: false, error: 'Unexpected response' };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Validate Stripe API key by making a test request
 * @param {string} apiKey - The API key to test (optional, uses stored key if not provided)
 * @returns {Promise<Object>} - Validation result
 */
async function validateStripeKey(apiKey = null) {
  const key = apiKey || getSecret('STRIPE_API_KEY');

  if (!key) {
    return { valid: false, error: 'No API key provided' };
  }

  try {
    // Use Stripe's balance endpoint as a simple validation test
    const response = await fetch('https://api.stripe.com/v1/balance', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${key}`
      }
    });

    if (response.status === 200) {
      return { valid: true };
    }

    if (response.status === 401) {
      return { valid: false, error: 'Invalid API key' };
    }

    const data = await response.json();
    return { valid: false, error: data.error?.message || 'Validation failed' };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Validate OpenAI API key by making a test request
 * @param {string} apiKey - The API key to test (optional, uses stored key if not provided)
 * @returns {Promise<Object>} - Validation result
 */
async function validateOpenAIKey(apiKey = null) {
  const key = apiKey || getSecret('OPENAI_API_KEY');

  if (!key) {
    return { valid: false, error: 'No API key provided' };
  }

  try {
    // Use OpenAI's models endpoint as a simple validation test
    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${key}`
      }
    });

    if (response.status === 200) {
      return { valid: true };
    }

    if (response.status === 401) {
      return { valid: false, error: 'Invalid API key' };
    }

    if (response.status === 429) {
      return { valid: false, error: 'Rate limited - too many requests. Please try again later.' };
    }

    if (response.status >= 500) {
      return { valid: false, error: `OpenAI server error (${response.status}). Please try again later.` };
    }

    // Try to get error details from response
    let errorMessage = `Unexpected response (${response.status})`;
    try {
      const data = await response.json();
      if (data.error?.message) {
        errorMessage = data.error.message;
      }
    } catch (parseError) {
      // Ignore JSON parse errors
    }

    return { valid: false, error: errorMessage };
  } catch (error) {
    // Network errors
    if (error.cause?.code === 'ENOTFOUND' || error.message.includes('ENOTFOUND')) {
      return { valid: false, error: 'Network error: Cannot reach OpenAI API' };
    }
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return { valid: false, error: 'Network error: Failed to connect to OpenAI API' };
    }
    return { valid: false, error: `Connection error: ${error.message}` };
  }
}

/**
 * Validate Perplexity API key by making a test request
 * @param {string} apiKey - The API key to test (optional, uses stored key if not provided)
 * @returns {Promise<Object>} - Validation result
 */
async function validatePerplexityKey(apiKey = null) {
  const key = apiKey || getSecret('PERPLEXITY_API_KEY');

  if (!key) {
    return { valid: false, error: 'No API key provided' };
  }

  try {
    // Make a minimal test request to Perplexity API
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 5
      })
    });

    // Check content type to avoid parsing HTML as JSON
    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');

    if (response.status === 200) {
      // Consume the response body to avoid issues
      if (isJson) {
        await response.json().catch(() => {});
      }
      return { valid: true };
    }

    if (response.status === 401) {
      return { valid: false, error: 'Invalid API key' };
    }

    if (response.status === 429) {
      return { valid: false, error: 'Rate limited - too many requests. Please try again later.' };
    }

    if (response.status >= 500) {
      return { valid: false, error: `Perplexity server error (${response.status}). Please try again later.` };
    }

    // Try to get error details from response
    let errorMessage = `Unexpected response (${response.status})`;
    if (isJson) {
      try {
        const data = await response.json();
        if (data.error?.message) {
          errorMessage = data.error.message;
        }
      } catch (parseError) {
        // Ignore JSON parse errors
      }
    } else {
      // Response is not JSON (might be HTML error page)
      const text = await response.text().catch(() => '');
      if (text.includes('<!DOCTYPE') || text.includes('<html')) {
        errorMessage = `Perplexity API returned an error page (${response.status}). The API may be unavailable.`;
      }
    }

    return { valid: false, error: errorMessage };
  } catch (error) {
    // Network errors
    if (error.cause?.code === 'ENOTFOUND' || error.message.includes('ENOTFOUND')) {
      return { valid: false, error: 'Network error: Cannot reach Perplexity API' };
    }
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return { valid: false, error: 'Network error: Failed to connect to Perplexity API' };
    }
    return { valid: false, error: `Connection error: ${error.message}` };
  }
}

/**
 * Get Perplexity configuration (prompt and tracked reps)
 * @returns {Object} - Perplexity configuration
 */
function getPerplexityConfig() {
  loadSecrets(); // Refresh cache

  let trackedReps = [];
  try {
    trackedReps = JSON.parse(secretsCache.LEAD_QUALITY_TRACKED_REPS || '[]');
  } catch (e) {
    trackedReps = [];
  }

  return {
    configured: isConfigured('PERPLEXITY_API_KEY'),
    maskedKey: getMaskedKey('PERPLEXITY_API_KEY'),
    prompt: secretsCache.PERPLEXITY_PROMPT || DEFAULT_PERPLEXITY_PROMPT,
    trackedReps
  };
}

/**
 * Save Perplexity prompt configuration
 * @param {string} prompt - The research prompt to use
 * @returns {boolean} - Success status
 */
function savePerplexityPrompt(prompt) {
  try {
    if (!prompt || typeof prompt !== 'string') {
      console.error('[SecretManager] Invalid prompt');
      return false;
    }

    // Load existing secrets
    let secrets = {};
    if (fs.existsSync(SECRETS_JSON_PATH)) {
      const content = fs.readFileSync(SECRETS_JSON_PATH, 'utf8');
      secrets = JSON.parse(content);
    }

    // Update configuration
    secrets.PERPLEXITY_PROMPT = prompt;

    // Write back to file
    fs.writeFileSync(SECRETS_JSON_PATH, JSON.stringify(secrets, null, 2), 'utf8');

    // Update cache
    secretsCache.PERPLEXITY_PROMPT = prompt;

    console.log('[SecretManager] Perplexity prompt saved');
    return true;
  } catch (error) {
    console.error('[SecretManager] Error saving Perplexity prompt:', error.message);
    return false;
  }
}

/**
 * Get transcript analysis prompts configuration
 * @returns {Object} - Transcript analysis prompts
 */
function getTranscriptAnalysisPrompts() {
  loadSecrets(); // Refresh cache

  const prompts = {};
  try {
    if (secretsCache.TRANSCRIPT_ANALYSIS_PROMPTS) {
      Object.assign(prompts, JSON.parse(secretsCache.TRANSCRIPT_ANALYSIS_PROMPTS));
    }
  } catch (e) {
    // Use defaults
  }

  return prompts;
}

/**
 * Save transcript analysis prompts
 * @param {Object} prompts - Object with prompt keys and values
 * @returns {boolean} - Success status
 */
function saveTranscriptAnalysisPrompts(prompts) {
  try {
    if (!prompts || typeof prompts !== 'object') {
      console.error('[SecretManager] Invalid prompts - must be object');
      return false;
    }

    // Load existing secrets
    let secrets = {};
    if (fs.existsSync(SECRETS_JSON_PATH)) {
      const content = fs.readFileSync(SECRETS_JSON_PATH, 'utf8');
      secrets = JSON.parse(content);
    }

    // Update configuration
    secrets.TRANSCRIPT_ANALYSIS_PROMPTS = JSON.stringify(prompts);

    // Write back to file
    fs.writeFileSync(SECRETS_JSON_PATH, JSON.stringify(secrets, null, 2), 'utf8');

    // Update cache
    secretsCache.TRANSCRIPT_ANALYSIS_PROMPTS = secrets.TRANSCRIPT_ANALYSIS_PROMPTS;

    console.log('[SecretManager] Transcript analysis prompts saved');
    return true;
  } catch (error) {
    console.error('[SecretManager] Error saving transcript prompts:', error.message);
    return false;
  }
}

/**
 * Save tracked reps for lead quality
 * @param {string[]} repEmails - Array of rep email addresses to track
 * @returns {boolean} - Success status
 */
function saveTrackedReps(repEmails) {
  try {
    if (!Array.isArray(repEmails)) {
      console.error('[SecretManager] Invalid tracked reps - must be array');
      return false;
    }

    // Load existing secrets
    let secrets = {};
    if (fs.existsSync(SECRETS_JSON_PATH)) {
      const content = fs.readFileSync(SECRETS_JSON_PATH, 'utf8');
      secrets = JSON.parse(content);
    }

    // Update configuration
    secrets.LEAD_QUALITY_TRACKED_REPS = JSON.stringify(repEmails);

    // Write back to file
    fs.writeFileSync(SECRETS_JSON_PATH, JSON.stringify(secrets, null, 2), 'utf8');

    // Update cache
    secretsCache.LEAD_QUALITY_TRACKED_REPS = JSON.stringify(repEmails);

    console.log('[SecretManager] Tracked reps saved:', repEmails);
    return true;
  } catch (error) {
    console.error('[SecretManager] Error saving tracked reps:', error.message);
    return false;
  }
}

module.exports = {
  initSecrets,
  getSecret,
  isConfigured,
  getMaskedKey,
  saveSecret,
  deleteSecret,
  getIntegrationStatus,
  validateFirefliesKey,
  validateStripeKey,
  validateOpenAIKey,
  validatePerplexityKey,
  getOpenAIConfig,
  saveOpenAIConfig,
  getPerplexityConfig,
  savePerplexityPrompt,
  saveTrackedReps,
  getTranscriptAnalysisPrompts,
  saveTranscriptAnalysisPrompts,
  KEY_TYPES,
  OPENAI_MODELS,
  APPLY_MODES,
  DEFAULT_PERPLEXITY_PROMPT,
  // For testing only
  _loadSecrets: loadSecrets,
  _ENV_LOCAL_PATH: ENV_LOCAL_PATH,
  _SECRETS_JSON_PATH: SECRETS_JSON_PATH
};
