/**
 * Dashboard Aggregation Service
 *
 * Aggregates insights across multiple analyzed calls to produce ranked lists.
 *
 * AGGREGATION METHOD:
 * ===================
 *
 * 1. COLLECTION: Query all analyzed transcripts from the database, applying filters:
 *    - Date range: Filter by call_datetime between start/end dates
 *    - Rep filter: Filter by rep_name (exact match, case-insensitive)
 *    - Keyword search: Search across transcript text for keyword (case-insensitive)
 *
 * 2. EXTRACTION: For each transcript, parse the analysis_json and extract:
 *    - insights.pains[] - Pain points with category, quote, intensity, urgency
 *    - insights.goals[] - Goals with goal text, priority, inferred_from
 *    - insights.questions[] - Questions with question text
 *    - insights.dislikes[] - Dislikes/objections with type, quote
 *    - insights.excitement_triggers[] - Triggers with trigger text, quote
 *
 * 3. NORMALIZATION: Group similar items together:
 *    - Pains: Group by category (e.g., "Manual Time Sink", "Platform Failures")
 *    - Goals: Group by exact goal text
 *    - Questions: Group by exact question text
 *    - Dislikes: Group by type + normalized quote (first 50 chars)
 *    - Excitement: Group by trigger text
 *
 * 4. COUNTING: For each unique item, count:
 *    - occurrences: Total times this item appeared across all calls
 *    - calls: Number of distinct calls mentioning this item
 *
 * 5. RANKING: Sort by occurrences (descending), then by calls (descending)
 *
 * 6. ENRICHMENT: Include sample quotes and source call info for context
 */

const transcriptDb = require('./transcriptDb');
const dbAdapter = require('./dbAdapter');

/**
 * Known sales rep names to filter out from quotes
 * These reps' quotes should be excluded from the Copy dashboard
 */
const KNOWN_REP_NAMES = ['phil', 'jamie', 'phil norris', 'jamie i.f.', 'jamie if'];

/**
 * Check if a quote likely came from a sales rep rather than a prospect
 * Uses multiple heuristics:
 * 1. Quote starts with rep-like phrases (selling/pitching language)
 * 2. Quote mentions "our product", "we can", "we offer" (rep perspective)
 * 3. Quote is a question that sounds like discovery questions reps ask
 *
 * @param {string} quote - The quote text to check
 * @returns {boolean} - True if quote appears to be from a rep
 */
function isRepQuote(quote) {
  if (!quote || typeof quote !== 'string') return false;

  const lowerQuote = quote.toLowerCase().trim();

  // Rep pitching/selling phrases (things reps say about their product)
  const repPhrases = [
    'our solution', 'our platform', 'our tool', 'our product', 'our service',
    'we can help', 'we offer', 'we provide', 'we have a', 'we do is',
    'what we do is', 'what we offer', 'let me show you', 'let me explain',
    'i can show you', 'i\'ll show you', 'i\'d love to show',
    'the way we work', 'how we work', 'how we help',
    'we\'ve helped', 'we\'ve worked with', 'our clients',
    'what affiliatefinder does', 'affiliatefinder can', 'affiliatefinder helps',
    'with our system', 'using our', 'through our platform',
    'we integrate', 'we automate', 'we handle'
  ];

  // Rep discovery question patterns (questions reps ask to qualify prospects)
  // These are specific phrasing reps use, NOT general questions
  const repQuestionPatterns = [
    'what are you currently using', 'how are you currently handling',
    'tell me about your', 'tell me more about your', 'can you tell me about your',
    'what\'s your biggest challenge', 'what are your biggest pain',
    'what would it mean for you', 'what would it mean if',
    'on a scale of 1', 'on a scale of one', 'from 1 to 10', 'rate your',
    'what have you tried so far', 'have you tried using', 'have you considered using',
    'what\'s preventing you', 'what\'s stopping you', 'what\'s holding you back',
    'when do you need this', 'what\'s your timeline for', 'what\'s your budget for',
    'who else is involved in', 'who\'s the decision maker', 'decision-making process',
    'walk me through', 'can you walk me', 'could you walk me'
  ];

  // Check for rep pitching phrases
  for (const phrase of repPhrases) {
    if (lowerQuote.includes(phrase)) {
      return true;
    }
  }

  // Check for rep question patterns (questions reps typically ask)
  for (const pattern of repQuestionPatterns) {
    if (lowerQuote.startsWith(pattern) || lowerQuote.includes(pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Filter an array of insights to exclude rep quotes
 * @param {Array} items - Array of insight items (pains, goals, etc.)
 * @param {string} quoteField - Name of the field containing the quote
 * @returns {Array} - Filtered array with only prospect quotes
 */
function filterProspectInsights(items, quoteField = 'quote') {
  if (!Array.isArray(items)) return [];

  return items.filter(item => {
    const quote = item[quoteField];
    return !isRepQuote(quote);
  });
}

/**
 * Get analyzed transcripts with optional filters
 * @param {Object} filters
 * @param {string} filters.startDate - Start date (YYYY-MM-DD format)
 * @param {string} filters.endDate - End date (YYYY-MM-DD format)
 * @param {string} filters.rep - Sales rep name
 * @param {string} filters.keyword - Keyword to search in transcript
 * @returns {Promise<Array>} - Array of transcripts with analysis
 */
async function getFilteredAnalyzedTranscripts(filters = {}) {
  // Build query with filters - using $1, $2, etc. for PostgreSQL compatibility
  let sql = `
    SELECT * FROM transcripts
    WHERE analysis_json IS NOT NULL
    AND analysis_version > 0
    AND deleted_at IS NULL
  `;
  const params = [];
  let paramIndex = 1;

  // Date range filter
  if (filters.startDate) {
    sql += ` AND call_datetime >= $${paramIndex}`;
    params.push(filters.startDate);
    paramIndex++;
  }
  if (filters.endDate) {
    sql += ` AND call_datetime <= $${paramIndex}`;
    // Add time to include full end date
    params.push(filters.endDate + 'T23:59:59Z');
    paramIndex++;
  }

  // Rep filter (case-insensitive)
  if (filters.rep) {
    sql += ` AND LOWER(rep_name) = LOWER($${paramIndex})`;
    params.push(filters.rep);
    paramIndex++;
  }

  // Keyword search in transcript text (case-insensitive)
  if (filters.keyword) {
    sql += ` AND LOWER(transcript_text) LIKE LOWER($${paramIndex})`;
    params.push(`%${filters.keyword}%`);
    paramIndex++;
  }

  sql += ' ORDER BY call_datetime DESC';

  const result = await dbAdapter.query(sql, params);

  if (!result.rows || !result.rows.length) return [];

  // Parse JSON fields in results
  return result.rows.map(row => parseJsonFields(row));
}

/**
 * Parse JSON fields in a transcript row
 */
function parseJsonFields(row) {
  const obj = { ...row };

  if (obj.participants && typeof obj.participants === 'string') {
    try {
      obj.participants = JSON.parse(obj.participants);
    } catch (e) {
      obj.participants = [];
    }
  }
  if (obj.analysis_json && typeof obj.analysis_json === 'string') {
    try {
      obj.analysis = JSON.parse(obj.analysis_json);
    } catch (e) {
      obj.analysis = null;
    }
  }
  return obj;
}

/**
 * Helper to convert SQL.js result to objects (legacy - kept for backward compatibility)
 */
function rowsToObjects(result) {
  const columns = result.columns;
  return result.values.map(row => {
    const obj = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    // Parse JSON fields
    if (obj.participants && typeof obj.participants === 'string') {
      try {
        obj.participants = JSON.parse(obj.participants);
      } catch (e) {
        obj.participants = [];
      }
    }
    if (obj.analysis_json && typeof obj.analysis_json === 'string') {
      try {
        obj.analysis = JSON.parse(obj.analysis_json);
      } catch (e) {
        obj.analysis = null;
      }
    }
    return obj;
  });
}

/**
 * Aggregate pain points across all calls
 * Groups by category and ranks by frequency
 *
 * @param {Array} transcripts - Analyzed transcripts
 * @returns {Array} - Ranked pain points
 */
function aggregatePains(transcripts) {
  const painMap = new Map();

  for (const transcript of transcripts) {
    if (!transcript.analysis?.insights?.pains) continue;

    // Filter out rep quotes - only include prospect statements
    const pains = filterProspectInsights(transcript.analysis.insights.pains, 'quote');
    const seenCategories = new Set(); // Track categories per call for call count

    for (const pain of pains) {
      const category = pain.category || 'Other';

      if (!painMap.has(category)) {
        painMap.set(category, {
          category,
          occurrences: 0,
          calls: 0,
          intensity: { High: 0, Medium: 0, Low: 0 },
          urgency: { immediate: 0, shortTerm: 0, longTerm: 0 },
          sampleQuotes: [],
          sourceCalls: []
        });
      }

      const entry = painMap.get(category);
      entry.occurrences++;

      // Track intensity distribution
      if (pain.intensity && entry.intensity[pain.intensity] !== undefined) {
        entry.intensity[pain.intensity]++;
      }

      // Track urgency distribution
      if (pain.urgency && entry.urgency[pain.urgency] !== undefined) {
        entry.urgency[pain.urgency]++;
      }

      // Add sample quote with source call info (max 3)
      if (pain.quote && entry.sampleQuotes.length < 3) {
        entry.sampleQuotes.push({
          text: pain.quote,
          callId: transcript.id,
          callTitle: transcript.call_title,
          callDate: transcript.call_datetime,
          rep: transcript.rep_name
        });
      }

      // Track unique calls mentioning this pain
      if (!seenCategories.has(category)) {
        seenCategories.add(category);
        entry.calls++;
        entry.sourceCalls.push({
          id: transcript.id,
          title: transcript.call_title,
          date: transcript.call_datetime,
          rep: transcript.rep_name
        });
      }
    }
  }

  // Convert to array and sort by occurrences, then by calls
  return Array.from(painMap.values())
    .sort((a, b) => {
      if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
      return b.calls - a.calls;
    })
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

/**
 * Aggregate goals across all calls
 * Groups by goal text and ranks by frequency
 */
function aggregateGoals(transcripts) {
  const goalMap = new Map();

  for (const transcript of transcripts) {
    if (!transcript.analysis?.insights?.goals) continue;

    // Filter out rep-sounding goals - only include prospect statements
    const goals = filterProspectInsights(transcript.analysis.insights.goals, 'goal');
    const seenGoals = new Set();

    for (const goal of goals) {
      const goalText = goal.goal || 'Unspecified goal';

      if (!goalMap.has(goalText)) {
        goalMap.set(goalText, {
          goal: goalText,
          occurrences: 0,
          calls: 0,
          priority: { high: 0, medium: 0, low: 0 },
          inferredFrom: new Set(),
          sourceCalls: []
        });
      }

      const entry = goalMap.get(goalText);
      entry.occurrences++;

      // Track priority distribution
      if (goal.priority && entry.priority[goal.priority] !== undefined) {
        entry.priority[goal.priority]++;
      }

      // Track what pains this goal was inferred from
      if (goal.inferred_from) {
        entry.inferredFrom.add(goal.inferred_from);
      }

      if (!seenGoals.has(goalText)) {
        seenGoals.add(goalText);
        entry.calls++;
        entry.sourceCalls.push({
          id: transcript.id,
          title: transcript.call_title,
          date: transcript.call_datetime,
          rep: transcript.rep_name
        });
      }
    }
  }

  return Array.from(goalMap.values())
    .map(item => ({
      ...item,
      inferredFrom: Array.from(item.inferredFrom) // Convert Set to Array
    }))
    .sort((a, b) => {
      if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
      return b.calls - a.calls;
    })
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

/**
 * Aggregate questions across all calls
 * Groups by question text and ranks by frequency
 */
function aggregateQuestions(transcripts) {
  const questionMap = new Map();

  for (const transcript of transcripts) {
    if (!transcript.analysis?.insights?.questions) continue;

    // Filter out rep questions - only include prospect questions
    const questions = filterProspectInsights(transcript.analysis.insights.questions, 'question');
    const seenQuestions = new Set();

    for (const q of questions) {
      const questionText = q.question || '';
      if (!questionText) continue;

      // Normalize question text (trim, lowercase for matching)
      const normalizedKey = questionText.trim().toLowerCase();

      if (!questionMap.has(normalizedKey)) {
        questionMap.set(normalizedKey, {
          question: questionText, // Keep original casing
          occurrences: 0,
          calls: 0,
          contexts: [],
          sourceCalls: []
        });
      }

      const entry = questionMap.get(normalizedKey);
      entry.occurrences++;

      // Track context (max 3)
      if (q.context && entry.contexts.length < 3) {
        entry.contexts.push(q.context);
      }

      if (!seenQuestions.has(normalizedKey)) {
        seenQuestions.add(normalizedKey);
        entry.calls++;
        entry.sourceCalls.push({
          id: transcript.id,
          title: transcript.call_title,
          date: transcript.call_datetime,
          rep: transcript.rep_name
        });
      }
    }
  }

  return Array.from(questionMap.values())
    .sort((a, b) => {
      if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
      return b.calls - a.calls;
    })
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

/**
 * Aggregate dislikes/objections across all calls
 * Groups by type and ranks by frequency
 */
function aggregateDislikes(transcripts) {
  const dislikeMap = new Map();

  for (const transcript of transcripts) {
    if (!transcript.analysis?.insights?.dislikes) continue;

    // Filter out rep quotes - only include prospect objections
    const dislikes = filterProspectInsights(transcript.analysis.insights.dislikes, 'quote');
    const seenTypes = new Set();

    for (const dislike of dislikes) {
      const type = dislike.type || 'General Objection';

      if (!dislikeMap.has(type)) {
        dislikeMap.set(type, {
          type,
          occurrences: 0,
          calls: 0,
          emotions: {},
          resolved: 0,
          unresolved: 0,
          sampleQuotes: [],
          sourceCalls: []
        });
      }

      const entry = dislikeMap.get(type);
      entry.occurrences++;

      // Track emotions
      if (dislike.emotion) {
        entry.emotions[dislike.emotion] = (entry.emotions[dislike.emotion] || 0) + 1;
      }

      // Track resolution
      if (dislike.resolved) {
        entry.resolved++;
      } else {
        entry.unresolved++;
      }

      // Add sample quote with source call info (max 3)
      if (dislike.quote && entry.sampleQuotes.length < 3) {
        entry.sampleQuotes.push({
          text: dislike.quote,
          callId: transcript.id,
          callTitle: transcript.call_title,
          callDate: transcript.call_datetime,
          rep: transcript.rep_name
        });
      }

      if (!seenTypes.has(type)) {
        seenTypes.add(type);
        entry.calls++;
        entry.sourceCalls.push({
          id: transcript.id,
          title: transcript.call_title,
          date: transcript.call_datetime,
          rep: transcript.rep_name
        });
      }
    }
  }

  return Array.from(dislikeMap.values())
    .sort((a, b) => {
      if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
      return b.calls - a.calls;
    })
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

/**
 * Aggregate excitement triggers across all calls
 * Groups by trigger text and ranks by frequency
 */
function aggregateExcitement(transcripts) {
  const excitementMap = new Map();

  for (const transcript of transcripts) {
    if (!transcript.analysis?.insights?.excitement_triggers) continue;

    // Filter out rep quotes - only include prospect excitement
    const triggers = filterProspectInsights(transcript.analysis.insights.excitement_triggers, 'quote');
    const seenTriggers = new Set();

    for (const t of triggers) {
      const triggerText = t.trigger || 'Unspecified';

      if (!excitementMap.has(triggerText)) {
        excitementMap.set(triggerText, {
          trigger: triggerText,
          occurrences: 0,
          calls: 0,
          sampleQuotes: [],
          sourceCalls: []
        });
      }

      const entry = excitementMap.get(triggerText);
      entry.occurrences++;

      // Add sample quote with source call info (max 3)
      if (t.quote && entry.sampleQuotes.length < 3) {
        entry.sampleQuotes.push({
          text: t.quote,
          callId: transcript.id,
          callTitle: transcript.call_title,
          callDate: transcript.call_datetime,
          rep: transcript.rep_name
        });
      }

      if (!seenTriggers.has(triggerText)) {
        seenTriggers.add(triggerText);
        entry.calls++;
        entry.sourceCalls.push({
          id: transcript.id,
          title: transcript.call_title,
          date: transcript.call_datetime,
          rep: transcript.rep_name
        });
      }
    }
  }

  return Array.from(excitementMap.values())
    .sort((a, b) => {
      if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
      return b.calls - a.calls;
    })
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

/**
 * Get dashboard aggregation with filters
 *
 * @param {Object} filters
 * @param {string} filters.startDate - Start date (YYYY-MM-DD)
 * @param {string} filters.endDate - End date (YYYY-MM-DD)
 * @param {string} filters.rep - Sales rep name filter
 * @param {string} filters.keyword - Keyword search filter
 * @param {number} filters.limit - Max items per category (default 10)
 * @returns {Object} - Aggregated insights
 */
async function getDashboardAggregation(filters = {}) {
  const { limit = 10 } = filters;

  // Get filtered transcripts
  const transcripts = await getFilteredAnalyzedTranscripts(filters);

  // Calculate summary stats
  const totalCalls = transcripts.length;
  const uniqueReps = new Set(transcripts.map(t => t.rep_name).filter(Boolean));

  // Aggregate each category
  const pains = aggregatePains(transcripts);
  const goals = aggregateGoals(transcripts);
  const questions = aggregateQuestions(transcripts);
  const dislikes = aggregateDislikes(transcripts);
  const excitement = aggregateExcitement(transcripts);

  return {
    summary: {
      totalCalls,
      analyzedCalls: totalCalls,
      uniqueReps: uniqueReps.size,
      repNames: Array.from(uniqueReps),
      filters: {
        startDate: filters.startDate || null,
        endDate: filters.endDate || null,
        rep: filters.rep || null,
        keyword: filters.keyword || null
      }
    },
    topPains: pains.slice(0, limit),
    topGoals: goals.slice(0, limit),
    topQuestions: questions.slice(0, limit),
    topDislikes: dislikes.slice(0, limit),
    topExcitement: excitement.slice(0, limit),
    totalCounts: {
      pains: pains.length,
      goals: goals.length,
      questions: questions.length,
      dislikes: dislikes.length,
      excitement: excitement.length
    }
  };
}

/**
 * Get list of unique sales reps for filter dropdown
 */
async function getUniqueReps() {
  const result = await dbAdapter.query(`
    SELECT DISTINCT rep_name FROM transcripts
    WHERE rep_name IS NOT NULL AND rep_name != ''
    AND deleted_at IS NULL
    ORDER BY rep_name
  `);

  if (!result.rows || !result.rows.length) return [];

  return result.rows.map(row => row.rep_name);
}

/**
 * Get date range of available calls
 */
async function getDateRange() {
  const result = await dbAdapter.query(`
    SELECT MIN(call_datetime) as earliest, MAX(call_datetime) as latest
    FROM transcripts
    WHERE analysis_json IS NOT NULL AND analysis_version > 0
    AND deleted_at IS NULL
  `);

  if (!result.rows || !result.rows.length) {
    return { earliest: null, latest: null };
  }

  return {
    earliest: result.rows[0].earliest,
    latest: result.rows[0].latest
  };
}

// ============================================
// Wording Extraction - Industry Terms, Problem Language, Power Words
// ============================================

/**
 * Industry-specific terms commonly used by prospects
 * These are domain/niche specific vocabulary
 */
const INDUSTRY_TERMS = [
  // Affiliate marketing terms
  'affiliate', 'affiliates', 'commission', 'commissions', 'payout', 'payouts',
  'conversion', 'conversions', 'traffic', 'clicks', 'impressions', 'ctr',
  'eps', 'epc', 'roi', 'roas', 'cpa', 'cpl', 'cpm', 'rev share', 'revshare',
  'attribution', 'tracking', 'cookies', 'pixel', 'postback', 'sub-id', 'subid',
  'offer', 'offers', 'network', 'networks', 'merchant', 'merchants',
  'publisher', 'publishers', 'advertiser', 'advertisers',
  // Outreach/recruiting terms
  'outreach', 'recruitment', 'recruiter', 'recruiting', 'pipeline', 'funnel',
  'prospects', 'prospecting', 'leads', 'lead gen', 'cold email', 'cold outreach',
  'sequence', 'sequences', 'follow-up', 'follow up', 'drip', 'cadence',
  // SaaS/business terms
  'saas', 'mrr', 'arr', 'churn', 'ltv', 'cac', 'onboarding', 'retention',
  'integration', 'api', 'automation', 'workflow', 'dashboard', 'analytics',
  'scaling', 'scale', 'scalable', 'bandwidth', 'capacity'
];

/**
 * Colloquial/emotional problem language
 * How people naturally express frustration or problems
 */
const PROBLEM_LANGUAGE_PATTERNS = [
  // Frustration expressions
  { pattern: /nightmare/gi, type: 'frustration' },
  { pattern: /headache/gi, type: 'frustration' },
  { pattern: /pain in the (ass|butt|neck)/gi, type: 'frustration' },
  { pattern: /pulling (my|our) hair out/gi, type: 'frustration' },
  { pattern: /drives? me crazy/gi, type: 'frustration' },
  { pattern: /sick (of|and tired of)/gi, type: 'frustration' },
  { pattern: /fed up/gi, type: 'frustration' },
  { pattern: /can't stand/gi, type: 'frustration' },
  // Overwhelm expressions
  { pattern: /drowning in/gi, type: 'overwhelm' },
  { pattern: /buried in/gi, type: 'overwhelm' },
  { pattern: /swamped/gi, type: 'overwhelm' },
  { pattern: /overwhelmed/gi, type: 'overwhelm' },
  { pattern: /too much on my plate/gi, type: 'overwhelm' },
  { pattern: /can't keep up/gi, type: 'overwhelm' },
  { pattern: /falling behind/gi, type: 'overwhelm' },
  // Waste/loss expressions
  { pattern: /wasting (time|money|hours)/gi, type: 'waste' },
  { pattern: /throwing money (away|down)/gi, type: 'waste' },
  { pattern: /burning through/gi, type: 'waste' },
  { pattern: /hemorrhaging/gi, type: 'waste' },
  { pattern: /bleeding money/gi, type: 'waste' },
  // Struggle expressions
  { pattern: /struggling (to|with)/gi, type: 'struggle' },
  { pattern: /fighting (to|against)/gi, type: 'struggle' },
  { pattern: /battle every/gi, type: 'struggle' },
  { pattern: /uphill battle/gi, type: 'struggle' }
];

/**
 * Power words - high-impact emotional vocabulary
 */
const POWER_WORDS = [
  // Urgency words
  'immediately', 'urgent', 'asap', 'critical', 'crucial', 'essential',
  'must-have', 'need', 'required', 'priority', 'deadline',
  // Impact words
  'transform', 'revolutionize', 'game-changer', 'breakthrough', 'massive',
  'huge', 'incredible', 'amazing', 'unbelievable', 'phenomenal',
  // Fear/risk words
  'risk', 'danger', 'threat', 'vulnerable', 'exposed', 'losing', 'miss out',
  'falling behind', 'competitors', 'competition',
  // Value words
  'save', 'profit', 'revenue', 'growth', 'results', 'success', 'win',
  'opportunity', 'advantage', 'edge', 'leverage'
];

/**
 * Extract industry terms from all quotes
 */
function aggregateIndustryTerms(transcripts) {
  const termCounts = new Map();

  for (const transcript of transcripts) {
    const analysis = parseAnalysisJson(transcript.analysis_json);
    if (!analysis) continue;

    const allQuotes = extractAllQuotes(analysis);
    const seenTermsInCall = new Set();

    for (const quoteObj of allQuotes) {
      const quote = quoteObj.quote || quoteObj.text || '';
      if (isRepQuote(quote)) continue;

      const lowerQuote = quote.toLowerCase();

      for (const term of INDUSTRY_TERMS) {
        const regex = new RegExp(`\\b${term}\\b`, 'gi');
        if (regex.test(lowerQuote)) {
          const key = term.toLowerCase();

          if (!termCounts.has(key)) {
            termCounts.set(key, {
              term: term,
              count: 0,
              callCount: 0,
              quotes: [],
              sources: []
            });
          }

          const entry = termCounts.get(key);
          entry.count++;

          if (!seenTermsInCall.has(key)) {
            entry.callCount++;
            seenTermsInCall.add(key);
          }

          if (entry.quotes.length < 3) {
            entry.quotes.push({
              text: quote.substring(0, 200),
              callId: transcript.fireflies_id,
              callTitle: transcript.title,
              callDate: transcript.call_datetime,
              rep: transcript.rep_name
            });
          }
        }
      }
    }
  }

  // Sort by count descending
  return Array.from(termCounts.values())
    .sort((a, b) => b.count - a.count || b.callCount - a.callCount);
}

/**
 * Extract colloquial problem language from quotes
 */
function aggregateProblemLanguage(transcripts) {
  const phraseMatches = [];

  for (const transcript of transcripts) {
    const analysis = parseAnalysisJson(transcript.analysis_json);
    if (!analysis) continue;

    const allQuotes = extractAllQuotes(analysis);

    for (const quoteObj of allQuotes) {
      const quote = quoteObj.quote || quoteObj.text || '';
      if (isRepQuote(quote)) continue;

      for (const { pattern, type } of PROBLEM_LANGUAGE_PATTERNS) {
        const matches = quote.match(pattern);
        if (matches) {
          for (const match of matches) {
            const key = match.toLowerCase();
            const existing = phraseMatches.find(p => p.phrase.toLowerCase() === key);

            if (existing) {
              existing.count++;
              if (existing.quotes.length < 3) {
                existing.quotes.push({
                  text: quote.substring(0, 200),
                  callId: transcript.fireflies_id,
                  callTitle: transcript.title,
                  callDate: transcript.call_datetime,
                  rep: transcript.rep_name
                });
              }
            } else {
              phraseMatches.push({
                phrase: match,
                type: type,
                count: 1,
                quotes: [{
                  text: quote.substring(0, 200),
                  callId: transcript.fireflies_id,
                  callTitle: transcript.title,
                  callDate: transcript.call_datetime,
                  rep: transcript.rep_name
                }]
              });
            }
          }
        }
      }
    }
  }

  return phraseMatches.sort((a, b) => b.count - a.count);
}

/**
 * Extract power words from quotes
 */
function aggregatePowerWords(transcripts) {
  const wordCounts = new Map();

  for (const transcript of transcripts) {
    const analysis = parseAnalysisJson(transcript.analysis_json);
    if (!analysis) continue;

    const allQuotes = extractAllQuotes(analysis);
    const seenWordsInCall = new Set();

    for (const quoteObj of allQuotes) {
      const quote = quoteObj.quote || quoteObj.text || '';
      if (isRepQuote(quote)) continue;

      const lowerQuote = quote.toLowerCase();

      for (const word of POWER_WORDS) {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        if (regex.test(lowerQuote)) {
          const key = word.toLowerCase();

          if (!wordCounts.has(key)) {
            wordCounts.set(key, {
              word: word,
              count: 0,
              callCount: 0,
              quotes: []
            });
          }

          const entry = wordCounts.get(key);
          entry.count++;

          if (!seenWordsInCall.has(key)) {
            entry.callCount++;
            seenWordsInCall.add(key);
          }

          if (entry.quotes.length < 3) {
            entry.quotes.push({
              text: quote.substring(0, 200),
              callId: transcript.fireflies_id,
              callTitle: transcript.title,
              callDate: transcript.call_datetime,
              rep: transcript.rep_name
            });
          }
        }
      }
    }
  }

  return Array.from(wordCounts.values())
    .sort((a, b) => b.count - a.count || b.callCount - a.callCount);
}

// ============================================
// Metaphor & Analogy Extraction
// ============================================

/**
 * Patterns that indicate metaphors and analogies
 */
const METAPHOR_PATTERNS = [
  { pattern: /it's like/gi, type: 'simile' },
  { pattern: /feels like/gi, type: 'simile' },
  { pattern: /kind of like/gi, type: 'simile' },
  { pattern: /sort of like/gi, type: 'simile' },
  { pattern: /similar to/gi, type: 'comparison' },
  { pattern: /reminds me of/gi, type: 'comparison' },
  { pattern: /as if/gi, type: 'simile' },
  { pattern: /as though/gi, type: 'simile' },
  { pattern: /imagine if/gi, type: 'analogy' },
  { pattern: /think of it as/gi, type: 'analogy' },
  { pattern: /same as/gi, type: 'comparison' },
  { pattern: /compared to/gi, type: 'comparison' },
  { pattern: /versus|vs\./gi, type: 'comparison' }
];

/**
 * Extract metaphors and analogies from quotes
 */
function aggregateMetaphors(transcripts) {
  const metaphors = [];

  for (const transcript of transcripts) {
    const analysis = parseAnalysisJson(transcript.analysis_json);
    if (!analysis) continue;

    const allQuotes = extractAllQuotes(analysis);

    for (const quoteObj of allQuotes) {
      const quote = quoteObj.quote || quoteObj.text || '';
      if (isRepQuote(quote)) continue;

      for (const { pattern, type } of METAPHOR_PATTERNS) {
        if (pattern.test(quote)) {
          // Reset regex lastIndex
          pattern.lastIndex = 0;

          // Extract context around the metaphor marker
          const match = quote.match(pattern);
          if (match) {
            const index = quote.toLowerCase().indexOf(match[0].toLowerCase());
            const start = Math.max(0, index - 30);
            const end = Math.min(quote.length, index + match[0].length + 80);
            const excerpt = (start > 0 ? '...' : '') +
              quote.substring(start, end) +
              (end < quote.length ? '...' : '');

            metaphors.push({
              type: type,
              marker: match[0],
              excerpt: excerpt,
              fullQuote: quote.substring(0, 250),
              callId: transcript.fireflies_id,
              callTitle: transcript.title,
              callDate: transcript.call_datetime,
              rep: transcript.rep_name
            });
          }
          break; // Only count one metaphor per quote
        }
      }
    }
  }

  // Group by similar excerpts and count
  const grouped = new Map();
  for (const m of metaphors) {
    // Use first 50 chars of excerpt as key for grouping similar metaphors
    const key = m.excerpt.substring(0, 50).toLowerCase();
    if (!grouped.has(key)) {
      grouped.set(key, {
        type: m.type,
        marker: m.marker,
        excerpt: m.excerpt,
        count: 0,
        examples: []
      });
    }
    const entry = grouped.get(key);
    entry.count++;
    if (entry.examples.length < 3) {
      entry.examples.push({
        fullQuote: m.fullQuote,
        callId: m.callId,
        callTitle: m.callTitle,
        callDate: m.callDate,
        rep: m.rep
      });
    }
  }

  return Array.from(grouped.values())
    .sort((a, b) => b.count - a.count);
}

/**
 * Helper: Parse analysis JSON safely
 */
function parseAnalysisJson(jsonStr) {
  if (!jsonStr) return null;
  try {
    return typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
  } catch (e) {
    return null;
  }
}

/**
 * Helper: Extract all quotes from an analysis object
 */
function extractAllQuotes(analysis) {
  const quotes = [];

  // Pain points
  if (analysis.insights?.pains) {
    for (const pain of analysis.insights.pains) {
      if (pain.quote) quotes.push({ quote: pain.quote, type: 'pain' });
    }
  }

  // Goals
  if (analysis.insights?.goals) {
    for (const goal of analysis.insights.goals) {
      if (goal.evidence) quotes.push({ quote: goal.evidence, type: 'goal' });
    }
  }

  // Questions
  if (analysis.insights?.questions) {
    for (const q of analysis.insights.questions) {
      if (q.question) quotes.push({ quote: q.question, type: 'question' });
    }
  }

  // Dislikes/Objections
  if (analysis.insights?.dislikes) {
    for (const dislike of analysis.insights.dislikes) {
      if (dislike.quote) quotes.push({ quote: dislike.quote, type: 'dislike' });
    }
  }

  // Excitement triggers
  if (analysis.insights?.excitement_triggers) {
    for (const trigger of analysis.insights.excitement_triggers) {
      if (trigger.quote) quotes.push({ quote: trigger.quote, type: 'excitement' });
    }
  }

  return quotes;
}

/**
 * Get wording aggregation (all three categories)
 */
async function getWordingAggregation(filters = {}) {
  const transcripts = await getFilteredAnalyzedTranscripts(filters);

  return {
    industryTerms: aggregateIndustryTerms(transcripts),
    problemLanguage: aggregateProblemLanguage(transcripts),
    powerWords: aggregatePowerWords(transcripts)
  };
}

/**
 * Get metaphors aggregation
 */
async function getMetaphorsAggregation(filters = {}) {
  const transcripts = await getFilteredAnalyzedTranscripts(filters);
  return aggregateMetaphors(transcripts);
}

module.exports = {
  getDashboardAggregation,
  getFilteredAnalyzedTranscripts,
  aggregatePains,
  aggregateGoals,
  aggregateQuestions,
  aggregateDislikes,
  aggregateExcitement,
  getUniqueReps,
  getDateRange,
  getWordingAggregation,
  getMetaphorsAggregation,
  aggregateIndustryTerms,
  aggregateProblemLanguage,
  aggregatePowerWords,
  aggregateMetaphors
};
