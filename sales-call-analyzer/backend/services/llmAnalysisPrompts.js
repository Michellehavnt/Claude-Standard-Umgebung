/**
 * LLM Analysis Prompts
 * Prompt templates for LLM-based call transcript analysis
 */

/**
 * System prompt for call transcript analysis
 */
const ANALYSIS_SYSTEM_PROMPT = `You are an expert sales call analyst. Your job is to analyze sales call transcripts and extract structured insights that help sales teams improve their performance.

You will receive a call transcript and must extract the following categories of insights:
1. Pain Points - Problems the prospect mentions they're experiencing
2. Goals - What the prospect wants to achieve
3. Questions - Questions the prospect asks during the call
4. Objections/Dislikes - Concerns, hesitations, or negative reactions
5. Excitement Triggers - Moments where the prospect shows enthusiasm or positive interest

Be thorough but precise. Only include insights that are clearly supported by the transcript.
Return your analysis as valid JSON matching the exact schema provided.`;

/**
 * User prompt template for call analysis
 * @param {Object} params - Parameters for the prompt
 * @param {string} params.title - Call title
 * @param {string} params.transcript - Full transcript text
 * @param {string} params.prospectName - Name of the prospect (if known)
 * @param {string} params.repName - Name of the sales rep (if known)
 * @returns {string} - Formatted user prompt
 */
function buildAnalysisPrompt(params) {
  const { title, transcript, prospectName, repName } = params;

  return `Analyze the following sales call transcript and extract insights.

CALL INFORMATION:
- Title: ${title || 'Unknown'}
- Prospect: ${prospectName || 'Unknown'}
- Sales Rep: ${repName || 'Unknown'}

TRANSCRIPT:
${transcript}

---

Analyze this call and return a JSON object with the following structure:

{
  "painPoints": [
    {
      "category": "string (e.g., 'Manual Time Sink', 'Platform Failures', 'Scaling Difficulties', 'Resource Constraints', 'Poor Quality Results', 'Lack of Data Visibility', 'Outreach Challenges', 'Affiliate Management')",
      "quote": "string (exact quote from prospect)",
      "intensity": "string ('High', 'Medium', or 'Low')",
      "urgency": "string ('immediate', 'shortTerm', or 'longTerm')",
      "context": "string (brief context around the pain point)"
    }
  ],
  "goals": [
    {
      "goal": "string (what the prospect wants to achieve)",
      "priority": "string ('high', 'medium', or 'low')",
      "evidence": "string (quote or context supporting this goal)"
    }
  ],
  "questions": [
    {
      "question": "string (the exact question asked by the prospect)",
      "context": "string (what prompted this question)",
      "answered": "boolean (whether it was answered in the call)"
    }
  ],
  "objections": [
    {
      "type": "string ('Price', 'Time', 'Complexity', 'Trust', 'Competition', 'Authority')",
      "quote": "string (exact objection quote)",
      "emotionalUndertone": "string ('Frustration', 'Anxiety', 'Skepticism', 'Neutral')",
      "resolved": "boolean (whether the objection was addressed)"
    }
  ],
  "excitementTriggers": [
    {
      "trigger": "string (what caused the excitement - feature, benefit, etc.)",
      "quote": "string (exact excited response from prospect)",
      "intensity": "string ('High', 'Medium', or 'Low')"
    }
  ],
  "callSummary": {
    "outcome": "string ('trial_signup', 'demo_scheduled', 'follow_up_needed', 'no_interest', 'unknown')",
    "prospectEngagement": "string ('High', 'Medium', 'Low')",
    "keyTakeaway": "string (one sentence summary of the most important insight)",
    "recommendedNextStep": "string (suggested follow-up action)"
  }
}

IMPORTANT:
- Only include insights clearly supported by the transcript
- Use exact quotes from the prospect when possible
- If a category has no relevant insights, return an empty array
- Ensure the JSON is valid and properly formatted
- Do NOT include any text outside the JSON object`;
}

/**
 * Simpler prompt for quick analysis (lower token usage)
 */
function buildQuickAnalysisPrompt(params) {
  const { title, transcript, prospectName } = params;

  return `Analyze this sales call transcript briefly.

Call: ${title || 'Unknown'}
Prospect: ${prospectName || 'Unknown'}

Transcript:
${transcript}

Return JSON with:
{
  "topPains": ["string (top 3 pain points mentioned)"],
  "mainGoal": "string (primary goal)",
  "keyObjection": "string or null (main objection if any)",
  "excitementMoment": "string or null (what excited them most)",
  "outcome": "string ('positive', 'neutral', 'negative')",
  "score": "number (1-100, overall call quality)"
}

JSON only, no other text:`;
}

/**
 * Validate LLM analysis response structure
 * @param {Object} analysis - Parsed analysis from LLM
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
function validateAnalysisResponse(analysis) {
  const errors = [];

  if (!analysis || typeof analysis !== 'object') {
    return { valid: false, errors: ['Response is not an object'] };
  }

  // Check required arrays exist
  const requiredArrays = ['painPoints', 'goals', 'questions', 'objections', 'excitementTriggers'];
  for (const field of requiredArrays) {
    if (!Array.isArray(analysis[field])) {
      errors.push(`Missing or invalid array: ${field}`);
    }
  }

  // Check callSummary exists
  if (!analysis.callSummary || typeof analysis.callSummary !== 'object') {
    errors.push('Missing or invalid callSummary object');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Transform LLM analysis to match existing analysis structure
 * Ensures compatibility with the rule-based analyzer output
 * @param {Object} llmAnalysis - Analysis from LLM
 * @returns {Object} - Transformed analysis matching existing structure
 */
function transformToExistingFormat(llmAnalysis) {
  // Group pain points by urgency
  const painPoints = {
    immediate: [],
    shortTerm: [],
    longTerm: []
  };

  for (const pain of llmAnalysis.painPoints || []) {
    const urgency = pain.urgency || 'shortTerm';
    if (painPoints[urgency]) {
      painPoints[urgency].push({
        category: pain.category,
        quote: pain.quote,
        intensity: pain.intensity || 'Medium',
        context: pain.context,
        timestamp: null // LLM doesn't have timestamp info
      });
    }
  }

  // Transform objections to match existing format
  const objections = (llmAnalysis.objections || []).map(obj => ({
    type: obj.type,
    quote: obj.quote,
    emotionalUndertone: obj.emotionalUndertone || 'Neutral',
    resolutionAttempted: 'See transcript',
    outcome: obj.resolved ? 'Accepted' : 'Unknown'
  }));

  // Transform excitement triggers
  const excitementTriggers = (llmAnalysis.excitementTriggers || []).map(t => ({
    trigger: t.trigger,
    quote: t.quote,
    timestamp: null
  }));

  // Transform goals
  const goals = (llmAnalysis.goals || []).map(g => ({
    goal: g.goal,
    priority: g.priority || 'medium',
    evidence: g.evidence,
    inferred_from: 'LLM analysis'
  }));

  // Transform questions
  const questions = (llmAnalysis.questions || []).map(q => ({
    question: q.question,
    context: q.context,
    timestamp: null
  }));

  return {
    painPoints,
    objections,
    excitementTriggers,
    insights: {
      pains: flattenPainPoints(painPoints),
      goals,
      questions,
      dislikes: objections.map(o => ({
        type: o.type,
        quote: o.quote,
        emotion: o.emotionalUndertone,
        resolved: o.outcome === 'Accepted'
      })),
      excitement_triggers: excitementTriggers
    },
    outcome: llmAnalysis.callSummary?.outcome || 'unknown',
    overallScore: calculateScoreFromLLM(llmAnalysis),
    keyMoments: [],
    callSummary: llmAnalysis.callSummary
  };
}

/**
 * Flatten pain points from grouped structure
 */
function flattenPainPoints(painPoints) {
  const flat = [];
  for (const urgency of ['immediate', 'shortTerm', 'longTerm']) {
    for (const pain of painPoints[urgency] || []) {
      flat.push({
        ...pain,
        urgency
      });
    }
  }
  return flat;
}

/**
 * Calculate score from LLM analysis
 */
function calculateScoreFromLLM(analysis) {
  let score = 50; // Base

  // Pain points identified
  const painCount = (analysis.painPoints || []).length;
  score += Math.min(15, painCount * 3);

  // Goals identified
  const goalCount = (analysis.goals || []).length;
  score += Math.min(10, goalCount * 3);

  // Excitement triggers
  const excitementCount = (analysis.excitementTriggers || []).length;
  score += Math.min(15, excitementCount * 5);

  // Outcome bonus
  const outcome = analysis.callSummary?.outcome || 'unknown';
  if (outcome === 'trial_signup') score += 15;
  else if (outcome === 'demo_scheduled') score += 10;
  else if (outcome === 'no_interest') score -= 15;

  // Engagement level
  const engagement = analysis.callSummary?.prospectEngagement || 'Medium';
  if (engagement === 'High') score += 10;
  else if (engagement === 'Low') score -= 10;

  return Math.max(0, Math.min(100, score));
}

module.exports = {
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisPrompt,
  buildQuickAnalysisPrompt,
  validateAnalysisResponse,
  transformToExistingFormat
};
