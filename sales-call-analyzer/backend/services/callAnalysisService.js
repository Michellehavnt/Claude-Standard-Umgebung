/**
 * Call Analysis Service
 * Coordinates analysis of call transcripts and storage of results
 * Supports both rule-based (heuristic) and LLM-based analysis
 */

const { analyzeTranscript, isSalesCall, parseCallTitle } = require('./analyzer');
const transcriptDb = require('./transcriptDb');
const { addDFYPitchesToAnalysis } = require('./dfyPitchService');
const { addDFYQualificationToAnalysis } = require('./dfyQualificationService');
const llmService = require('./llmService');
const {
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisPrompt,
  validateAnalysisResponse,
  transformToExistingFormat
} = require('./llmAnalysisPrompts');
const secretManager = require('./secretManager');

// Current analysis version - increment when analysis logic changes
const ANALYSIS_VERSION = 2; // Bumped for LLM analysis support

// Analysis modes
const ANALYSIS_MODE = {
  HEURISTIC: 'heuristic',  // Rule-based (original)
  LLM: 'llm'               // OpenAI LLM-based
};

/**
 * Parse transcript text into sentences array
 * Handles the format: "Speaker: text\nSpeaker: text"
 */
function parseTranscriptText(transcriptText) {
  if (!transcriptText) return [];

  const lines = transcriptText.split('\n').filter(line => line.trim());
  const sentences = [];

  for (const line of lines) {
    const match = line.match(/^([^:]+):\s*(.+)$/);
    if (match) {
      sentences.push({
        speaker_name: match[1].trim(),
        text: match[2].trim(),
        start_time: null // Not available from text format
      });
    }
  }

  return sentences;
}

/**
 * Extract structured insights from analysis
 * Returns the five main insight categories
 */
function extractInsights(analysis) {
  return {
    pains: extractPainsFromAnalysis(analysis),
    goals: extractGoalsFromAnalysis(analysis),
    questions: extractQuestionsFromAnalysis(analysis),
    dislikes: extractDislikesFromAnalysis(analysis),
    excitement_triggers: extractExcitementFromAnalysis(analysis)
  };
}

/**
 * Extract pain points as flat array
 */
function extractPainsFromAnalysis(analysis) {
  const pains = [];
  const painPoints = analysis.painPoints || {};

  for (const urgency of ['immediate', 'shortTerm', 'longTerm']) {
    const items = painPoints[urgency] || [];
    for (const item of items) {
      pains.push({
        category: item.category,
        quote: item.quote,
        intensity: item.intensity,
        urgency: urgency,
        timestamp: item.timestamp,
        context: item.context
      });
    }
  }

  return pains;
}

/**
 * Extract goals from prospect statements
 * Goals are inferred from pain points and explicit goal statements
 */
function extractGoalsFromAnalysis(analysis) {
  const goals = [];

  // Infer goals from pain points (inverse of pain)
  const painPoints = analysis.painPoints || {};
  const painCategories = [
    ...(painPoints.immediate || []),
    ...(painPoints.shortTerm || []),
    ...(painPoints.longTerm || [])
  ];

  const goalMappings = {
    'Manual Time Sink': 'Automate manual processes and save time',
    'CAPTCHA Frustration': 'Bypass verification barriers smoothly',
    'Platform Failures': 'Find a reliable platform that actually works',
    'Affiliates Disappearing': 'Retain and engage affiliates long-term',
    'Scaling Difficulties': 'Scale affiliate program efficiently',
    'Niche Market Challenge': 'Find affiliates in specialized market',
    'Poor Quality Results': 'Attract high-quality, relevant affiliates',
    'Competitive Pressure': 'Stay ahead of competitors',
    'Resource Constraints': 'Achieve more with limited resources',
    'Lack of Data Visibility': 'Get clear visibility into affiliate performance',
    'Outreach Challenges': 'Improve affiliate outreach effectiveness',
    'Affiliate Management': 'Streamline affiliate management'
  };

  const seenGoals = new Set();
  for (const pain of painCategories) {
    const goalText = goalMappings[pain.category];
    if (goalText && !seenGoals.has(goalText)) {
      seenGoals.add(goalText);
      goals.push({
        goal: goalText,
        inferred_from: pain.category,
        evidence: pain.quote?.substring(0, 100),
        priority: pain.intensity === 'High' ? 'high' : 'medium'
      });
    }
  }

  return goals;
}

/**
 * Extract questions asked by the prospect
 */
function extractQuestionsFromAnalysis(analysis) {
  // Questions would ideally come from parsing the transcript for "?" marks
  // from prospect speakers. For now, we'll extract from key moments if available
  const questions = [];
  const keyMoments = analysis.keyMoments || [];

  for (const moment of keyMoments) {
    if (moment.quote && moment.quote.includes('?')) {
      questions.push({
        question: moment.quote,
        timestamp: moment.timestamp,
        context: moment.event
      });
    }
  }

  return questions;
}

/**
 * Extract dislikes/objections
 */
function extractDislikesFromAnalysis(analysis) {
  const dislikes = [];
  const objections = analysis.objections || [];

  for (const obj of objections) {
    dislikes.push({
      type: obj.type,
      quote: obj.quote,
      emotion: obj.emotionalUndertone,
      resolved: obj.outcome === 'Accepted'
    });
  }

  // Also extract from pain points mentioning specific tools/competitors
  const painPoints = analysis.painPoints || {};
  const allPains = [
    ...(painPoints.immediate || []),
    ...(painPoints.shortTerm || []),
    ...(painPoints.longTerm || [])
  ];

  for (const pain of allPains) {
    if (pain.category === 'Platform Failures') {
      dislikes.push({
        type: 'Tool/Platform',
        quote: pain.quote,
        emotion: pain.intensity === 'High' ? 'Frustration' : 'Disappointment',
        resolved: false
      });
    }
  }

  return dislikes;
}

/**
 * Extract excitement triggers
 */
function extractExcitementFromAnalysis(analysis) {
  const triggers = analysis.excitementTriggers || [];

  return triggers.map(t => ({
    trigger: t.trigger,
    quote: t.quote,
    timestamp: t.timestamp
  }));
}

/**
 * Determine which analysis mode to use
 * @returns {string} - 'llm' if configured and enabled, 'heuristic' otherwise
 */
function getAnalysisMode() {
  // Check if OpenAI is configured
  if (!llmService.isConfigured()) {
    return ANALYSIS_MODE.HEURISTIC;
  }

  // Check if LLM analysis is enabled in settings
  const config = secretManager.getOpenAIConfig();
  // Default to LLM if configured, unless explicitly disabled
  return config.enabled === false ? ANALYSIS_MODE.HEURISTIC : ANALYSIS_MODE.LLM;
}

/**
 * Analyze transcript using LLM
 * @param {Object} transcript - Transcript data
 * @param {string} transcriptText - Full transcript text
 * @returns {Promise<Object>} - Analysis result with token usage
 */
async function analyzeWithLLM(transcript, transcriptText) {
  const { prospect, rep } = parseCallTitle(transcript.call_title);

  // Build the prompt
  const userPrompt = buildAnalysisPrompt({
    title: transcript.call_title,
    transcript: transcriptText,
    prospectName: prospect,
    repName: rep || transcript.rep_name
  });

  // Call OpenAI
  const llmResponse = await llmService.chatCompletion({
    systemPrompt: ANALYSIS_SYSTEM_PROMPT,
    userPrompt: userPrompt,
    maxTokens: 2500,
    temperature: 0.2  // Lower temperature for more consistent structured output
  });

  if (!llmResponse.success) {
    throw new Error(llmResponse.error || 'LLM analysis failed');
  }

  // Parse the JSON response
  const llmAnalysis = llmService.parseJsonResponse(llmResponse.content);

  // Validate the response structure
  const validation = validateAnalysisResponse(llmAnalysis);
  if (!validation.valid) {
    console.warn('[CallAnalysis] LLM response validation warnings:', validation.errors);
    // Continue anyway - we'll work with what we got
  }

  // Transform to match existing format
  const transformedAnalysis = transformToExistingFormat(llmAnalysis);

  return {
    analysis: transformedAnalysis,
    llmRaw: llmAnalysis,
    usage: llmResponse.usage,
    model: llmResponse.model
  };
}

/**
 * Analyze a single transcript
 * @param {string} transcriptId - Internal transcript ID
 * @param {Object} options - Analysis options
 * @param {boolean} options.force - Force re-analysis even if already done
 * @param {string} options.mode - Force specific mode ('llm' or 'heuristic')
 * @returns {Object} - Analysis results
 */
async function analyzeCall(transcriptId, options = {}) {
  const { force = false, mode = null } = options;

  // Check if already analyzed (unless forced)
  if (!force) {
    const existing = await transcriptDb.hasAnalysis(transcriptId, ANALYSIS_VERSION);
    if (existing) {
      const stored = await transcriptDb.getAnalysis(transcriptId);
      return {
        success: true,
        skipped: true,
        message: 'Already analyzed',
        analysis: stored.analysis,
        analyzedAt: stored.analyzedAt
      };
    }
  }

  // Get transcript
  const transcript = await transcriptDb.getTranscriptById(transcriptId);
  if (!transcript) {
    return {
      success: false,
      error: 'Transcript not found'
    };
  }

  // Check if it has transcript text
  if (!transcript.transcript_text) {
    return {
      success: false,
      error: 'No transcript text available'
    };
  }

  // Check if it's a sales call (skip internal meetings)
  if (!isSalesCall(transcript.call_title)) {
    // Store empty analysis to avoid re-checking
    const emptyAnalysis = {
      skipped: true,
      reason: 'Not a sales call',
      insights: null
    };
    await transcriptDb.saveAnalysis(transcriptId, emptyAnalysis, ANALYSIS_VERSION);
    return {
      success: true,
      skipped: true,
      message: 'Skipped - not a sales call',
      analysis: emptyAnalysis
    };
  }

  // Determine analysis mode
  const analysisMode = mode || getAnalysisMode();
  let analysis;
  let tokenUsage = null;

  if (analysisMode === ANALYSIS_MODE.LLM) {
    // LLM-based analysis
    try {
      console.log(`[CallAnalysis] Using LLM analysis for transcript ${transcriptId}`);
      const llmResult = await analyzeWithLLM(transcript, transcript.transcript_text);

      // Build final analysis object with LLM results
      analysis = {
        version: ANALYSIS_VERSION,
        analyzedAt: new Date().toISOString(),
        analysisMode: ANALYSIS_MODE.LLM,
        callId: transcript.id,
        callTitle: transcript.call_title,
        callDate: transcript.call_datetime,
        duration: transcript.duration_seconds,
        repName: transcript.rep_name,

        // Core insights from LLM
        insights: llmResult.analysis.insights,

        // Additional analysis data
        prospectProfile: llmResult.analysis.prospectProfile || {},
        outcome: llmResult.analysis.outcome,
        overallScore: llmResult.analysis.overallScore,
        keyMoments: llmResult.analysis.keyMoments || [],
        dfyAnalysis: llmResult.analysis.dfyAnalysis || {},
        callSummary: llmResult.analysis.callSummary,

        // Metadata
        prospectName: transcript.call_title ? parseCallTitle(transcript.call_title).prospect : 'Unknown',
        salesRep: transcript.rep_name,

        // Token usage tracking
        tokenUsage: {
          model: llmResult.model,
          inputTokens: llmResult.usage.inputTokens,
          outputTokens: llmResult.usage.outputTokens,
          totalTokens: llmResult.usage.totalTokens,
          costCents: llmResult.usage.costCents
        }
      };

      tokenUsage = analysis.tokenUsage;

    } catch (llmError) {
      console.error(`[CallAnalysis] LLM analysis failed, falling back to heuristic:`, llmError.message);
      // Fall back to heuristic analysis
      analysis = await performHeuristicAnalysis(transcript);
      analysis.analysisMode = ANALYSIS_MODE.HEURISTIC;
      analysis.llmFallback = true;
      analysis.llmError = llmError.message;
    }
  } else {
    // Heuristic (rule-based) analysis
    console.log(`[CallAnalysis] Using heuristic analysis for transcript ${transcriptId}`);
    analysis = await performHeuristicAnalysis(transcript);
    analysis.analysisMode = ANALYSIS_MODE.HEURISTIC;
  }

  // Add DFY pitch detection (for Phil's calls)
  addDFYPitchesToAnalysis(analysis, transcript);

  // Add DFY qualification analysis (for Phil's calls)
  addDFYQualificationToAnalysis(analysis, transcript);

  // Save to database
  await transcriptDb.saveAnalysis(transcriptId, analysis, ANALYSIS_VERSION);

  return {
    success: true,
    skipped: false,
    message: `Analysis completed (${analysis.analysisMode})`,
    analysis: analysis,
    analyzedAt: analysis.analyzedAt,
    tokenUsage: tokenUsage
  };
}

/**
 * Perform heuristic (rule-based) analysis
 * This is the original analysis method
 */
async function performHeuristicAnalysis(transcript) {
  // Parse transcript text into sentences
  const sentences = parseTranscriptText(transcript.transcript_text);

  // Build transcript object for analyzer
  const transcriptForAnalysis = {
    id: transcript.id,
    title: transcript.call_title,
    date: transcript.call_datetime,
    duration: transcript.duration_seconds * 1000, // Convert to ms
    sentences: sentences
  };

  // Run analysis
  const rawAnalysis = analyzeTranscript(transcriptForAnalysis);

  // Extract structured insights
  const insights = extractInsights(rawAnalysis);

  // Build final analysis object
  return {
    version: ANALYSIS_VERSION,
    analyzedAt: new Date().toISOString(),
    callId: transcript.id,
    callTitle: transcript.call_title,
    callDate: transcript.call_datetime,
    duration: transcript.duration_seconds,
    repName: transcript.rep_name,

    // Core insights (the 5 main categories)
    insights: insights,

    // Additional analysis data
    prospectProfile: rawAnalysis.prospectProfile,
    outcome: rawAnalysis.outcome,
    overallScore: rawAnalysis.overallScore,
    keyMoments: rawAnalysis.keyMoments,
    dfyAnalysis: rawAnalysis.dfyAnalysis,

    // Metadata
    sentenceCount: sentences.length,
    prospectName: rawAnalysis.prospectName,
    salesRep: rawAnalysis.salesRep
  };
}

/**
 * Analyze multiple transcripts (batch)
 * @param {Object} options - Batch options
 * @param {number} options.limit - Max transcripts to analyze
 * @param {boolean} options.force - Force re-analysis
 * @returns {Object} - Batch results
 */
async function analyzeBatch(options = {}) {
  const { limit = 10, force = false } = options;

  const results = {
    total: 0,
    analyzed: 0,
    skipped: 0,
    errors: 0,
    details: []
  };

  // Get transcripts needing analysis
  let transcripts;
  if (force) {
    transcripts = await transcriptDb.getRecentTranscripts(limit);
  } else {
    transcripts = await transcriptDb.getTranscriptsNeedingAnalysis(limit, ANALYSIS_VERSION);
  }

  results.total = transcripts.length;

  for (const transcript of transcripts) {
    try {
      const result = await analyzeCall(transcript.id, { force });

      if (result.success) {
        if (result.skipped) {
          results.skipped++;
        } else {
          results.analyzed++;
        }
      } else {
        results.errors++;
      }

      results.details.push({
        id: transcript.id,
        title: transcript.call_title,
        ...result
      });

    } catch (error) {
      results.errors++;
      results.details.push({
        id: transcript.id,
        title: transcript.call_title,
        success: false,
        error: error.message
      });
    }
  }

  return results;
}

/**
 * Get analysis for a call
 * @param {string} transcriptId - Internal transcript ID
 */
async function getCallAnalysis(transcriptId) {
  const result = await transcriptDb.getAnalysis(transcriptId);
  if (!result) {
    return null;
  }
  return result.analysis;
}

/**
 * Get call with transcript and analysis
 * @param {string} transcriptId - Internal transcript ID
 */
async function getCallWithAnalysis(transcriptId) {
  return transcriptDb.getTranscriptWithAnalysis(transcriptId);
}

module.exports = {
  analyzeCall,
  analyzeBatch,
  getCallAnalysis,
  getCallWithAnalysis,
  parseTranscriptText,
  extractInsights,
  getAnalysisMode,
  performHeuristicAnalysis,
  analyzeWithLLM,
  ANALYSIS_VERSION,
  ANALYSIS_MODE
};
