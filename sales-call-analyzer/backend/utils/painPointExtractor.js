/**
 * Pain Point Extraction Module
 * Extracts and categorizes pain points from prospect statements
 */

const painPointCategories = {
  timeWaste: {
    keywords: ['hours', 'time', 'manual', 'manually', 'spend', 'spent', 'waste', 'all day', 'tedious', 'repetitive'],
    label: 'Manual Time Sink',
    urgency: 'immediate'
  },
  captchaFrustration: {
    keywords: ['captcha', 'bridge', 'cow', 'verify', 'robot', 'anti-bot', 'blocked', 'locked out'],
    label: 'CAPTCHA Frustration',
    urgency: 'immediate'
  },
  platformFailures: {
    keywords: ['goaffpro', 'impact', 'shareasale', 'doesn\'t work', 'not working', 'crap', 'terrible', 'fraud', 'broken', 'useless'],
    label: 'Platform Failures',
    urgency: 'immediate'
  },
  affiliateDryUp: {
    keywords: ['dry up', 'disappear', 'ghost', 'stop', 'inactive', 'five leads then', 'no response', 'gone', 'left'],
    label: 'Affiliates Disappearing',
    urgency: 'shortTerm'
  },
  scaleChallenge: {
    keywords: ['scale', 'one at a time', 'can\'t grow', 'bootstrap', 'limited', 'bottleneck', 'capacity'],
    label: 'Scaling Difficulties',
    urgency: 'shortTerm'
  },
  nicheChallenge: {
    keywords: ['niche', 'specific', 'hard to find', 'challenging', 'filter', 'narrow', 'specialized'],
    label: 'Niche Market Challenge',
    urgency: 'shortTerm'
  },
  irrelevantResults: {
    keywords: ['irrelevant', 'low quality', 'zero traffic', 'nonsense', 'rubbish', 'junk', 'spam', 'garbage'],
    label: 'Poor Quality Results',
    urgency: 'immediate'
  },
  competitorThreat: {
    keywords: ['competitor', 'competition', 'losing', 'market share', 'behind', 'catching up', 'outpacing'],
    label: 'Competitive Pressure',
    urgency: 'longTerm'
  },
  resourceConstraint: {
    keywords: ['no staff', 'small team', 'just me', 'overwhelmed', 'no resources', 'lean', 'tight budget'],
    label: 'Resource Constraints',
    urgency: 'longTerm'
  },
  dataVisibility: {
    keywords: ['can\'t see', 'no visibility', 'don\'t know', 'tracking', 'metrics', 'analytics', 'reporting'],
    label: 'Lack of Data Visibility',
    urgency: 'shortTerm'
  }
};

const intensityIndicators = {
  high: ['hate', 'terrible', 'awful', 'nightmare', 'impossible', 'worst', 'disaster', 'killing', 'waste'],
  medium: ['frustrating', 'annoying', 'difficult', 'challenge', 'problem', 'issue', 'struggle'],
  low: ['not ideal', 'could be better', 'sometimes', 'minor', 'slight', 'bit of']
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
    if (category.keywords.some(kw => lowerText.includes(kw))) {
      return {
        category: category.label,
        urgency: category.urgency
      };
    }
  }

  return null;
}

/**
 * Extract pain points from prospect sentences
 */
function extractPainPoints(prospectSentences) {
  const painPoints = {
    immediate: [],
    shortTerm: [],
    longTerm: []
  };

  // Track categories to avoid excessive duplicates
  const seenCategories = {
    immediate: new Set(),
    shortTerm: new Set(),
    longTerm: new Set()
  };

  for (const sentence of prospectSentences) {
    const text = sentence.text;
    const categorization = categorizePainPoint(text);

    if (categorization) {
      const { category, urgency } = categorization;

      // Limit to 3 per category per urgency level
      if (seenCategories[urgency].has(category) &&
          painPoints[urgency].filter(p => p.category === category).length >= 3) {
        continue;
      }

      seenCategories[urgency].add(category);

      const painPoint = {
        category,
        quote: text,
        context: `Statement from prospect`,
        intensity: determineIntensity(text)
      };

      painPoints[urgency].push(painPoint);
    }
  }

  // Sort by intensity within each category
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
        prospect: analysis.prospectName,
        date: analysis.date
      });

      // Track intensity for averaging
      const intensityValue = { 'High': 3, 'Medium': 2, 'Low': 1 }[pp.intensity] || 2;
      aggregated[pp.category].intensities.push(intensityValue);
    }
  }

  // Calculate average intensities and sort by count
  const result = Object.values(aggregated).map(cat => ({
    ...cat,
    avgIntensity: cat.intensities.reduce((a, b) => a + b, 0) / cat.intensities.length,
    quotes: cat.quotes.slice(0, 10) // Limit quotes to top 10
  })).sort((a, b) => b.count - a.count);

  // Clean up internal tracking arrays
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
  painPointCategories
};
