/**
 * LLM Service
 * Wrapper for LLM API calls (OpenAI) with token tracking and cost calculation
 */

const secretManager = require('./secretManager');

// Token costs per model (as of 2024, prices in USD per 1K tokens)
// Note: gpt-5-mini and gpt-5-nano costs are placeholders - update when OpenAI publishes pricing
const MODEL_COSTS = {
  'gpt-5-mini': { input: 0.001, output: 0.004 },    // Estimated: $1.00/$4.00 per 1M
  'gpt-5-nano': { input: 0.0001, output: 0.0004 },  // Estimated: $0.10/$0.40 per 1M
  'gpt-4o': { input: 0.0025, output: 0.01 },        // $2.50/$10 per 1M
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 }, // $0.15/$0.60 per 1M
  'gpt-4-turbo': { input: 0.01, output: 0.03 },      // $10/$30 per 1M
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 } // $0.50/$1.50 per 1M
};

// Default model if none configured
const DEFAULT_MODEL = 'gpt-5-nano';

// Valid models (must match secretManager.OPENAI_MODELS)
const VALID_MODELS = Object.keys(MODEL_COSTS);

/**
 * Get the configured OpenAI API key
 * @returns {string|null} - API key or null
 */
function getApiKey() {
  return secretManager.getSecret('OPENAI_API_KEY');
}

/**
 * Get the configured model
 * @returns {string} - Model ID
 */
function getConfiguredModel() {
  const config = secretManager.getOpenAIConfig();
  return config.model || DEFAULT_MODEL;
}

/**
 * Check if LLM is configured and ready
 * @returns {boolean} - True if API key is set
 */
function isConfigured() {
  return secretManager.isConfigured('OPENAI_API_KEY');
}

/**
 * Validate that a model name is supported
 * @param {string} model - Model ID to validate
 * @returns {{valid: boolean, error?: string}} - Validation result
 */
function validateModel(model) {
  if (!model || typeof model !== 'string') {
    return { valid: false, error: 'Model name is required and must be a string' };
  }

  if (!VALID_MODELS.includes(model)) {
    return {
      valid: false,
      error: `Invalid model: "${model}". Valid models are: ${VALID_MODELS.join(', ')}`
    };
  }

  return { valid: true };
}

/**
 * Sleep for a specified number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate cost for token usage
 * @param {string} model - Model ID
 * @param {number} inputTokens - Input token count
 * @param {number} outputTokens - Output token count
 * @returns {number} - Cost in cents
 */
function calculateCost(model, inputTokens, outputTokens) {
  const costs = MODEL_COSTS[model] || MODEL_COSTS[DEFAULT_MODEL];
  const inputCost = (inputTokens / 1000) * costs.input;
  const outputCost = (outputTokens / 1000) * costs.output;
  // Return cost in cents (multiply by 100)
  return Math.round((inputCost + outputCost) * 100 * 100) / 100;
}

/**
 * Make a chat completion request to OpenAI with retry logic
 * @param {Object} options - Request options
 * @param {string} options.systemPrompt - System prompt
 * @param {string} options.userPrompt - User prompt
 * @param {string} options.model - Model override (optional)
 * @param {number} options.maxTokens - Max output tokens (default 2000)
 * @param {number} options.temperature - Temperature (default 0.3)
 * @param {number} options.maxRetries - Max retry attempts for transient failures (default 3)
 * @returns {Promise<Object>} - Response with content and token usage
 */
async function chatCompletion(options) {
  const {
    systemPrompt,
    userPrompt,
    model = getConfiguredModel(),
    maxTokens = 2000,
    temperature = 0.3,
    maxRetries = 3
  } = options;

  // Validate model - reject invalid models with clear error
  const modelValidation = validateModel(model);
  if (!modelValidation.valid) {
    throw new Error(modelValidation.error);
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('OpenAI API key not configured');
  }

  // Determine which parameters to use based on model
  // Newer reasoning models (gpt-5-*, o1-*, o3-*) have different parameter requirements:
  // - Use max_completion_tokens instead of max_tokens
  // - Only support temperature = 1 (default)
  // - Need higher token limits because they use reasoning_tokens internally
  const isReasoningModel = model.startsWith('gpt-5') || model.startsWith('o1') || model.startsWith('o3');

  const requestBody = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  };

  // Add temperature only for models that support it (not reasoning models)
  if (!isReasoningModel) {
    requestBody.temperature = temperature;
  }

  // Add the appropriate token limit parameter
  // For reasoning models, increase the limit to account for internal reasoning tokens
  if (isReasoningModel) {
    // Reasoning models need extra tokens for internal reasoning before generating output
    // Multiply by 4 to ensure enough room for both reasoning and output
    requestBody.max_completion_tokens = Math.max(maxTokens * 4, 10000);
  } else {
    requestBody.max_tokens = maxTokens;
  }

  let lastError = null;
  let attempt = 0;

  while (attempt < maxRetries) {
    attempt++;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      });

      // Handle rate limiting (429) with exponential backoff
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.pow(2, attempt) * 1000;

        if (attempt < maxRetries) {
          console.log(`[LLM] Rate limited (429), retry ${attempt}/${maxRetries} after ${waitTime}ms`);
          await sleep(waitTime);
          continue;
        }

        return {
          success: false,
          error: 'Rate limited - please try again later',
          isRateLimit: true,
          model
        };
      }

      // Handle server errors (5xx) with exponential backoff
      if (response.status >= 500) {
        const waitTime = Math.pow(2, attempt) * 1000;

        if (attempt < maxRetries) {
          console.log(`[LLM] Server error (${response.status}), retry ${attempt}/${maxRetries} after ${waitTime}ms`);
          await sleep(waitTime);
          continue;
        }

        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || `Server error (${response.status})`;
        throw new Error(`OpenAI API error: ${errorMessage}`);
      }

      // Handle authentication errors (401) - no retry
      if (response.status === 401) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || 'Invalid API key';
        return {
          success: false,
          error: `Authentication failed: ${errorMessage}`,
          isAuthError: true,
          model
        };
      }

      // Handle other client errors (4xx) - no retry
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || `HTTP ${response.status}`;
        throw new Error(`OpenAI API error: ${errorMessage}`);
      }

      const data = await response.json();

      // Extract usage info
      const usage = data.usage || {};
      const inputTokens = usage.prompt_tokens || 0;
      const outputTokens = usage.completion_tokens || 0;
      const totalTokens = usage.total_tokens || inputTokens + outputTokens;
      const costCents = calculateCost(model, inputTokens, outputTokens);

      // Extract content
      const content = data.choices?.[0]?.message?.content || '';

      return {
        success: true,
        content,
        model,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens,
          costCents
        }
      };

    } catch (error) {
      lastError = error;

      // Network errors - retry with backoff
      if (error.name === 'TypeError' || error.message.includes('fetch') || error.message.includes('ENOTFOUND')) {
        const waitTime = Math.pow(2, attempt) * 1000;

        if (attempt < maxRetries) {
          console.log(`[LLM] Network error, retry ${attempt}/${maxRetries} after ${waitTime}ms: ${error.message}`);
          await sleep(waitTime);
          continue;
        }
      }

      // Non-retryable errors - throw immediately
      throw error;
    }
  }

  // All retries exhausted
  throw lastError || new Error('Max retries exceeded');
}

/**
 * Parse JSON from LLM response (handles markdown code blocks)
 * @param {string} content - LLM response content
 * @returns {Object} - Parsed JSON
 */
function parseJsonResponse(content) {
  if (!content) {
    throw new Error('Empty response content');
  }

  // Remove markdown code blocks if present
  let jsonStr = content.trim();
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.slice(7);
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.slice(3);
  }
  if (jsonStr.endsWith('```')) {
    jsonStr = jsonStr.slice(0, -3);
  }

  try {
    return JSON.parse(jsonStr.trim());
  } catch (e) {
    throw new Error(`Failed to parse JSON: ${e.message}`);
  }
}

/**
 * Get model costs info
 * @returns {Object} - Model costs
 */
function getModelCosts() {
  return MODEL_COSTS;
}

module.exports = {
  chatCompletion,
  parseJsonResponse,
  calculateCost,
  isConfigured,
  getConfiguredModel,
  getModelCosts,
  validateModel,
  MODEL_COSTS,
  DEFAULT_MODEL,
  VALID_MODELS
};
