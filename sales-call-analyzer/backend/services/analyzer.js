const { detectDFY } = require('../utils/dfyDetector');
const { extractPainPoints } = require('../utils/painPointExtractor');

/**
 * Parse call title to extract prospect and sales rep names
 */
function parseCallTitle(title) {
  if (!title) return { prospect: 'Unknown', rep: 'Unknown' };

  // Pattern: "Name and Jamie I.F." or "Name and Phil Norris"
  const jamiePattern = /(.+?)\s+and\s+Jamie\s*I\.?F\.?/i;
  const philPattern = /(.+?)\s+and\s+Phil\s+Norris/i;

  let match = title.match(jamiePattern);
  if (match) return { prospect: match[1].trim(), rep: 'Jamie' };

  match = title.match(philPattern);
  if (match) return { prospect: match[1].trim(), rep: 'Phil' };

  // Try reverse pattern "Jamie I.F. and Name"
  const jamieReversePattern = /Jamie\s*I\.?F\.?\s+and\s+(.+)/i;
  const philReversePattern = /Phil\s+Norris\s+and\s+(.+)/i;

  match = title.match(jamieReversePattern);
  if (match) return { prospect: match[1].trim(), rep: 'Jamie' };

  match = title.match(philReversePattern);
  if (match) return { prospect: match[1].trim(), rep: 'Phil' };

  return { prospect: title, rep: 'Unknown' };
}

/**
 * Check if a speaker is the prospect (not the sales rep)
 */
function isProspectSpeaker(speakerName, prospectName) {
  if (!speakerName) return false;

  const speaker = speakerName.toLowerCase();

  // Exclude known sales rep names
  const salesRepNames = ['jamie', 'phil', 'phil norris', 'jamie i.f.', 'jamie if', 'j.f.', 'jf'];
  if (salesRepNames.some(rep => speaker.includes(rep))) {
    return false;
  }

  // Include if matches prospect name
  if (prospectName) {
    const prospectFirst = prospectName.toLowerCase().split(' ')[0];
    if (speaker.includes(prospectFirst)) return true;
  }

  // For generic speakers, default to including them
  // (assuming they're more likely the prospect in a 1:1 call)
  return true;
}

/**
 * Format milliseconds to MM:SS timestamp
 */
function formatTimestamp(ms) {
  if (!ms) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Extract prospect quotes from sentences
 */
function extractProspectQuotes(sentences, prospectName) {
  return sentences.filter(s => isProspectSpeaker(s.speaker_name, prospectName));
}

/**
 * Extract excitement triggers from prospect statements
 */
function extractExcitementTriggers(prospectSentences) {
  const excitementKeywords = [
    'fantastic', 'amazing', 'great', 'love', 'perfect', 'exactly',
    'wow', 'incredible', 'awesome', 'brilliant', 'yes!', 'that\'s it',
    'this is what', 'i need this', 'game changer', 'sold', 'sign me up'
  ];

  const triggers = [];

  for (const sentence of prospectSentences) {
    const text = sentence.text.toLowerCase();
    const hasExcitement = excitementKeywords.some(kw => text.includes(kw));

    if (hasExcitement) {
      triggers.push({
        trigger: sentence.text.substring(0, 50) + '...',
        quote: sentence.text,
        timestamp: formatTimestamp(sentence.start_time)
      });
    }
  }

  return triggers.slice(0, 5); // Limit to top 5
}

/**
 * Extract objections raised by prospect
 */
function extractObjections(prospectSentences) {
  const objectionKeywords = {
    price: ['expensive', 'cost', 'price', 'budget', 'afford', 'cheaper', 'money'],
    time: ['no time', 'too busy', 'don\'t have time', 'schedule'],
    complexity: ['complicated', 'complex', 'difficult', 'hard to use', 'learning curve'],
    trust: ['not sure', 'skeptical', 'guarantee', 'proof', 'case study'],
    competition: ['other tools', 'alternative', 'competitors', 'already using'],
    authority: ['need to check', 'ask my', 'team', 'boss', 'partner']
  };

  const objections = [];

  for (const sentence of prospectSentences) {
    const text = sentence.text.toLowerCase();

    for (const [type, keywords] of Object.entries(objectionKeywords)) {
      if (keywords.some(kw => text.includes(kw))) {
        // Avoid duplicates
        if (!objections.some(o => o.type === type)) {
          objections.push({
            type: type.charAt(0).toUpperCase() + type.slice(1),
            quote: sentence.text,
            emotionalUndertone: detectEmotion(text),
            resolutionAttempted: 'See transcript',
            outcome: 'Unknown'
          });
        }
      }
    }
  }

  return objections;
}

/**
 * Detect emotional undertone in text
 */
function detectEmotion(text) {
  const emotions = {
    'Frustration': ['frustrated', 'annoying', 'waste', 'terrible', 'awful', 'hate'],
    'Anxiety': ['worried', 'concern', 'nervous', 'risk', 'afraid'],
    'Excitement': ['excited', 'great', 'love', 'perfect', 'amazing'],
    'Skepticism': ['not sure', 'doubt', 'really?', 'skeptical'],
    'Urgency': ['need', 'asap', 'urgent', 'quickly', 'now']
  };

  for (const [emotion, keywords] of Object.entries(emotions)) {
    if (keywords.some(kw => text.includes(kw))) {
      return emotion;
    }
  }

  return 'Neutral';
}

/**
 * Extract language assets from prospect statements
 */
function extractLanguageAssets(prospectSentences) {
  const industryTerms = [];
  const emotionalLanguage = [];
  const powerWords = new Set();

  const toolKeywords = ['goaffpro', 'impact', 'shareasale', 'refersion', 'tapfiliate', 'partnerize', 'partnerstack'];
  const emotionKeywords = ['frustrated', 'love', 'hate', 'amazing', 'terrible', 'waste', 'need', 'want', 'must'];
  const powerWordList = ['nothing', 'everything', 'never', 'always', 'waste', 'hours', 'impossible', 'game-changer'];

  for (const sentence of prospectSentences) {
    const text = sentence.text.toLowerCase();

    // Industry terms (tools/platforms)
    for (const tool of toolKeywords) {
      if (text.includes(tool) && !industryTerms.some(t => t.term.toLowerCase() === tool)) {
        industryTerms.push({
          term: tool.charAt(0).toUpperCase() + tool.slice(1),
          context: sentence.text.substring(0, 100)
        });
      }
    }

    // Emotional language
    for (const emotion of emotionKeywords) {
      if (text.includes(emotion)) {
        emotionalLanguage.push({
          phrase: sentence.text.substring(0, 80),
          emotion: detectEmotion(text)
        });
        break;
      }
    }

    // Power words
    for (const word of powerWordList) {
      if (text.includes(word)) {
        powerWords.add(word);
      }
    }
  }

  return {
    industryTerms: industryTerms.slice(0, 10),
    emotionalLanguage: emotionalLanguage.slice(0, 10),
    metaphors: [],
    powerWords: Array.from(powerWords)
  };
}

/**
 * Extract prospect profile from their statements
 */
function extractProspectProfile(prospectSentences, prospectName) {
  const profile = {
    company: null,
    role: null,
    industry: null,
    currentTools: [],
    teamSize: 'Unknown',
    budgetAuthority: 'Unknown',
    painLevel: 5
  };

  const toolNames = ['goaffpro', 'impact', 'shareasale', 'refersion', 'tapfiliate', 'partnerize', 'partnerstack', 'everflow'];
  const roleKeywords = ['manager', 'owner', 'founder', 'ceo', 'director', 'lead', 'head of', 'vp'];
  const industryKeywords = {
    'E-commerce': ['ecommerce', 'e-commerce', 'online store', 'shopify', 'amazon'],
    'SaaS': ['saas', 'software', 'platform', 'app'],
    'Supplements': ['supplement', 'vitamin', 'health', 'nutrition'],
    'Finance': ['finance', 'fintech', 'banking', 'trading'],
    'Education': ['course', 'education', 'training', 'learning']
  };

  let painIndicators = 0;
  const maxPainIndicators = 10;

  for (const sentence of prospectSentences) {
    const text = sentence.text.toLowerCase();

    // Extract tools mentioned
    for (const tool of toolNames) {
      if (text.includes(tool) && !profile.currentTools.includes(tool)) {
        profile.currentTools.push(tool.charAt(0).toUpperCase() + tool.slice(1));
      }
    }

    // Extract role
    if (!profile.role) {
      for (const role of roleKeywords) {
        if (text.includes(role)) {
          // Try to extract role phrase
          const roleMatch = text.match(new RegExp(`(\\w+\\s*)?${role}(\\s*\\w+)?`, 'i'));
          if (roleMatch) {
            profile.role = roleMatch[0].trim();
            break;
          }
        }
      }
    }

    // Extract industry
    if (!profile.industry) {
      for (const [industry, keywords] of Object.entries(industryKeywords)) {
        if (keywords.some(kw => text.includes(kw))) {
          profile.industry = industry;
          break;
        }
      }
    }

    // Team size indicators
    if (text.includes('team') || text.includes('staff') || text.includes('employee')) {
      if (text.includes('small') || text.includes('just me') || text.includes('solo')) {
        profile.teamSize = 'Small (1-5)';
      } else if (text.includes('large') || text.includes('many')) {
        profile.teamSize = 'Large (20+)';
      } else {
        profile.teamSize = 'Medium (5-20)';
      }
    }

    // Budget authority indicators
    if (text.includes('i can') && (text.includes('decide') || text.includes('buy') || text.includes('pay'))) {
      profile.budgetAuthority = 'High';
    } else if (text.includes('need to ask') || text.includes('check with') || text.includes('approval')) {
      profile.budgetAuthority = 'Needs approval';
    }

    // Pain level calculation
    const painWords = ['frustrated', 'hate', 'terrible', 'waste', 'hours', 'manual', 'nothing', 'awful', 'nightmare', 'impossible'];
    if (painWords.some(pw => text.includes(pw))) {
      painIndicators++;
    }
  }

  // Calculate pain level (1-10)
  profile.painLevel = Math.min(10, Math.max(1, Math.round((painIndicators / maxPainIndicators) * 10)));
  if (painIndicators === 0) profile.painLevel = 5; // Default neutral

  return profile;
}

/**
 * Determine call outcome
 */
function determineOutcome(sentences) {
  const fullText = sentences.map(s => s.text.toLowerCase()).join(' ');

  const trialKeywords = ['sign up', 'signup', 'start trial', 'free trial', 'try it', 'get started', 'create account'];
  const demoKeywords = ['schedule demo', 'book demo', 'show me', 'see a demo', 'walkthrough'];
  const noCloseKeywords = ['think about it', 'get back to you', 'not ready', 'maybe later', 'need to check'];

  if (trialKeywords.some(kw => fullText.includes(kw))) {
    return 'trial_signup';
  }
  if (demoKeywords.some(kw => fullText.includes(kw))) {
    return 'demo_scheduled';
  }
  if (noCloseKeywords.some(kw => fullText.includes(kw))) {
    return 'no_close';
  }

  return 'unknown';
}

/**
 * Extract key moments from the call
 */
function extractKeyMoments(sentences, prospectName) {
  const moments = [];

  const momentTriggers = {
    'Pain point revealed': ['problem is', 'issue is', 'struggling with', 'frustrating', 'waste', 'hours'],
    'Excitement shown': ['that\'s great', 'love that', 'amazing', 'fantastic', 'exactly what'],
    'Objection raised': ['expensive', 'not sure', 'concerned', 'but what if'],
    'Decision signal': ['let\'s do it', 'sign up', 'interested', 'how do i', 'next steps']
  };

  for (const sentence of sentences) {
    if (!isProspectSpeaker(sentence.speaker_name, prospectName)) continue;

    const text = sentence.text.toLowerCase();

    for (const [event, triggers] of Object.entries(momentTriggers)) {
      if (triggers.some(t => text.includes(t))) {
        moments.push({
          timestamp: formatTimestamp(sentence.start_time),
          event,
          impact: event === 'Decision signal' || event === 'Pain point revealed' ? 'High' : 'Medium',
          quote: sentence.text.substring(0, 100)
        });
        break;
      }
    }
  }

  // Deduplicate and limit
  const seen = new Set();
  return moments.filter(m => {
    const key = m.event + m.timestamp;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
}

/**
 * Calculate overall call score
 */
function calculateScore(analysis) {
  let score = 50; // Base score

  // Pain points identified (+5 per pain point, max +20)
  const painPointCount = (analysis.painPoints?.immediate?.length || 0) +
                        (analysis.painPoints?.shortTerm?.length || 0) +
                        (analysis.painPoints?.longTerm?.length || 0);
  score += Math.min(20, painPointCount * 5);

  // Excitement triggers (+5 per trigger, max +15)
  score += Math.min(15, (analysis.excitementTriggers?.length || 0) * 5);

  // Outcome bonus
  if (analysis.outcome === 'trial_signup') score += 20;
  else if (analysis.outcome === 'demo_scheduled') score += 10;
  else if (analysis.outcome === 'no_close') score -= 10;

  // DFY penalty (if avoidable)
  if (analysis.dfyAnalysis?.classification === 'avoidable') score -= 15;

  // Objections handled
  const resolvedObjections = (analysis.objections || []).filter(o => o.outcome === 'Accepted').length;
  score += resolvedObjections * 5;

  return Math.max(0, Math.min(100, score));
}

/**
 * Main analysis function
 */
function analyzeTranscript(transcript) {
  const { prospect, rep } = parseCallTitle(transcript.title);

  const sentences = transcript.sentences || [];
  const prospectSentences = extractProspectQuotes(sentences, prospect);

  // Extract all components
  const painPoints = extractPainPoints(prospectSentences);
  const dfyAnalysis = detectDFY(sentences, prospect);
  const excitementTriggers = extractExcitementTriggers(prospectSentences);
  const objections = extractObjections(prospectSentences);
  const languageAssets = extractLanguageAssets(prospectSentences);
  const prospectProfile = extractProspectProfile(prospectSentences, prospect);
  const outcome = determineOutcome(sentences);
  const keyMoments = extractKeyMoments(sentences, prospect);

  const analysis = {
    id: transcript.id,
    fireflies_id: transcript.id,
    title: transcript.title,
    date: transcript.date ? new Date(transcript.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    duration: Math.round((transcript.duration || 0) / 60), // Convert to minutes

    prospectName: prospect,
    salesRep: rep,

    outcome,
    offerPitched: dfyAnalysis.mentioned ? 'dfy_mentioned' : 'software_only',
    overallScore: 0, // Will be calculated after all data is in

    prospectProfile,
    painPoints,
    objections,
    excitementTriggers,
    languageAssets,
    dfyAnalysis,
    keyMoments,

    techniquesUsed: [], // Would need more context to detect
    followUpActions: extractFollowUpActions(transcript.summary)
  };

  // Calculate final score
  analysis.overallScore = calculateScore(analysis);

  return analysis;
}

/**
 * Extract follow-up actions from Fireflies summary
 */
function extractFollowUpActions(summary) {
  if (!summary?.action_items) return [];

  // Parse action items if they're in string format
  if (typeof summary.action_items === 'string') {
    return summary.action_items.split('\n').filter(item => item.trim()).slice(0, 5);
  }

  return (summary.action_items || []).slice(0, 5);
}

module.exports = {
  parseCallTitle,
  isProspectSpeaker,
  analyzeTranscript,
  formatTimestamp
};
