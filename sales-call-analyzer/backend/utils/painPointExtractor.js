/**
 * Pain Point Extraction Module
 * Extracts and categorizes pain points from prospect statements
 * With full context capture for meaningful quotes
 */

const painPointCategories = {
  timeWaste: {
    keywords: [
      'spend hours', 'spent hours', 'waste time', 'wasting time', 'takes forever',
      'manual process', 'manually doing', 'all day long', 'tedious work',
      'repetitive task', 'time consuming', 'hours a day', 'hours per day',
      'so much time', 'too much time', 'every single day', 'hours on',
      'spend all day', 'takes hours', 'manually reach', 'manual outreach'
    ],
    label: 'Manual Time Sink',
    urgency: 'immediate',
    minLength: 50
  },
  captchaFrustration: {
    keywords: [
      'captcha', 'bridge page', 'verify human', 'robot check', 'anti-bot',
      'blocked by', 'locked out', 'can\'t get through', 'keeps blocking'
    ],
    label: 'CAPTCHA Frustration',
    urgency: 'immediate',
    minLength: 40
  },
  platformFailures: {
    keywords: [
      'goaffpro', 'impact radius', 'shareasale', 'refersion', 'tapfiliate',
      'doesn\'t work properly', 'not working for us', 'platform is crap',
      'terrible results from', 'fraud problem', 'broken system', 'useless tool',
      'stopped working', 'affiliate network', 'marketplace doesn\'t'
    ],
    label: 'Platform Failures',
    urgency: 'immediate',
    minLength: 40
  },
  affiliateDryUp: {
    keywords: [
      'affiliates dry up', 'affiliates disappear', 'affiliates ghost',
      'stop promoting', 'inactive affiliates', 'no response from affiliates',
      'affiliates left', 'lost our affiliates', 'affiliates quit',
      'affiliates stopped', 'affiliates don\'t respond'
    ],
    label: 'Affiliates Disappearing',
    urgency: 'shortTerm',
    minLength: 40
  },
  scaleChallenge: {
    keywords: [
      'can\'t scale', 'hard to scale', 'scaling problem', 'one at a time',
      'can\'t grow the program', 'bottleneck in', 'limited capacity',
      'need to scale', 'want to scale', 'growth problem', 'struggling to grow',
      'grow our affiliate'
    ],
    label: 'Scaling Difficulties',
    urgency: 'shortTerm',
    minLength: 40
  },
  nicheChallenge: {
    keywords: [
      'niche market', 'specific niche', 'hard to find affiliates',
      'challenging to find', 'narrow market', 'specialized industry',
      'unique product', 'difficult niche', 'finding the right affiliates',
      'specific type of affiliate', 'particular niche'
    ],
    label: 'Niche Market Challenge',
    urgency: 'shortTerm',
    minLength: 40
  },
  irrelevantResults: {
    keywords: [
      'irrelevant results', 'low quality leads', 'zero traffic affiliates',
      'junk affiliates', 'spam applications', 'garbage leads',
      'wrong audience', 'not relevant affiliates', 'poor quality affiliates',
      'wrong type of', 'not a good fit'
    ],
    label: 'Poor Quality Results',
    urgency: 'immediate',
    minLength: 40
  },
  competitorThreat: {
    keywords: [
      'competitors are using', 'competition has', 'losing market share',
      'falling behind competitors', 'competitors have better',
      'competitive pressure', 'they\'re outpacing us', 'need to catch up with'
    ],
    label: 'Competitive Pressure',
    urgency: 'longTerm',
    minLength: 40
  },
  resourceConstraint: {
    keywords: [
      'no staff to handle', 'small team can\'t', 'just me doing',
      'overwhelmed with', 'no resources for affiliate', 'lean operation',
      'tight budget for', 'can\'t afford to hire', 'don\'t have the manpower',
      'limited resources', 'don\'t have time to'
    ],
    label: 'Resource Constraints',
    urgency: 'longTerm',
    minLength: 40
  },
  dataVisibility: {
    keywords: [
      'can\'t see which affiliates', 'no visibility into performance',
      'don\'t know which affiliates', 'tracking affiliate performance',
      'metrics are unclear', 'no analytics on affiliates',
      'reporting on affiliates', 'can\'t track affiliate', 'no insight into affiliate'
    ],
    label: 'Lack of Data Visibility',
    urgency: 'shortTerm',
    minLength: 40
  },
  outreachChallenge: {
    keywords: [
      'cold outreach to affiliates', 'reaching out to affiliates',
      'contacting potential affiliates', 'email outreach', 'response rate is low',
      'getting replies from', 'finding contact info', 'reaching the right people',
      'outreach is hard', 'getting in touch with'
    ],
    label: 'Outreach Challenges',
    urgency: 'immediate',
    minLength: 40
  },
  affiliateManagement: {
    keywords: [
      'managing all the affiliates', 'affiliate management is',
      'keeping track of affiliates', 'onboarding new affiliates',
      'training affiliates', 'affiliate support', 'managing relationships'
    ],
    label: 'Affiliate Management',
    urgency: 'shortTerm',
    minLength: 40
  }
};

const intensityIndicators = {
  high: ['hate', 'terrible', 'awful', 'nightmare', 'impossible', 'worst', 'disaster', 'killing me', 'driving me crazy', 'so frustrated', 'complete waste', 'absolutely'],
  medium: ['frustrating', 'annoying', 'difficult', 'challenging', 'problem', 'issue', 'struggle', 'hard to', 'tough to'],
  low: ['not ideal', 'could be better', 'sometimes', 'minor', 'slight', 'a bit', 'would be nice']
};

/**
 * Determine intensity level from text
 */
function determineIntensity(text) {
  const lowerText = text.toLowerCase();

  for (const [level, keywords] of Object.entries(intensityIndicators)) {
    if (keywords.some(kw => lowerText.includes(kw))) {
      return level.charAt(0).toUpperCase() + level.slice(1);
    }
  }

  return 'Medium';
}

/**
 * Categorize a pain point statement
 */
function categorizePainPoint(text) {
  const lowerText = text.toLowerCase();

  for (const [key, category] of Object.entries(painPointCategories)) {
    const matchedKeyword = category.keywords.find(kw => lowerText.includes(kw));
    if (matchedKeyword) {
      return {
        category: category.label,
        urgency: category.urgency,
        minLength: category.minLength || 40,
        matchedKeyword
      };
    }
  }

  return null;
}

/**
 * Get context around a sentence (surrounding sentences from same speaker)
 */
function getQuoteWithContext(allSentences, currentIndex) {
  const current = allSentences[currentIndex];
  if (!current) return { fullQuote: '', questionContext: null, timestamp: null };

  const speakerName = current.speaker_name;
  const contextSentences = [];
  const maxDistance = 3;

  // Look backwards for same speaker
  for (let i = currentIndex - 1; i >= Math.max(0, currentIndex - maxDistance); i--) {
    if (allSentences[i].speaker_name === speakerName) {
      contextSentences.unshift(allSentences[i].text);
    } else {
      break;
    }
  }

  // Add current sentence
  contextSentences.push(current.text);

  // Look forwards for same speaker
  for (let i = currentIndex + 1; i <= Math.min(allSentences.length - 1, currentIndex + maxDistance); i++) {
    if (allSentences[i].speaker_name === speakerName) {
      contextSentences.push(allSentences[i].text);
    } else {
      break;
    }
  }

  const fullQuote = contextSentences.join(' ').trim();

  // Get the previous speaker's statement for context
  let questionContext = null;
  for (let i = currentIndex - 1; i >= Math.max(0, currentIndex - 5); i--) {
    if (allSentences[i].speaker_name !== speakerName) {
      questionContext = allSentences[i].text;
      break;
    }
  }

  return {
    fullQuote,
    questionContext,
    timestamp: current.start_time
  };
}

/**
 * Format timestamp from milliseconds
 */
function formatTimestamp(ms) {
  if (!ms) return null;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Extract pain points from sentences with full context
 * @param {Array} allSentences - All sentences from the transcript
 * @param {Array} prospectSentences - Just the prospect's sentences
 */
function extractPainPoints(allSentences, prospectSentences) {
  // Handle legacy calls where only prospectSentences is passed
  if (!prospectSentences) {
    prospectSentences = allSentences;
  }

  const painPoints = {
    immediate: [],
    shortTerm: [],
    longTerm: []
  };

  // Create index mapping from prospect sentences to all sentences
  const prospectToAllIndex = new Map();
  prospectSentences.forEach((ps, idx) => {
    const originalIdx = allSentences.findIndex(s =>
      s.text === ps.text && s.start_time === ps.start_time
    );
    prospectToAllIndex.set(idx, originalIdx !== -1 ? originalIdx : idx);
  });

  // Track seen quotes to avoid duplicates
  const seenQuotes = new Set();

  for (let i = 0; i < prospectSentences.length; i++) {
    const sentence = prospectSentences[i];
    const text = sentence.text;
    const categorization = categorizePainPoint(text);

    if (categorization) {
      const { category, urgency, minLength, matchedKeyword } = categorization;

      // Get full context using original index
      const originalIndex = prospectToAllIndex.get(i);
      const { fullQuote, questionContext, timestamp } = getQuoteWithContext(
        allSentences,
        originalIndex
      );

      // Skip if quote is too short
      if (fullQuote.length < minLength) continue;

      // Skip duplicates (check first 100 chars)
      const quoteKey = fullQuote.substring(0, 100).toLowerCase();
      if (seenQuotes.has(quoteKey)) continue;
      seenQuotes.add(quoteKey);

      const painPoint = {
        category,
        quote: fullQuote,
        context: questionContext ? `In response to: "${questionContext}"` : null,
        intensity: determineIntensity(fullQuote),
        timestamp: formatTimestamp(timestamp),
        matchedKeyword
      };

      painPoints[urgency].push(painPoint);
    }
  }

  // Sort by intensity within each urgency level
  const intensityOrder = { 'High': 0, 'Medium': 1, 'Low': 2 };

  for (const urgency of ['immediate', 'shortTerm', 'longTerm']) {
    painPoints[urgency].sort((a, b) =>
      (intensityOrder[a.intensity] || 1) - (intensityOrder[b.intensity] || 1)
    );
  }

  return painPoints;
}

/**
 * Aggregate pain points across multiple calls
 * Keeps ALL quotes for "See more" functionality
 */
function aggregatePainPoints(analyses) {
  const aggregated = {};

  for (const analysis of analyses) {
    const allPainPoints = [
      ...(analysis.painPoints?.immediate || []),
      ...(analysis.painPoints?.shortTerm || []),
      ...(analysis.painPoints?.longTerm || [])
    ];

    for (const pp of allPainPoints) {
      if (!aggregated[pp.category]) {
        aggregated[pp.category] = {
          category: pp.category,
          count: 0,
          quotes: [],
          avgIntensity: 0,
          intensities: []
        };
      }

      aggregated[pp.category].count++;
      aggregated[pp.category].quotes.push({
        quote: pp.quote,
        context: pp.context,
        prospect: analysis.prospectName,
        date: analysis.date,
        intensity: pp.intensity,
        timestamp: pp.timestamp,
        callId: analysis.id
      });

      const intensityValue = { 'High': 3, 'Medium': 2, 'Low': 1 }[pp.intensity] || 2;
      aggregated[pp.category].intensities.push(intensityValue);
    }
  }

  // Calculate averages and sort - keep ALL quotes
  const result = Object.values(aggregated).map(cat => ({
    ...cat,
    avgIntensity: cat.intensities.length > 0
      ? cat.intensities.reduce((a, b) => a + b, 0) / cat.intensities.length
      : 0,
    // Sort quotes: high intensity first, then by date (most recent first)
    quotes: cat.quotes.sort((a, b) => {
      const intensityOrder = { 'High': 0, 'Medium': 1, 'Low': 2 };
      const intensityDiff = (intensityOrder[a.intensity] || 1) - (intensityOrder[b.intensity] || 1);
      if (intensityDiff !== 0) return intensityDiff;
      return new Date(b.date) - new Date(a.date);
    })
  })).sort((a, b) => b.count - a.count);

  result.forEach(cat => delete cat.intensities);

  return result;
}

/**
 * Get top N pain points by frequency
 */
function getTopPainPoints(analyses, n = 5) {
  const aggregated = aggregatePainPoints(analyses);
  return aggregated.slice(0, n);
}

module.exports = {
  extractPainPoints,
  aggregatePainPoints,
  getTopPainPoints,
  categorizePainPoint,
  determineIntensity,
  painPointCategories,
  getQuoteWithContext
};
