/**
 * DFY Qualification Service
 *
 * Analyzes DFY (Done-For-You) pitches for sales quality metrics.
 * Extends existing DFY detection to add qualification scoring and evidence extraction.
 *
 * DATA MODEL FIELDS EXTRACTED:
 * - dfy_pitched: boolean
 * - dfy_offer_type: 'none' | 'dfy_primary' | 'dfy_upgrade' | 'dfy_fallback'
 * - proposal_promised: boolean
 * - discovery_booked_for_dfy: boolean
 * - software_pitched: boolean
 * - software_close_attempted: boolean
 * - budget_asked: boolean
 * - budget_provided: boolean
 * - budget_fit_for_dfy: 'unknown' | 'yes' | 'no'
 * - criteria_no_time: boolean
 * - criteria_buyer_intent: boolean
 * - criteria_budget_validated: boolean
 * - dfy_qualification_score: 0-4
 * - dfy_quality_flag: 'clean' | 'risky' | 'unclear'
 * - evidence: object with transcript quotes and positions
 */

const { dfyKeywords, justifiedTriggers } = require('../utils/dfyDetector');
const { isPhil } = require('./dfyPitchService');

// Configuration
const DFY_BUDGET_MINIMUM = 1000; // $1,000/month minimum for DFY budget fit
const QUALIFICATION_THRESHOLD = 3; // Score >= 3 = properly qualified

// Keywords for detecting various signals
const SOFTWARE_KEYWORDS = [
  'affiliatefinder', 'affiliate finder', 'software', 'platform', 'tool',
  'self-service', 'self serve', 'trial', 'free trial', 'demo', 'start using',
  'sign up', 'account', 'login', 'dashboard', 'subscription', 'monthly plan'
];

const SOFTWARE_CLOSE_KEYWORDS = [
  'start a trial', 'sign up', 'get started', 'create an account',
  'try it out', 'test it', 'let me set you up', 'get you started',
  'begin using', 'activate', 'start today', 'ready to start',
  'shall we proceed', 'want to move forward', 'ready to go'
];

const PROPOSAL_KEYWORDS = [
  'send you a proposal', 'proposal', 'quote', 'send over',
  'email you', 'follow up', 'send the details', 'put together',
  'send you more info', 'send information', 'proposal document'
];

const DISCOVERY_KEYWORDS = [
  'discovery call', 'follow-up call', 'book another call', 'schedule a call',
  'set up a meeting', 'demo call', 'second call', 'next call',
  'discuss further', 'dive deeper', 'explore more'
];

// Generic budget keywords (used for detecting budget mentions anywhere)
const BUDGET_ASK_KEYWORDS = [
  'budget', 'afford', 'pricing', 'cost', 'investment', 'spend',
  'what are you looking to invest', 'price range', 'financial',
  'how much', 'your budget', 'ballpark', 'dollar amount'
];

// DFY-specific budget ask patterns - must be in context of DFY/managed service/proposal
// Used for determining if budget_asked is truly DFY-contextual
const DFY_BUDGET_CONTEXT_KEYWORDS = [
  // DFY service context
  'done for you', 'dfy', 'managed service', 'agency', 'full service',
  'we handle', 'we manage', 'we run it', 'we do it for you',
  // Proposal/package context
  'proposal', 'package', 'our service', 'managed option',
  'what we charge', 'our pricing', 'the investment for',
  // Explicit DFY budget asks
  'budget for the service', 'budget for us to', 'budget for the managed',
  'invest in the service', 'invest for us to handle',
  'afford for us to', 'afford the managed', 'afford the service'
];

const NO_TIME_KEYWORDS = [
  "don't have time", 'no time', 'too busy', 'busy schedule',
  'stretched thin', 'overwhelmed', 'no bandwidth', "can't dedicate",
  'limited time', 'time constraints', 'not enough time',
  "can't spare", 'occupied', 'swamped'
];

const BUYER_INTENT_KEYWORDS = [
  'ready to', 'want to start', 'need this', 'looking for help',
  'need someone to', 'want you to', 'would like you to',
  'interested in', 'serious about', 'committed to',
  'makes sense', 'sounds good', 'let\'s do it', 'sign me up',
  'how do we proceed', 'next steps', 'what do I need to do'
];

/**
 * Check if text is from a prospect (non-rep speaker)
 */
function isProspect(speakerName) {
  if (!speakerName) return false;
  const speaker = speakerName.toLowerCase();
  return !speaker.includes('phil') && !speaker.includes('jamie') &&
         speaker !== 'p' && speaker !== 'pn' && speaker !== 'j';
}

/**
 * Parse transcript text into structured lines
 */
function parseTranscriptLines(transcriptText) {
  if (!transcriptText) return [];

  const lines = transcriptText.split('\n').filter(line => line.trim());
  return lines.map((line, index) => {
    const match = line.match(/^([^:]+):\s*(.+)$/);
    if (match) {
      return {
        index,
        speaker: match[1].trim(),
        text: match[2].trim(),
        isPhil: isPhil(match[1]),
        isProspect: isProspect(match[1])
      };
    }
    return {
      index,
      speaker: 'Unknown',
      text: line.trim(),
      isPhil: false,
      isProspect: false
    };
  });
}

/**
 * Find first occurrence of keyword pattern in lines
 * Returns evidence object with quote, lineIndex, and context
 */
function findEvidence(lines, keywords, speakerFilter = null) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const textLower = line.text.toLowerCase();

    // Apply speaker filter if specified
    if (speakerFilter === 'rep' && !line.isPhil) continue;
    if (speakerFilter === 'prospect' && !line.isProspect) continue;

    for (const kw of keywords) {
      if (textLower.includes(kw.toLowerCase())) {
        return {
          found: true,
          quote: line.text,
          lineIndex: i,
          speaker: line.speaker,
          keyword: kw,
          // Context: up to 2 lines before
          context: lines.slice(Math.max(0, i - 2), i).map(l => `${l.speaker}: ${l.text}`)
        };
      }
    }
  }

  return { found: false, quote: null, lineIndex: null, speaker: null, keyword: null, context: [] };
}

/**
 * Check if a budget question is in the context of DFY/managed service
 * Looks at the budget ask line and surrounding context for DFY signals
 *
 * @param {Object} budgetEvidence - Evidence object from findEvidence
 * @param {Array} lines - Parsed transcript lines
 * @returns {boolean} - True if budget ask is DFY-contextual
 */
function isBudgetAskDFYContextual(budgetEvidence, lines) {
  if (!budgetEvidence.found) return false;

  const lineIndex = budgetEvidence.lineIndex;
  const budgetLine = budgetEvidence.quote.toLowerCase();

  // Check if the budget ask line itself contains DFY context
  const hasDFYInLine = DFY_BUDGET_CONTEXT_KEYWORDS.some(kw =>
    budgetLine.includes(kw.toLowerCase())
  );
  if (hasDFYInLine) return true;

  // Check surrounding context (3 lines before and 2 lines after)
  const contextStart = Math.max(0, lineIndex - 3);
  const contextEnd = Math.min(lines.length, lineIndex + 3);
  const contextLines = lines.slice(contextStart, contextEnd);

  const contextText = contextLines.map(l => l.text.toLowerCase()).join(' ');

  // Check if context contains DFY-related keywords
  const hasDFYContext = DFY_BUDGET_CONTEXT_KEYWORDS.some(kw =>
    contextText.includes(kw.toLowerCase())
  );

  return hasDFYContext;
}

/**
 * Extract budget amount from text if mentioned
 * Returns null or number (monthly amount)
 */
function extractBudgetAmount(text) {
  if (!text) return null;

  // Match patterns like $1,000, $1000, $500/month, 1000 dollars, etc.
  const patterns = [
    /\$([0-9,]+)/g,  // $1,000
    /([0-9,]+)\s*(?:dollars|usd)/gi,  // 1000 dollars
    /([0-9,]+)\s*(?:per month|monthly|\/month|a month)/gi  // 1000 per month
  ];

  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const amount = parseInt(match[1].replace(/,/g, ''), 10);
      if (!isNaN(amount) && amount > 0 && amount < 100000) {
        return amount;
      }
    }
  }

  return null;
}

/**
 * Determine DFY offer type based on call context
 * - dfy_primary: DFY pitched as the main/first solution
 * - dfy_upgrade: DFY pitched after software as upgrade
 * - dfy_fallback: DFY pitched as fallback when prospect shows constraints
 * - none: DFY not pitched
 */
function determineDFYOfferType(lines, dfyEvidence, softwareEvidence) {
  if (!dfyEvidence.found) {
    return 'none';
  }

  // If no software mentioned, DFY is primary
  if (!softwareEvidence.found) {
    return 'dfy_primary';
  }

  // If software mentioned AFTER DFY, DFY is primary
  if (softwareEvidence.lineIndex > dfyEvidence.lineIndex) {
    return 'dfy_primary';
  }

  // If software mentioned BEFORE DFY
  // Check if DFY was pitched due to constraints (fallback) or as upgrade
  const contextBeforeDFY = lines.slice(
    Math.max(0, dfyEvidence.lineIndex - 4),
    dfyEvidence.lineIndex
  );

  const hasConstraintSignal = contextBeforeDFY.some(line => {
    const textLower = line.text.toLowerCase();
    return line.isProspect && (
      NO_TIME_KEYWORDS.some(kw => textLower.includes(kw)) ||
      justifiedTriggers.some(kw => textLower.includes(kw))
    );
  });

  return hasConstraintSignal ? 'dfy_fallback' : 'dfy_upgrade';
}

/**
 * Calculate DFY qualification score (0-4)
 * +1 no_time (prospect stated time constraint)
 * +1 buyer_intent (serious buyer intent for DFY)
 * +1 budget_validated (budget asked AND fits DFY)
 * +1 next_step_quality (discovery booked OR strong proposal process)
 */
function calculateQualificationScore(qualificationData) {
  let score = 0;

  if (qualificationData.criteria_no_time) score += 1;
  if (qualificationData.criteria_buyer_intent) score += 1;
  if (qualificationData.criteria_budget_validated) score += 1;
  if (qualificationData.discovery_booked_for_dfy ||
      (qualificationData.proposal_promised && qualificationData.criteria_buyer_intent)) {
    score += 1;
  }

  return score;
}

/**
 * Determine quality flag based on qualification data
 * - clean: score >= threshold AND no risky patterns
 * - risky: proposal without discovery OR low score with DFY pitch
 * - unclear: insufficient data to determine
 */
function determineQualityFlag(qualificationData, score) {
  // If DFY not pitched, it's clean (no issue)
  if (!qualificationData.dfy_pitched) {
    return 'clean';
  }

  // Risky: proposal promised without discovery (per user requirement)
  if (qualificationData.proposal_promised && !qualificationData.discovery_booked_for_dfy) {
    return 'risky';
  }

  // Clean: properly qualified (score >= threshold)
  if (score >= QUALIFICATION_THRESHOLD) {
    return 'clean';
  }

  // Risky: low score with DFY pitch
  if (score < 2) {
    return 'risky';
  }

  // Unclear: moderate score
  return 'unclear';
}

/**
 * Generate human-readable decision rationale explaining why the flag was assigned
 * Returns an object with:
 * - summary: one-line explanation
 * - flagReason: specific reason code for the flag
 * - ruleResults: array of rule evaluations with results and labels
 * - flagLogic: human-readable logic definition
 */
function generateDecisionRationale(qualificationData, score, flag) {
  const rationale = {
    summary: '',
    flagReason: '',
    ruleResults: [],
    flagLogic: {
      clean: `DFY not pitched OR (score >= ${QUALIFICATION_THRESHOLD} AND no risky patterns)`,
      risky: `DFY pitched AND (proposal without discovery OR score < 2)`,
      unclear: `DFY pitched AND score = 2 (insufficient qualification signals)`
    }
  };

  // Build rule results array (each rule with result, label, importance)
  rationale.ruleResults = [
    {
      rule: 'dfy_pitched',
      label: 'DFY Pitched',
      result: qualificationData.dfy_pitched ? 'yes' : 'no',
      importance: 'primary',
      description: 'Rep mentioned DFY/agency service'
    },
    {
      rule: 'criteria_no_time',
      label: 'No Time / Wants Help',
      result: qualificationData.criteria_no_time ? 'yes' : 'no',
      importance: 'qualification',
      description: 'Prospect stated time constraint or wants someone to handle it'
    },
    {
      rule: 'criteria_buyer_intent',
      label: 'Serious Buyer Intent',
      result: qualificationData.criteria_buyer_intent ? 'yes' : 'no',
      importance: 'qualification',
      description: 'Prospect showed intent to proceed with DFY'
    },
    {
      rule: 'budget_asked',
      label: 'Budget Asked',
      result: qualificationData.budget_asked ? 'yes' : 'no',
      importance: 'qualification',
      description: 'Rep asked about budget'
    },
    {
      rule: 'budget_provided',
      label: 'Budget Provided',
      result: qualificationData.budget_provided ? 'yes' : 'no',
      importance: 'qualification',
      description: 'Prospect stated a budget amount'
    },
    {
      rule: 'budget_fit_for_dfy',
      label: 'Budget Fits DFY Range',
      result: qualificationData.budget_fit_for_dfy,
      importance: 'qualification',
      description: `Budget >= $${DFY_BUDGET_MINIMUM}/month`
    },
    {
      rule: 'discovery_booked_for_dfy',
      label: 'Discovery Booked',
      result: qualificationData.discovery_booked_for_dfy ? 'yes' : 'no',
      importance: 'next_step',
      description: 'Follow-up discovery call scheduled (preferred next step)'
    },
    {
      rule: 'proposal_promised',
      label: 'Proposal Promised',
      result: qualificationData.proposal_promised ? 'yes' : 'no',
      importance: 'next_step',
      description: 'Rep promised to send proposal'
    },
    {
      rule: 'software_pitched',
      label: 'Software Pitched',
      result: qualificationData.software_pitched ? 'yes' : 'no',
      importance: 'software_discipline',
      description: 'Rep pitched software/platform option'
    },
    {
      rule: 'software_close_attempted',
      label: 'Software Close Attempted',
      result: qualificationData.software_close_attempted ? 'yes' : 'no',
      importance: 'software_discipline',
      description: 'Rep attempted to close on software (trial, signup, etc.)'
    }
  ];

  // Generate summary based on flag reason
  if (!qualificationData.dfy_pitched) {
    rationale.flagReason = 'no_dfy_pitched';
    rationale.summary = 'DFY was not pitched on this call. Software-only approach.';
  } else if (qualificationData.proposal_promised && !qualificationData.discovery_booked_for_dfy) {
    rationale.flagReason = 'proposal_without_discovery';
    const missingCriteria = [];
    if (!qualificationData.criteria_no_time) missingCriteria.push('time constraint');
    if (!qualificationData.criteria_buyer_intent) missingCriteria.push('buyer intent');
    if (!qualificationData.criteria_budget_validated) missingCriteria.push('validated budget');

    rationale.summary = `DFY was pitched and proposal promised without booking discovery.${
      missingCriteria.length > 0 ? ` Missing: ${missingCriteria.join(', ')}.` : ''
    }`;
  } else if (score >= QUALIFICATION_THRESHOLD) {
    rationale.flagReason = 'properly_qualified';
    const metCriteria = [];
    if (qualificationData.criteria_no_time) metCriteria.push('time constraint');
    if (qualificationData.criteria_buyer_intent) metCriteria.push('buyer intent');
    if (qualificationData.criteria_budget_validated) metCriteria.push('validated budget');
    if (qualificationData.discovery_booked_for_dfy) metCriteria.push('discovery booked');

    rationale.summary = `DFY properly qualified (${score}/${QUALIFICATION_THRESHOLD + 1} criteria). Met: ${metCriteria.join(', ')}.`;
  } else if (score < 2) {
    rationale.flagReason = 'low_qualification_score';
    const missingCriteria = [];
    if (!qualificationData.criteria_no_time) missingCriteria.push('time constraint');
    if (!qualificationData.criteria_buyer_intent) missingCriteria.push('buyer intent');
    if (!qualificationData.criteria_budget_validated) missingCriteria.push('validated budget');

    rationale.summary = `DFY pitched with low qualification score (${score}/4). Missing: ${missingCriteria.join(', ')}.`;
  } else {
    rationale.flagReason = 'moderate_score_unclear';
    rationale.summary = `DFY pitched with moderate qualification score (${score}/4). More discovery needed to validate fit.`;
  }

  return rationale;
}

/**
 * Validate that evidence quote actually supports the rule
 * Returns { valid: boolean, reason: string }
 */
function validateEvidence(rule, evidence, keywords) {
  if (!evidence || !evidence.text) {
    return { valid: true, reason: 'No evidence to validate' };
  }

  const textLower = evidence.text.toLowerCase();

  // Check if at least one keyword from the rule's keyword set is in the quote
  const hasMatchingKeyword = keywords.some(kw => textLower.includes(kw.toLowerCase()));

  if (!hasMatchingKeyword) {
    return {
      valid: false,
      reason: `Evidence quote does not contain expected keywords for "${rule}"`
    };
  }

  return { valid: true, reason: 'Evidence matches rule keywords' };
}

/**
 * Map evidence to rules for the Rule Breakdown panel
 * Returns array of rule objects with evidence attached
 * Includes evidence validation to ensure quotes match the rules they support
 */
function mapEvidenceToRules(qualificationData, evidence) {
  const rules = [
    {
      rule: 'dfy_pitched',
      label: 'DFY Pitched',
      result: qualificationData.dfy_pitched ? 'yes' : 'no',
      importance: 'Primary signal',
      evidence: evidence.dfy_pitch_quote,
      keywords: dfyKeywords // For validation
    },
    {
      rule: 'criteria_no_time',
      label: 'Lead stated no time / wants someone to run it',
      result: qualificationData.criteria_no_time ? 'yes' : 'no',
      importance: 'Qualification signal',
      evidence: evidence.no_time_quote,
      keywords: NO_TIME_KEYWORDS
    },
    {
      rule: 'criteria_buyer_intent',
      label: 'Serious buyer intent for DFY',
      result: qualificationData.criteria_buyer_intent ? 'yes' : 'no',
      importance: 'Qualification signal',
      evidence: evidence.buyer_intent_quote,
      keywords: BUYER_INTENT_KEYWORDS
    },
    {
      rule: 'budget_asked',
      label: 'Budget asked (DFY-contextual)',
      result: qualificationData.budget_asked ? 'yes' : 'no',
      importance: 'Qualification signal',
      evidence: evidence.budget_quote,
      keywords: [...BUDGET_ASK_KEYWORDS, ...DFY_BUDGET_CONTEXT_KEYWORDS]
    },
    {
      rule: 'budget_provided',
      label: 'Budget provided',
      result: qualificationData.budget_provided ? 'yes' : 'no',
      importance: 'Qualification signal',
      evidence: qualificationData.budget_amount ? {
        ...evidence.budget_quote,
        amount: qualificationData.budget_amount
      } : null,
      keywords: BUDGET_ASK_KEYWORDS
    },
    {
      rule: 'budget_fit_for_dfy',
      label: `Budget fits DFY range (>= $${DFY_BUDGET_MINIMUM}/mo)`,
      result: qualificationData.budget_fit_for_dfy,
      importance: 'Qualification signal',
      evidence: qualificationData.budget_amount ? {
        text: `$${qualificationData.budget_amount}/month ${qualificationData.budget_fit_for_dfy === 'yes' ? 'meets' : 'below'} minimum`,
        computed: true
      } : null,
      keywords: [] // Computed, no keyword validation needed
    },
    {
      rule: 'discovery_booked_for_dfy',
      label: 'Discovery booked for DFY (preferred)',
      result: qualificationData.discovery_booked_for_dfy ? 'yes' : 'no',
      importance: 'Next step quality',
      evidence: evidence.discovery_quote,
      keywords: DISCOVERY_KEYWORDS
    },
    {
      rule: 'proposal_promised',
      label: 'Proposal promised without discovery (risk signal)',
      result: qualificationData.proposal_promised && !qualificationData.discovery_booked_for_dfy ? 'yes' :
              qualificationData.proposal_promised ? 'no (with discovery)' : 'no',
      importance: qualificationData.proposal_promised && !qualificationData.discovery_booked_for_dfy ? 'Risk signal' : 'Next step quality',
      evidence: evidence.proposal_quote,
      keywords: PROPOSAL_KEYWORDS
    },
    {
      rule: 'software_pitched',
      label: 'Software pitched',
      result: qualificationData.software_pitched ? 'yes' : 'no',
      importance: 'Software discipline',
      evidence: evidence.software_pitch_quote,
      keywords: SOFTWARE_KEYWORDS
    },
    {
      rule: 'software_close_attempted',
      label: 'Software close attempted',
      result: qualificationData.software_close_attempted ? 'yes' : 'no',
      importance: 'Software discipline',
      evidence: evidence.software_close_quote,
      keywords: SOFTWARE_CLOSE_KEYWORDS
    }
  ];

  // Validate each rule's evidence and add validation status
  return rules.map(r => {
    const validation = validateEvidence(r.rule, r.evidence, r.keywords || []);
    return {
      rule: r.rule,
      label: r.label,
      result: r.result,
      importance: r.importance,
      evidence: r.evidence,
      evidenceValid: validation.valid,
      evidenceValidationReason: validation.reason
    };
  });
}

/**
 * Analyze a transcript for DFY qualification metrics
 *
 * @param {Object} transcript - Transcript object with transcript_text
 * @returns {Object} - Full qualification analysis with evidence
 */
function analyzeDFYQualification(transcript) {
  const lines = parseTranscriptLines(transcript.transcript_text);

  // Detect DFY pitch (from Phil)
  const dfyEvidence = findEvidence(lines, dfyKeywords, 'rep');
  const dfy_pitched = dfyEvidence.found;

  // Detect software pitch
  const softwareEvidence = findEvidence(lines, SOFTWARE_KEYWORDS, 'rep');
  const software_pitched = softwareEvidence.found;

  // Detect software close attempt
  const softwareCloseEvidence = findEvidence(lines, SOFTWARE_CLOSE_KEYWORDS, 'rep');
  const software_close_attempted = softwareCloseEvidence.found;

  // Detect proposal promise
  const proposalEvidence = findEvidence(lines, PROPOSAL_KEYWORDS, 'rep');
  const proposal_promised = proposalEvidence.found;

  // Detect discovery booking
  const discoveryEvidence = findEvidence(lines, DISCOVERY_KEYWORDS, 'rep');
  const discovery_booked_for_dfy = discoveryEvidence.found && dfy_pitched;

  // Detect budget ask - ONLY count if it's DFY-contextual
  const budgetAskEvidence = findEvidence(lines, BUDGET_ASK_KEYWORDS, 'rep');
  // Budget ask only counts for DFY qualification if it's in DFY context
  const budget_asked = budgetAskEvidence.found && isBudgetAskDFYContextual(budgetAskEvidence, lines);

  // Detect budget provided by prospect
  const budgetProvidedEvidence = findEvidence(lines, BUDGET_ASK_KEYWORDS, 'prospect');
  let budget_provided = false;
  let budget_amount = null;

  // Also check for actual budget amounts in prospect lines
  for (const line of lines) {
    if (line.isProspect) {
      const amount = extractBudgetAmount(line.text);
      if (amount !== null) {
        budget_provided = true;
        budget_amount = amount;
        break;
      }
    }
  }

  // Determine budget fit
  let budget_fit_for_dfy = 'unknown';
  if (budget_provided && budget_amount !== null) {
    budget_fit_for_dfy = budget_amount >= DFY_BUDGET_MINIMUM ? 'yes' : 'no';
  }

  // Detect no-time criteria from prospect
  const noTimeEvidence = findEvidence(lines, NO_TIME_KEYWORDS, 'prospect');
  const criteria_no_time = noTimeEvidence.found;

  // Detect buyer intent from prospect
  const buyerIntentEvidence = findEvidence(lines, BUYER_INTENT_KEYWORDS, 'prospect');
  const criteria_buyer_intent = buyerIntentEvidence.found;

  // Calculate budget validated criteria
  const criteria_budget_validated = budget_asked && budget_fit_for_dfy === 'yes';

  // Determine offer type
  const dfy_offer_type = determineDFYOfferType(lines, dfyEvidence, softwareEvidence);

  // Build qualification data
  const qualificationData = {
    dfy_pitched,
    dfy_offer_type,
    proposal_promised,
    discovery_booked_for_dfy,
    software_pitched,
    software_close_attempted,
    budget_asked,
    budget_provided,
    budget_fit_for_dfy,
    budget_amount,
    criteria_no_time,
    criteria_buyer_intent,
    criteria_budget_validated
  };

  // Calculate score and flag
  const dfy_qualification_score = calculateQualificationScore(qualificationData);
  const dfy_quality_flag = determineQualityFlag(qualificationData, dfy_qualification_score);

  // Build evidence object
  const evidence = {
    dfy_pitch_quote: dfyEvidence.found ? {
      text: dfyEvidence.quote,
      lineIndex: dfyEvidence.lineIndex,
      speaker: dfyEvidence.speaker,
      context: dfyEvidence.context
    } : null,
    no_time_quote: noTimeEvidence.found ? {
      text: noTimeEvidence.quote,
      lineIndex: noTimeEvidence.lineIndex,
      speaker: noTimeEvidence.speaker,
      context: noTimeEvidence.context
    } : null,
    buyer_intent_quote: buyerIntentEvidence.found ? {
      text: buyerIntentEvidence.quote,
      lineIndex: buyerIntentEvidence.lineIndex,
      speaker: buyerIntentEvidence.speaker,
      context: buyerIntentEvidence.context
    } : null,
    budget_quote: (budgetAskEvidence.found || budget_provided) ? {
      text: budgetAskEvidence.found ? budgetAskEvidence.quote : budgetProvidedEvidence.quote,
      lineIndex: budgetAskEvidence.found ? budgetAskEvidence.lineIndex : budgetProvidedEvidence.lineIndex,
      speaker: budgetAskEvidence.found ? budgetAskEvidence.speaker : budgetProvidedEvidence.speaker,
      amount: budget_amount,
      context: budgetAskEvidence.found ? budgetAskEvidence.context : budgetProvidedEvidence.context
    } : null,
    proposal_quote: proposalEvidence.found ? {
      text: proposalEvidence.quote,
      lineIndex: proposalEvidence.lineIndex,
      speaker: proposalEvidence.speaker,
      context: proposalEvidence.context
    } : null,
    discovery_quote: discoveryEvidence.found ? {
      text: discoveryEvidence.quote,
      lineIndex: discoveryEvidence.lineIndex,
      speaker: discoveryEvidence.speaker,
      context: discoveryEvidence.context
    } : null,
    software_pitch_quote: softwareEvidence.found ? {
      text: softwareEvidence.quote,
      lineIndex: softwareEvidence.lineIndex,
      speaker: softwareEvidence.speaker,
      context: softwareEvidence.context
    } : null,
    software_close_quote: softwareCloseEvidence.found ? {
      text: softwareCloseEvidence.quote,
      lineIndex: softwareCloseEvidence.lineIndex,
      speaker: softwareCloseEvidence.speaker,
      context: softwareCloseEvidence.context
    } : null
  };

  // Generate decision rationale
  const rationale = generateDecisionRationale(qualificationData, dfy_qualification_score, dfy_quality_flag);

  // Map evidence to rules for the Rule Breakdown panel
  const ruleBreakdown = mapEvidenceToRules(qualificationData, evidence);

  return {
    ...qualificationData,
    dfy_qualification_score,
    dfy_quality_flag,
    evidence,
    rationale,
    ruleBreakdown
  };
}

/**
 * Add DFY qualification data to existing analysis object
 * This extends the analysis without breaking existing fields
 */
function addDFYQualificationToAnalysis(analysis, transcript) {
  const qualification = analyzeDFYQualification(transcript);

  analysis.dfyQualification = qualification;

  return analysis;
}

/**
 * Generate summary stats for a set of qualification results
 */
function aggregateDFYQualificationStats(qualifications) {
  const stats = {
    totalCalls: qualifications.length,
    dfyPitched: 0,
    dfyProperlyQualified: 0,
    proposalsPromised: 0,
    discoveryBooked: 0,
    softwareCloseAttempted: 0,
    qualityFlags: { clean: 0, risky: 0, unclear: 0 },
    offerTypes: { none: 0, dfy_primary: 0, dfy_upgrade: 0, dfy_fallback: 0 },
    avgScore: 0,
    scoreDistribution: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }
  };

  let totalScore = 0;

  for (const q of qualifications) {
    if (q.dfy_pitched) stats.dfyPitched++;
    if (q.dfy_qualification_score >= QUALIFICATION_THRESHOLD) stats.dfyProperlyQualified++;
    if (q.proposal_promised) stats.proposalsPromised++;
    if (q.discovery_booked_for_dfy) stats.discoveryBooked++;
    if (q.software_close_attempted) stats.softwareCloseAttempted++;

    stats.qualityFlags[q.dfy_quality_flag]++;
    stats.offerTypes[q.dfy_offer_type]++;
    stats.scoreDistribution[q.dfy_qualification_score]++;

    totalScore += q.dfy_qualification_score;
  }

  stats.avgScore = qualifications.length > 0
    ? Math.round((totalScore / qualifications.length) * 10) / 10
    : 0;

  // Calculate percentages
  stats.dfyPitchedPct = qualifications.length > 0
    ? Math.round((stats.dfyPitched / qualifications.length) * 100)
    : 0;
  stats.properlyQualifiedPct = stats.dfyPitched > 0
    ? Math.round((stats.dfyProperlyQualified / stats.dfyPitched) * 100)
    : 0;
  stats.softwareCloseAttemptedPct = qualifications.length > 0
    ? Math.round((stats.softwareCloseAttempted / qualifications.length) * 100)
    : 0;

  return stats;
}

/**
 * Build funnel data for DFY qualification flow
 */
function buildDFYFunnel(qualifications) {
  const funnel = {
    dfyMentioned: 0,
    metCriteria: 0,
    budgetConfirmed: 0,
    discoveryBooked: 0,
    proposalPromised: 0
  };

  for (const q of qualifications) {
    if (q.dfy_pitched) {
      funnel.dfyMentioned++;

      if (q.dfy_qualification_score >= QUALIFICATION_THRESHOLD) {
        funnel.metCriteria++;
      }

      if (q.criteria_budget_validated) {
        funnel.budgetConfirmed++;
      }

      if (q.discovery_booked_for_dfy) {
        funnel.discoveryBooked++;
      }

      if (q.proposal_promised) {
        funnel.proposalPromised++;
      }
    }
  }

  return funnel;
}

module.exports = {
  analyzeDFYQualification,
  addDFYQualificationToAnalysis,
  aggregateDFYQualificationStats,
  buildDFYFunnel,
  calculateQualificationScore,
  determineQualityFlag,
  determineDFYOfferType,
  generateDecisionRationale,
  mapEvidenceToRules,
  validateEvidence,
  parseTranscriptLines,
  findEvidence,
  extractBudgetAmount,
  isProspect,
  isBudgetAskDFYContextual,
  // Constants for testing
  DFY_BUDGET_MINIMUM,
  QUALIFICATION_THRESHOLD,
  SOFTWARE_KEYWORDS,
  SOFTWARE_CLOSE_KEYWORDS,
  PROPOSAL_KEYWORDS,
  DISCOVERY_KEYWORDS,
  BUDGET_ASK_KEYWORDS,
  DFY_BUDGET_CONTEXT_KEYWORDS,
  NO_TIME_KEYWORDS,
  BUYER_INTENT_KEYWORDS
};
