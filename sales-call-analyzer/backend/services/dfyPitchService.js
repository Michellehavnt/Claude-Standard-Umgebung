/**
 * DFY Pitch Detection Service
 *
 * Identifies moments in calls where Phil pitched the DFY (Done-For-You) solution.
 *
 * For each DFY pitch instance, extracts:
 * - timestamp/segment (approximation if exact timestamps unavailable)
 * - exact transcript snippet
 * - trigger (why the pitch was made: pain, objection, timeline, budget, urgency, etc.)
 * - confidence score (0-100)
 *
 * DETECTION METHOD:
 * =================
 *
 * 1. IDENTIFICATION: Scan transcript for DFY-related keywords spoken by Phil:
 *    - "agency", "done for you", "done-for-you", "full service", "we can do it for you"
 *    - "managed service", "we'll handle it", "we manage", "full management"
 *    - "$1,800", "1800", "eighteen hundred" (DFY pricing signals)
 *    - "dfy", "done for you service", "we handle everything"
 *
 * 2. CONTEXT EXTRACTION: For each DFY mention, capture:
 *    - The exact sentence/segment where Phil pitched DFY
 *    - Surrounding context (2-3 sentences before/after)
 *    - Position in transcript (line number or time approximation)
 *
 * 3. TRIGGER DETECTION: Analyze preceding prospect statements for triggers:
 *    - PAIN: "frustrating", "waste of time", "hours every day", "manual"
 *    - OBJECTION: "skeptical", "don't have time", "too expensive", "tried before"
 *    - TIMELINE: "need it quickly", "deadline", "asap", "this week/month"
 *    - BUDGET: "expensive", "cost", "pricing", "afford", "budget"
 *    - URGENCY: "urgent", "immediately", "right away", "can't wait"
 *    - RESOURCE: "no staff", "small team", "can't hire", "limited resources"
 *
 * 4. CONFIDENCE SCORING:
 *    - Base: 60 (clear DFY keyword match)
 *    - +15 if trigger detected in preceding context
 *    - +10 if prospect expressed related pain point
 *    - +10 if Phil's own rep (verified speaker)
 *    - +5 if pricing mentioned (shows serious pitch)
 *    - -10 if context suggests hypothetical/educational
 */

const { dfyKeywords, justifiedTriggers } = require('../utils/dfyDetector');

// Trigger categories for classifying why Phil pitched DFY
const TRIGGER_CATEGORIES = {
  PAIN: {
    name: 'Pain Point',
    keywords: [
      'frustrating', 'frustrated', 'pain', 'painful', 'waste of time', 'wasting time',
      'hours every day', 'manual', 'tedious', 'nightmare', 'terrible', 'awful',
      'hate', 'struggling', 'difficult', 'problem', 'issue', 'challenge'
    ]
  },
  OBJECTION: {
    name: 'Objection',
    keywords: [
      'skeptical', "don't believe", "won't work", 'tried before', 'failed',
      "doesn't work", "can't trust", 'not sure', 'doubt', 'worried'
    ]
  },
  TIME: {
    name: 'Timeline/Time Constraint',
    keywords: [
      "don't have time", 'no time', 'too busy', 'busy', 'deadline',
      'asap', 'quickly', 'urgent', 'this week', 'this month', 'soon',
      'right away', 'immediately', "can't wait"
    ]
  },
  BUDGET: {
    name: 'Budget Discussion',
    keywords: [
      'cost', 'price', 'pricing', 'expensive', 'afford', 'budget',
      'investment', 'money', 'pay', 'spend', 'roi', 'return'
    ]
  },
  RESOURCE: {
    name: 'Resource Constraint',
    keywords: [
      'no staff', 'small team', "can't hire", 'limited resources', 'no bandwidth',
      "don't have staff", 'overwhelmed', 'stretched thin', 'understaffed',
      'one person', 'just me', 'solo'
    ]
  },
  CAPABILITY: {
    name: 'Capability Gap',
    keywords: [
      "don't know how", "can't figure out", 'complicated', 'complex',
      'technical', 'expertise', 'experience', 'knowledge', 'skill',
      'learning curve', 'training'
    ]
  },
  PROACTIVE: {
    name: 'Proactive Pitch',
    keywords: [] // No specific trigger - Phil mentioned proactively
  }
};

// DFY pricing indicators (suggest serious pitch, not just mention)
const PRICING_INDICATORS = [
  '$1,800', '$1800', '1800', 'eighteen hundred', '1,800',
  'dollar', 'per month', 'monthly', 'pricing', 'investment'
];

/**
 * Check if a speaker is Phil (the sales rep we're tracking)
 */
function isPhil(speakerName) {
  if (!speakerName) return false;
  const speaker = speakerName.toLowerCase();
  return speaker.includes('phil') || speaker === 'p' || speaker === 'pn';
}

/**
 * Check if a speaker is Jamie (sales rep)
 */
function isJamie(speakerName) {
  if (!speakerName) return false;
  const speaker = speakerName.toLowerCase();
  return speaker.includes('jamie') || speaker === 'j';
}

/**
 * Check if speaker is a sales rep (Phil or Jamie)
 */
function isSalesRep(speakerName) {
  return isPhil(speakerName) || isJamie(speakerName);
}

// Credibility/intro phrases that mention agency but are NOT actual DFY offers
// These are excluded from DFY pitch detection
const CREDIBILITY_INTRO_PATTERNS = [
  'i own an agency', 'i have an agency', 'i run an agency',
  'we have an agency', 'we run an agency', 'we own an agency',
  'i also do services', 'we also do services', 'we also offer services',
  'my agency', 'our agency background', 'agency background',
  'i started an agency', 'we started an agency',
  'worked at an agency', 'came from an agency',
  'i built an agency', 'we built an agency'
];

// Offer transition phrases that upgrade a credibility intro to an actual DFY offer
const OFFER_TRANSITION_PHRASES = [
  'we can do this for you', 'we can do it for you', 'we could do this for you',
  'we offer a package', 'we have a package', 'i can do this for you',
  'we\'ll handle it for you', 'we\'ll take care of it',
  'we can run it for you', 'we can manage it for you',
  'let us handle', 'let us take care', 'let us run it',
  'would you like us to', 'we could take over',
  'here\'s how we work', 'our pricing is', 'it would be'
];

/**
 * Check if text is a credibility/intro statement (not an actual DFY offer)
 * Returns true if it's just an intro, false if it's an actual offer
 */
function isCredibilityIntroOnly(text, followingContext = []) {
  const textLower = text.toLowerCase();

  // Check if it matches credibility intro patterns
  const isIntroPattern = CREDIBILITY_INTRO_PATTERNS.some(pattern =>
    textLower.includes(pattern)
  );

  if (!isIntroPattern) return false;

  // If it's an intro pattern, check if it transitions to an offer
  const hasOfferInSameLine = OFFER_TRANSITION_PHRASES.some(phrase =>
    textLower.includes(phrase)
  );

  if (hasOfferInSameLine) return false; // Not just intro, has offer language

  // Check following context (next 2-3 lines) for offer transitions
  for (const ctx of followingContext) {
    const ctxText = (typeof ctx === 'string' ? ctx : ctx.text || '').toLowerCase();
    if (OFFER_TRANSITION_PHRASES.some(phrase => ctxText.includes(phrase))) {
      return false; // Intro followed by offer = actual DFY pitch
    }
  }

  return true; // Just a credibility intro, not an offer
}

/**
 * Detect trigger category from text
 * Returns the most likely trigger that caused the DFY pitch
 */
function detectTrigger(contextTexts) {
  const combinedText = contextTexts.join(' ').toLowerCase();
  const scores = {};

  for (const [category, config] of Object.entries(TRIGGER_CATEGORIES)) {
    if (category === 'PROACTIVE') continue; // Skip proactive, it's the fallback

    let score = 0;
    for (const keyword of config.keywords) {
      if (combinedText.includes(keyword)) {
        score += 1;
      }
    }
    scores[category] = score;
  }

  // Find highest scoring category
  let maxScore = 0;
  let bestTrigger = 'PROACTIVE';

  for (const [category, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      bestTrigger = category;
    }
  }

  return {
    category: bestTrigger,
    name: TRIGGER_CATEGORIES[bestTrigger].name,
    score: maxScore
  };
}

/**
 * Calculate confidence score for a DFY pitch detection
 */
function calculateConfidence(pitchContext) {
  let confidence = 60; // Base confidence for keyword match

  // +15 if trigger detected in preceding context
  if (pitchContext.trigger && pitchContext.trigger.score > 0) {
    confidence += Math.min(15, pitchContext.trigger.score * 5);
  }

  // +10 if verified Phil speaker
  if (pitchContext.verifiedPhil) {
    confidence += 10;
  }

  // +5 if pricing mentioned
  if (pitchContext.hasPricing) {
    confidence += 5;
  }

  // +10 if prospect expressed related pain/need
  if (pitchContext.prospectNeed) {
    confidence += 10;
  }

  // -10 if seems hypothetical/educational
  if (pitchContext.seemsHypothetical) {
    confidence -= 10;
  }

  return Math.min(100, Math.max(0, confidence));
}

/**
 * Format line number as timestamp approximation
 * When actual timestamps aren't available
 */
function approximateTimestamp(lineIndex, totalLines, durationSeconds) {
  if (!durationSeconds || durationSeconds === 0) {
    return `Line ${lineIndex + 1}`;
  }

  // Approximate timestamp based on position in transcript
  const approximateSeconds = Math.floor((lineIndex / totalLines) * durationSeconds);
  const minutes = Math.floor(approximateSeconds / 60);
  const seconds = approximateSeconds % 60;
  return `~${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Extract DFY pitch instances from a call transcript
 *
 * @param {Object} transcript - Transcript object with text and metadata
 * @returns {Array} - Array of DFY pitch instances
 */
function detectDFYPitches(transcript) {
  const pitches = [];

  if (!transcript.transcript_text) return pitches;

  const lines = transcript.transcript_text.split('\n').filter(line => line.trim());
  const totalLines = lines.length;
  const durationSeconds = transcript.duration_seconds || 0;

  // Parse lines into structured format
  const parsedLines = lines.map((line, index) => {
    const match = line.match(/^([^:]+):\s*(.+)$/);
    if (match) {
      return {
        index,
        speaker: match[1].trim(),
        text: match[2].trim(),
        isPhil: isPhil(match[1])
      };
    }
    return {
      index,
      speaker: 'Unknown',
      text: line.trim(),
      isPhil: false
    };
  });

  // Scan for DFY pitches from Phil
  for (let i = 0; i < parsedLines.length; i++) {
    const line = parsedLines[i];

    // Only look at Phil's statements
    if (!line.isPhil) continue;

    const textLower = line.text.toLowerCase();

    // Check for DFY keywords
    const matchedKeywords = dfyKeywords.filter(kw => textLower.includes(kw.toLowerCase()));

    if (matchedKeywords.length === 0) continue;

    // Get following context (up to 3 lines after) for credibility check
    const followingLines = [];
    for (let j = i + 1; j < Math.min(parsedLines.length, i + 4); j++) {
      followingLines.push({
        speaker: parsedLines[j].speaker,
        text: parsedLines[j].text,
        isPhil: parsedLines[j].isPhil
      });
    }

    // Skip if this is just a credibility/intro statement, not an actual DFY offer
    if (isCredibilityIntroOnly(line.text, followingLines)) {
      continue; // Skip this - it's just "I own an agency" type intro
    }

    // Found a DFY mention from Phil - extract context

    // Get preceding context (up to 3 lines before, from prospect)
    const precedingContext = [];
    for (let j = Math.max(0, i - 3); j < i; j++) {
      if (!parsedLines[j].isPhil) {
        precedingContext.push(parsedLines[j].text);
      }
    }

    // Get following context (up to 2 lines after)
    const followingContext = [];
    for (let j = i + 1; j < Math.min(parsedLines.length, i + 3); j++) {
      followingContext.push({
        speaker: parsedLines[j].speaker,
        text: parsedLines[j].text
      });
    }

    // Detect trigger category
    const trigger = detectTrigger(precedingContext);

    // Check for pricing indicators
    const hasPricing = PRICING_INDICATORS.some(p => textLower.includes(p.toLowerCase()));

    // Check if prospect showed need in preceding context
    const prospectNeed = precedingContext.some(text =>
      justifiedTriggers.some(t => text.toLowerCase().includes(t))
    );

    // Check if seems hypothetical
    const seemsHypothetical = textLower.includes('if you') ||
      textLower.includes('could') ||
      textLower.includes('option') ||
      textLower.includes('also offer');

    // Build pitch context for confidence calculation
    const pitchContext = {
      trigger,
      verifiedPhil: line.isPhil,
      hasPricing,
      prospectNeed,
      seemsHypothetical
    };

    const confidence = calculateConfidence(pitchContext);

    // Build the pitch instance
    const pitch = {
      id: `dfy-${transcript.id}-${i}`,
      callId: transcript.id,
      callTitle: transcript.call_title,
      callDate: transcript.call_datetime,
      repName: transcript.rep_name,

      // Timestamp/segment
      timestamp: approximateTimestamp(i, totalLines, durationSeconds),
      lineIndex: i,

      // Exact snippet
      snippet: line.text,
      speaker: line.speaker,

      // Matched keywords
      matchedKeywords,

      // Trigger analysis
      trigger: {
        category: trigger.category,
        name: trigger.name,
        evidence: precedingContext.slice(-2).join(' | ') // Last 2 preceding lines as evidence
      },

      // Confidence score
      confidence,

      // Context
      precedingContext: precedingContext.slice(-3),
      followingContext: followingContext.slice(0, 2),

      // Classification
      hasPricing,
      prospectNeed,
      isHypothetical: seemsHypothetical
    };

    pitches.push(pitch);
  }

  return pitches;
}

/**
 * Get all DFY pitches for a specific rep across all their calls
 *
 * @param {Array} transcripts - Array of transcript objects (already filtered by rep)
 * @returns {Object} - Summary and list of all DFY pitches
 */
function aggregateDFYPitches(transcripts) {
  const allPitches = [];
  const callsWithPitches = new Set();

  for (const transcript of transcripts) {
    const pitches = detectDFYPitches(transcript);

    if (pitches.length > 0) {
      callsWithPitches.add(transcript.id);
      allPitches.push(...pitches);
    }
  }

  // Aggregate by trigger category
  const triggerBreakdown = {};
  for (const pitch of allPitches) {
    const cat = pitch.trigger.category;
    triggerBreakdown[cat] = (triggerBreakdown[cat] || 0) + 1;
  }

  // Calculate average confidence
  const avgConfidence = allPitches.length > 0
    ? Math.round(allPitches.reduce((sum, p) => sum + p.confidence, 0) / allPitches.length)
    : 0;

  return {
    summary: {
      totalCalls: transcripts.length,
      callsWithDFYPitch: callsWithPitches.size,
      totalPitches: allPitches.length,
      averageConfidence: avgConfidence,
      pitchesWithPricing: allPitches.filter(p => p.hasPricing).length,
      pitchesWithProspectNeed: allPitches.filter(p => p.prospectNeed).length,
      triggerBreakdown
    },
    pitches: allPitches.sort((a, b) => {
      // Sort by date descending, then by confidence descending
      const dateA = new Date(a.callDate || 0);
      const dateB = new Date(b.callDate || 0);
      if (dateB - dateA !== 0) return dateB - dateA;
      return b.confidence - a.confidence;
    })
  };
}

/**
 * Store DFY pitch data in analysis JSON
 * This is called during the analysis process to persist results
 */
function addDFYPitchesToAnalysis(analysis, transcript) {
  const pitches = detectDFYPitches(transcript);

  analysis.dfyPitches = {
    detected: pitches.length > 0,
    count: pitches.length,
    pitches: pitches.map(p => ({
      id: p.id,
      timestamp: p.timestamp,
      lineIndex: p.lineIndex,
      snippet: p.snippet,
      trigger: p.trigger,
      confidence: p.confidence,
      hasPricing: p.hasPricing,
      prospectNeed: p.prospectNeed,
      isHypothetical: p.isHypothetical,
      precedingContext: p.precedingContext,
      followingContext: p.followingContext
    }))
  };

  return analysis;
}

module.exports = {
  detectDFYPitches,
  aggregateDFYPitches,
  addDFYPitchesToAnalysis,
  isPhil,
  isJamie,
  isSalesRep,
  isCredibilityIntroOnly,
  detectTrigger,
  calculateConfidence,
  TRIGGER_CATEGORIES,
  PRICING_INDICATORS,
  CREDIBILITY_INTRO_PATTERNS,
  OFFER_TRANSITION_PHRASES
};
