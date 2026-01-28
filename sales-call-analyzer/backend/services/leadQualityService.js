/**
 * Lead Quality Service
 *
 * Orchestrates lead quality scoring by:
 * 1. Fetching leads from Calendly
 * 2. Enriching with Perplexity research
 * 3. Calculating quality scores
 * 4. Storing results in database
 */

const calendlyService = require('./calendlyService');
const perplexityService = require('./perplexityService');
const leadQualityDb = require('./leadQualityDb');
const secretManager = require('./secretManager');
const llmService = require('./llmService');
const transcriptDb = require('./transcriptDb');

// Free email domains for inbound quality scoring
const FREE_EMAIL_DOMAINS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'mail.com', 'protonmail.com', 'zoho.com', 'yandex.com',
  'gmx.com', 'live.com', 'msn.com', 'me.com', 'inbox.com',
  'googlemail.com', 'fastmail.com', 'tutanota.com', 'pm.me'
];

// Known affiliate software for detection
const AFFILIATE_SOFTWARE = [
  'impact', 'partnerstack', 'rewardful', 'firstpromoter', 'refersion',
  'affiliatly', 'leaddyno', 'tapfiliate', 'post affiliate pro', 'hasoffers',
  'tune', 'everflow', 'cj affiliate', 'shareasale', 'rakuten', 'awin',
  'clickbank', 'commission junction', 'flexoffers', 'pepperjam'
];

/**
 * Get email domain from email address
 */
function getEmailDomain(email) {
  if (!email) return '';
  const parts = email.split('@');
  return parts.length === 2 ? parts[1].toLowerCase() : '';
}

/**
 * Check if email is a business email
 */
function isBusinessEmail(email) {
  const domain = getEmailDomain(email);
  return domain && !FREE_EMAIL_DOMAINS.includes(domain);
}

/**
 * Score company strength (0-3)
 * 0 = solo founder / micro SaaS / indie hacker
 * 1 = small SaaS / ecom (1–10 employees)
 * 2 = SMB (10–50 employees)
 * 3 = established SaaS / ecom / enterprise (50+)
 */
function scoreCompanyStrength(perplexityData) {
  if (!perplexityData?.company_info) {
    return { score: 0, rationale: 'No company information found' };
  }

  const { employee_count, funding, description } = perplexityData.company_info;

  // Parse employee count
  let employeeNum = 0;
  if (employee_count) {
    const countStr = String(employee_count).toLowerCase();
    if (countStr.includes('100') || countStr.includes('enterprise') || countStr.includes('large')) {
      employeeNum = 100;
    } else if (countStr.includes('50') || countStr.includes('medium')) {
      employeeNum = 50;
    } else if (countStr.includes('10') || countStr.includes('small')) {
      employeeNum = 10;
    } else {
      // Try to parse number
      const match = countStr.match(/(\d+)/);
      if (match) {
        employeeNum = parseInt(match[1], 10);
      }
    }
  }

  // Check for funding signals
  const hasFunding = funding && !funding.toLowerCase().includes('bootstrap');
  const hasSeriesFunding = funding && /series [a-z]/i.test(funding);

  // Score determination
  if (employeeNum >= 50 || hasSeriesFunding) {
    return {
      score: 3,
      rationale: `Established company (${employee_count || 'enterprise scale'}${hasFunding ? `, ${funding}` : ''})`
    };
  }

  if (employeeNum >= 10) {
    return {
      score: 2,
      rationale: `SMB company (${employee_count || '10-50 employees'})`
    };
  }

  if (employeeNum >= 1 || perplexityData.company_info.website) {
    return {
      score: 1,
      rationale: `Small business (${employee_count || 'small team'})`
    };
  }

  return {
    score: 0,
    rationale: 'Solo founder or micro business'
  };
}

/**
 * Score affiliate readiness (0-3) - MOST IMPORTANT
 * 0 = no affiliate signals
 * 1 = affiliate-adjacent (referral program, partner mentions)
 * 2 = affiliate page exists
 * 3 = active on known affiliate software/network
 *
 * @param {Object} perplexityData - Research data from Perplexity
 * @param {Object} calendlyData - Optional form data with challenge/form responses
 */
function scoreAffiliateReadiness(perplexityData, calendlyData = {}) {
  // First check form responses for explicit affiliate software mentions
  const formMentionedSoftware = detectAffiliateSoftwareInFormData(calendlyData);

  if (!perplexityData?.affiliate_signals && formMentionedSoftware.length === 0) {
    return { score: 0, rationale: 'No affiliate signals detected' };
  }

  const signals = perplexityData?.affiliate_signals || {};

  // Combine detected software from Perplexity and form responses
  const allDetectedSoftware = [
    ...(signals.affiliate_software_detected || []),
    ...formMentionedSoftware
  ];
  // Remove duplicates
  const uniqueSoftware = [...new Set(allDetectedSoftware.map(s => s.toLowerCase()))];

  // Check for known affiliate software (from research OR form responses)
  if (uniqueSoftware.length > 0) {
    return {
      score: 3,
      rationale: `Active affiliate program using: ${uniqueSoftware.join(', ')}`
    };
  }

  // Check for affiliate page
  if (signals.affiliate_page_url) {
    return {
      score: 2,
      rationale: `Affiliate/partner page found: ${signals.affiliate_page_url}`
    };
  }

  // Check for affiliate-adjacent signals
  if (signals.has_affiliate_program || signals.partner_mentions || signals.affiliate_terms_found) {
    const reasons = [];
    if (signals.has_affiliate_program) reasons.push('affiliate program mentioned');
    if (signals.partner_mentions) reasons.push('partner program mentioned');
    if (signals.affiliate_terms_found) reasons.push('affiliate terms found');

    return {
      score: 1,
      rationale: `Affiliate-adjacent: ${reasons.join(', ')}`
    };
  }

  return {
    score: 0,
    rationale: 'No affiliate signals detected'
  };
}

/**
 * Detect affiliate software mentions in form data (challenge, form responses)
 * @param {Object} calendlyData - Form data from Calendly
 * @returns {string[]} - Array of detected software names
 */
function detectAffiliateSoftwareInFormData(calendlyData) {
  const detected = [];
  if (!calendlyData) return detected;

  // Combine all text from form data
  const textToSearch = [
    calendlyData.calendly_challenge || '',
    calendlyData.calendly_country || ''
  ];

  // Parse form responses if available
  if (calendlyData.calendly_form_responses) {
    try {
      const responses = typeof calendlyData.calendly_form_responses === 'string'
        ? JSON.parse(calendlyData.calendly_form_responses)
        : calendlyData.calendly_form_responses;

      if (Array.isArray(responses)) {
        responses.forEach(r => {
          if (r.answer) textToSearch.push(r.answer);
        });
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  const combinedText = textToSearch.join(' ').toLowerCase();

  // Check for each known affiliate software
  for (const software of AFFILIATE_SOFTWARE) {
    if (combinedText.includes(software.toLowerCase())) {
      detected.push(software);
    }
  }

  // Also check for common variations
  if (combinedText.includes('impact.com')) detected.push('Impact');
  if (combinedText.includes('partner stack')) detected.push('PartnerStack');
  if (combinedText.includes('first promoter')) detected.push('FirstPromoter');

  return [...new Set(detected)]; // Remove duplicates
}

/**
 * Score buyer authority (0-2)
 * 0 = student / intern / junior / unclear role
 * 1 = marketer / growth / partnerships role
 * 2 = founder / head of growth / head of partnerships / VP marketing
 */
function scoreBuyerAuthority(perplexityData) {
  if (!perplexityData?.person_info) {
    return { score: 0, rationale: 'No person information found' };
  }

  const { role, authority_level, name } = perplexityData.person_info;
  const roleLower = (role || '').toLowerCase();

  // Check explicit authority level from Perplexity
  if (authority_level === 'executive') {
    return {
      score: 2,
      rationale: `Executive role: ${role || 'Leadership'}`
    };
  }

  // Check for founder/executive keywords
  const executiveKeywords = [
    'founder', 'co-founder', 'ceo', 'coo', 'cmo', 'cro',
    'head of', 'vp ', 'vice president', 'director', 'chief',
    'owner', 'president', 'partner'
  ];

  for (const keyword of executiveKeywords) {
    if (roleLower.includes(keyword)) {
      return {
        score: 2,
        rationale: `Decision maker: ${role}`
      };
    }
  }

  // Check for marketing/growth/partnerships
  const marketingKeywords = [
    'marketing', 'growth', 'partnerships', 'affiliate', 'acquisition',
    'demand gen', 'performance', 'brand'
  ];

  for (const keyword of marketingKeywords) {
    if (roleLower.includes(keyword)) {
      return {
        score: 1,
        rationale: `Marketing/Growth role: ${role}`
      };
    }
  }

  // Check for junior indicators
  const juniorKeywords = ['intern', 'junior', 'assistant', 'coordinator', 'student', 'trainee'];
  for (const keyword of juniorKeywords) {
    if (roleLower.includes(keyword)) {
      return {
        score: 0,
        rationale: `Junior role: ${role}`
      };
    }
  }

  // Unknown role
  return {
    score: 0,
    rationale: role ? `Unclear authority: ${role}` : 'Role not identified'
  };
}

/**
 * Score inbound quality (0-2)
 * 0 = weak / vague (free email, incomplete info)
 * 1 = mixed (business email but sparse details)
 * 2 = clean, serious inbound (business email, complete form)
 */
function scoreInboundQuality(calendlyData) {
  let score = 0;
  const reasons = [];

  // Check email type
  const email = calendlyData.invitee_email;
  if (isBusinessEmail(email)) {
    score++;
    reasons.push('business email');
  } else {
    reasons.push('free email provider');
  }

  // Check form completeness
  const hasWebsite = calendlyData.website && calendlyData.website.length > 5;
  const hasChallenge = calendlyData.calendly_challenge && calendlyData.calendly_challenge.length > 20;

  if (hasWebsite && hasChallenge) {
    score++;
    reasons.push('complete form submission');
  } else if (hasWebsite || hasChallenge) {
    reasons.push('partial form submission');
  } else {
    reasons.push('minimal form data');
  }

  return {
    score,
    rationale: reasons.join(', ')
  };
}

/**
 * Calculate total score from bucket scores
 * Total range: 0-10 (sum of all buckets)
 */
function calculateTotalScore(bucketScores) {
  const { companyStrength, affiliateReadiness, buyerAuthority, inboundQuality } = bucketScores;

  // Sum all bucket scores (0-3 + 0-3 + 0-2 + 0-2 = 0-10)
  const total = (companyStrength?.score || 0) +
                (affiliateReadiness?.score || 0) +
                (buyerAuthority?.score || 0) +
                (inboundQuality?.score || 0);

  // Ensure minimum of 1 if we have any data
  return Math.max(1, Math.min(10, total));
}

/**
 * Analyze a lead's quality
 * @param {Object} leadData - Lead data from Calendly
 * @returns {Promise<Object>} - Quality analysis results
 */
async function analyzeLeadQuality(leadData) {
  const {
    invitee_email,
    invitee_name,
    website,
    company_name,
    calendly_challenge,
    calendly_country,
    calendly_form_responses
  } = leadData;

  // Research the lead with Perplexity (include form responses for context)
  const researchResult = await perplexityService.researchLead({
    email: invitee_email,
    name: invitee_name,
    website: website,
    company: company_name,
    challenge: calendly_challenge,
    formResponses: calendly_form_responses
  });

  // Get Perplexity data (or empty object if failed)
  const perplexityData = researchResult.success ? researchResult.data : {
    company_info: {},
    affiliate_signals: {},
    person_info: {},
    sources: []
  };

  // Calculate bucket scores
  const companyStrength = scoreCompanyStrength(perplexityData);
  // Pass leadData to check form responses for affiliate software mentions
  const affiliateReadiness = scoreAffiliateReadiness(perplexityData, leadData);
  const buyerAuthority = scoreBuyerAuthority(perplexityData);
  const inboundQuality = scoreInboundQuality(leadData);

  // Calculate total score
  const totalScore = calculateTotalScore({
    companyStrength,
    affiliateReadiness,
    buyerAuthority,
    inboundQuality
  });

  // Get research links
  const researchLinks = perplexityData.sources || [];

  // Get current prompt version (hash of first 100 chars)
  const prompt = secretManager.getPerplexityConfig().prompt;
  const promptVersion = prompt ? hashString(prompt.substring(0, 100)) : 'default';

  // Extract LinkedIn URL from person_info if available
  const linkedinUrl = perplexityData?.person_info?.linkedin_url || null;

  return {
    perplexityData,
    perplexitySuccess: researchResult.success,
    perplexityError: researchResult.error,

    companyStrengthScore: companyStrength.score,
    companyStrengthRationale: companyStrength.rationale,

    affiliateReadinessScore: affiliateReadiness.score,
    affiliateReadinessRationale: affiliateReadiness.rationale,

    buyerAuthorityScore: buyerAuthority.score,
    buyerAuthorityRationale: buyerAuthority.rationale,

    inboundQualityScore: inboundQuality.score,
    inboundQualityRationale: inboundQuality.rationale,

    totalScore,
    researchLinks,
    promptVersion,
    linkedinUrl
  };
}

/**
 * Simple string hash for prompt versioning
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * Sync and analyze leads from Calendly
 * @param {string} repEmail - Rep email to sync (or 'all' for all tracked reps)
 * @param {Object} options - Sync options
 * @returns {Promise<Object>} - Sync results
 */
async function syncAndAnalyzeLeads(repEmail, options = {}) {
  const { analyzeNew = true, reanalyzeExisting = false, daysBack = 30 } = options;

  // Check if Calendly is configured
  if (!calendlyService.isConfigured()) {
    return {
      success: false,
      error: 'Calendly not configured',
      synced: 0,
      analyzed: 0
    };
  }

  // Get tracked reps if 'all' specified
  // Note: Even if no tracked reps configured, we still sync all events and tag them as 'all'
  let repsToSync = [repEmail];
  let defaultOwner = repEmail;
  if (repEmail === 'all') {
    const config = secretManager.getPerplexityConfig();
    repsToSync = config.trackedReps || [];
    // If no tracked reps configured, still sync but use 'all' as owner
    if (repsToSync.length === 0) {
      defaultOwner = 'all';
    }
  }

  const results = {
    success: true,
    synced: 0,
    analyzed: 0,
    errors: [],
    leads: []
  };

  // Define time window - include past days and future days for upcoming calls
  const minTime = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  // Include future events (next 60 days) for upcoming calls
  const maxTime = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch scheduled events from Calendly
  try {
    const events = await calendlyService.listScheduledEvents({
      minStartTime: minTime,
      maxStartTime: maxTime,
      status: 'active'
    });

    for (const event of events) {
      try {
        // Get invitees for this event
        const invitees = await calendlyService.getEventInvitees(event.uri);

        for (const invitee of invitees) {
          // Extract Calendly event ID
          const eventId = event.uri?.split('/').pop();

          // Check if lead already exists
          let lead = await leadQualityDb.getLeadByCalendlyEvent(eventId);

          // Extract ALL form responses
          const responses = invitee.questions_and_answers || [];

          // Store all responses as JSON for display
          const allFormResponses = responses.map(r => ({
            question: r.question,
            answer: r.answer
          }));

          // Also extract specific fields for backwards compatibility
          const websiteResponse = responses.find(r =>
            r.question.toLowerCase().includes('website') ||
            r.question.toLowerCase().includes('url') ||
            r.question.toLowerCase().includes('domain')
          );
          const challengeResponse = responses.find(r =>
            r.question.toLowerCase().includes('challenge') ||
            r.question.toLowerCase().includes('problem') ||
            r.question.toLowerCase().includes('biggest')
          );
          const countryResponse = responses.find(r =>
            r.question.toLowerCase().includes('country') ||
            r.question.toLowerCase().includes('location') ||
            r.question.toLowerCase().includes('targeting')
          );

          const leadData = {
            calendly_event_id: eventId,
            invitee_email: invitee.email,
            invitee_name: invitee.name,
            website: websiteResponse?.answer || null,
            calendly_challenge: challengeResponse?.answer || null,
            calendly_country: countryResponse?.answer || null,
            calendly_form_responses: JSON.stringify(allFormResponses),
            calendly_booking_time: event.start_time,
            calendly_booking_owner: defaultOwner
          };

          if (!lead) {
            // Create new lead
            lead = await leadQualityDb.createLead(leadData);
            results.synced++;

            // Analyze if requested
            if (analyzeNew && perplexityService.isConfigured()) {
              const analysis = await analyzeLeadQuality(leadData);
              await leadQualityDb.updateLead(lead.id, {
                perplexity_response_json: JSON.stringify(analysis.perplexityData),
                enriched_at: new Date().toISOString(),
                company_strength_score: analysis.companyStrengthScore,
                company_strength_rationale: analysis.companyStrengthRationale,
                affiliate_readiness_score: analysis.affiliateReadinessScore,
                affiliate_readiness_rationale: analysis.affiliateReadinessRationale,
                buyer_authority_score: analysis.buyerAuthorityScore,
                buyer_authority_rationale: analysis.buyerAuthorityRationale,
                inbound_quality_score: analysis.inboundQualityScore,
                inbound_quality_rationale: analysis.inboundQualityRationale,
                total_score: analysis.totalScore,
                research_links: JSON.stringify(analysis.researchLinks),
                prompt_version: analysis.promptVersion,
                linkedin_url: analysis.linkedinUrl
              });
              results.analyzed++;
            }
          } else {
            // Update existing lead with fresh form data (in case it was missing)
            const updateData = {};
            if (!lead.website && leadData.website) updateData.website = leadData.website;
            if (!lead.calendlyChallenge && leadData.calendly_challenge) updateData.calendly_challenge = leadData.calendly_challenge;
            if (!lead.calendlyCountry && leadData.calendly_country) updateData.calendly_country = leadData.calendly_country;
            if (!lead.calendlyFormResponses && leadData.calendly_form_responses) updateData.calendly_form_responses = leadData.calendly_form_responses;

            if (Object.keys(updateData).length > 0) {
              await leadQualityDb.updateLead(lead.id, updateData);
            }
          }

          if (lead && reanalyzeExisting && perplexityService.isConfigured()) {
            // Re-analyze existing lead
            const analysis = await analyzeLeadQuality({
              ...leadData,
              invitee_email: lead.inviteeEmail,
              invitee_name: lead.inviteeName
            });
            await leadQualityDb.updateLead(lead.id, {
              perplexity_response_json: JSON.stringify(analysis.perplexityData),
              enriched_at: new Date().toISOString(),
              company_strength_score: analysis.companyStrengthScore,
              company_strength_rationale: analysis.companyStrengthRationale,
              affiliate_readiness_score: analysis.affiliateReadinessScore,
              affiliate_readiness_rationale: analysis.affiliateReadinessRationale,
              buyer_authority_score: analysis.buyerAuthorityScore,
              buyer_authority_rationale: analysis.buyerAuthorityRationale,
              inbound_quality_score: analysis.inboundQualityScore,
              inbound_quality_rationale: analysis.inboundQualityRationale,
              total_score: analysis.totalScore,
              research_links: JSON.stringify(analysis.researchLinks),
              prompt_version: analysis.promptVersion,
              linkedin_url: analysis.linkedinUrl
            });
            results.analyzed++;
          }

          results.leads.push(lead);
        }
      } catch (eventError) {
        results.errors.push(`Event ${event.uri}: ${eventError.message}`);
      }
    }
  } catch (error) {
    console.error('[LeadQuality] Sync error:', error.message);
    console.error('[LeadQuality] Full error:', error);
    results.success = false;
    results.error = error.message;
  }

  return results;
}

/**
 * Re-analyze a single lead
 * @param {string} leadId - Lead ID to re-analyze
 * @returns {Promise<Object>} - Updated lead
 */
async function reanalyzeLead(leadId) {
  const lead = await leadQualityDb.getLead(leadId);

  if (!lead) {
    throw new Error('Lead not found');
  }

  if (!perplexityService.isConfigured()) {
    throw new Error('Perplexity not configured');
  }

  const leadData = {
    invitee_email: lead.inviteeEmail,
    invitee_name: lead.inviteeName,
    website: lead.website,
    company_name: lead.companyName,
    calendly_challenge: lead.calendlyChallenge,
    calendly_country: lead.calendlyCountry,
    calendly_form_responses: lead.calendlyFormResponses
  };

  const analysis = await analyzeLeadQuality(leadData);

  return leadQualityDb.updateLead(leadId, {
    perplexity_response_json: JSON.stringify(analysis.perplexityData),
    enriched_at: new Date().toISOString(),
    company_strength_score: analysis.companyStrengthScore,
    company_strength_rationale: analysis.companyStrengthRationale,
    affiliate_readiness_score: analysis.affiliateReadinessScore,
    affiliate_readiness_rationale: analysis.affiliateReadinessRationale,
    buyer_authority_score: analysis.buyerAuthorityScore,
    buyer_authority_rationale: analysis.buyerAuthorityRationale,
    inbound_quality_score: analysis.inboundQualityScore,
    inbound_quality_rationale: analysis.inboundQualityRationale,
    total_score: analysis.totalScore,
    research_links: JSON.stringify(analysis.researchLinks),
    prompt_version: analysis.promptVersion,
    linkedin_url: analysis.linkedinUrl
  });
}

/**
 * Get leads with stats
 * @param {string} repEmail - Rep email filter (or 'all')
 * @param {Object} filters - Query filters
 * @returns {Promise<Object>} - Leads and stats
 */
async function getLeadsWithStats(repEmail, filters = {}) {
  const [leads, stats] = await Promise.all([
    leadQualityDb.getLeadsByOwner(repEmail, filters),
    leadQualityDb.getStats(repEmail, filters)
  ]);

  return { leads, stats };
}

/**
 * Get default transcript analysis prompts
 * These can be customized via settings
 */
function getDefaultTranscriptPrompts() {
  return {
    system_prompt: `You are an expert sales analyst. Analyze call transcripts and evaluate lead quality based on the actual conversation.`,

    scoring_prompt: `Analyze this sales call and return a JSON object with:
{
  "post_call_score": <1-10 score based on call outcome and lead engagement>,
  "post_call_rationale": "<Brief explanation of score based on call>",
  "buying_signals": ["<list of positive buying signals from the call>"],
  "objections": ["<list of objections or concerns raised>"],
  "next_steps": "<any agreed next steps or follow-ups>",
  "deal_likelihood": "<low/medium/high>",
  "key_insights": "<most important takeaway from this call>",
  "budget_discussed": <true/false>,
  "timeline_discussed": <true/false>,
  "decision_maker_confirmed": <true/false>
}

SCORING GUIDELINES (1-10):
- 9-10: Clear buying intent, budget confirmed, timeline set, decision maker confirmed
- 7-8: Strong interest, some objections addressed, next steps agreed
- 5-6: Engaged conversation, mixed signals, follow-up needed
- 3-4: Low engagement, many objections, unclear next steps
- 1-2: Not qualified, wrong fit, or hostile interaction`
  };
}

/**
 * Get transcript analysis prompts from settings or defaults
 */
function getTranscriptAnalysisPrompts() {
  const config = secretManager.getTranscriptAnalysisPrompts();
  const defaults = getDefaultTranscriptPrompts();

  return {
    system_prompt: config.system_prompt || defaults.system_prompt,
    scoring_prompt: config.scoring_prompt || defaults.scoring_prompt
  };
}

/**
 * Analyze a past call transcript and re-evaluate lead score
 * @param {string} leadId - Lead ID
 * @param {Object} options - Analysis options
 * @param {string} options.model - 'gpt-5-nano' or 'perplexity-sonar'
 * @returns {Promise<Object>} - Updated lead with transcript analysis
 */
async function analyzeTranscript(leadId, options = {}) {
  const { model = 'gpt-5-nano' } = options;

  const lead = await leadQualityDb.getLead(leadId);
  if (!lead) {
    throw new Error('Lead not found');
  }

  // Check if we have a transcript ID
  let transcriptId = lead.transcriptId;

  if (!transcriptId) {
    // No transcript linked - check availability and try to auto-link
    const availability = await checkTranscriptAvailability(leadId);
    if (availability.availableInCallsTab) {
      transcriptId = availability.callsTabMatch.id;
      // Link the transcript to the lead
      await leadQualityDb.updateLead(leadId, { transcript_id: transcriptId });
    }
  }

  if (!transcriptId) {
    throw new Error('No transcript found for this lead. Use "Fetch Transcript" to link one first.');
  }

  // Get the full transcript
  const transcript = await transcriptDb.getTranscriptById(transcriptId);
  // Note: The database column is 'transcript_text' not 'transcript'
  const transcriptContent = transcript?.transcript_text;
  if (!transcript || !transcriptContent) {
    throw new Error('Transcript content not available');
  }

  // Get configurable prompts
  const prompts = getTranscriptAnalysisPrompts();

  // Build user prompt with lead context
  const userPrompt = `Lead Info:
- Name: ${lead.inviteeName || 'Unknown'}
- Email: ${lead.inviteeEmail}
- Company: ${lead.companyName || 'Unknown'}
- Website: ${lead.website || 'Unknown'}
- Pre-call Score: ${lead.totalScore || 'Not scored'}

${prompts.scoring_prompt}

Transcript:
${transcriptContent.substring(0, 15000)}`;

  let analysis;

  if (model === 'perplexity-sonar') {
    // Use Perplexity for analysis
    analysis = await analyzeTranscriptWithPerplexity(lead, userPrompt, prompts);
  } else {
    // Use OpenAI for analysis
    analysis = await analyzeTranscriptWithOpenAI(lead, userPrompt, prompts);
  }

  // Update the lead with transcript analysis
  const updated = await leadQualityDb.updateLead(leadId, {
    transcript_id: transcriptId,
    transcript_analysis_json: JSON.stringify({ ...analysis, model_used: model }),
    transcript_analyzed_at: new Date().toISOString(),
    post_call_score: analysis.post_call_score,
    post_call_rationale: analysis.post_call_rationale
  });

  return {
    ...updated,
    transcriptAnalysis: analysis,
    modelUsed: model
  };
}

/**
 * Analyze transcript using OpenAI GPT-5-nano
 */
async function analyzeTranscriptWithOpenAI(lead, userPrompt, prompts) {
  if (!llmService.isConfigured()) {
    throw new Error('OpenAI not configured. Add API key in settings.');
  }

  const result = await llmService.chatCompletion({
    systemPrompt: prompts.system_prompt,
    userPrompt,
    model: 'gpt-5-nano',
    maxTokens: 1000,
    temperature: 0.3
  });

  if (!result.success) {
    throw new Error(result.error || 'OpenAI analysis failed');
  }

  return parseTranscriptAnalysisResponse(result.content);
}

/**
 * Analyze transcript using Perplexity Sonar
 */
async function analyzeTranscriptWithPerplexity(lead, userPrompt, prompts) {
  if (!perplexityService.isConfigured()) {
    throw new Error('Perplexity not configured. Add API key in settings.');
  }

  const result = await perplexityService.perplexityRequest(userPrompt, {
    systemPrompt: prompts.system_prompt,
    maxTokens: 1500,
    temperature: 0.2
  });

  return parseTranscriptAnalysisResponse(result.content);
}

/**
 * Parse the JSON response from transcript analysis
 */
function parseTranscriptAnalysisResponse(content) {
  try {
    // Extract JSON from response (may be wrapped in markdown)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('No JSON found in response');
  } catch (parseError) {
    console.error('[LeadQuality] Failed to parse transcript analysis:', parseError);
    return {
      post_call_score: null,
      post_call_rationale: content,
      error: 'Failed to parse structured response'
    };
  }
}

/**
 * Check transcript availability for a lead
 * @param {string} leadId - Lead ID
 * @returns {Promise<Object>} - { hasTranscript, transcriptId, availableInCallsTab, availableInFireflies }
 */
async function checkTranscriptAvailability(leadId) {
  const lead = await leadQualityDb.getLead(leadId);
  if (!lead) {
    throw new Error('Lead not found');
  }

  const result = {
    hasTranscript: !!lead.transcriptId,
    transcriptId: lead.transcriptId,
    availableInCallsTab: false,
    availableInFireflies: false,
    callsTabMatch: null,
    firefliesMatch: null
  };

  if (!lead.transcriptId) {
    // Check Calls tab - get recent transcripts and filter by date range
    const bookingTime = new Date(lead.calendlyBookingTime).getTime();
    const searchStartDate = new Date(bookingTime - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const searchEndDate = new Date(bookingTime + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    try {
      const callsTabTranscripts = await transcriptDb.getRecentTranscripts(50, 0, {
        startDate: searchStartDate,
        endDate: searchEndDate
      });

      if (callsTabTranscripts && callsTabTranscripts.length > 0) {
        // Find transcript closest to booking time that matches by name or email
        const matches = callsTabTranscripts.filter(t => {
          // Check if title contains lead name
          const titleLower = (t.title || '').toLowerCase();
          const nameParts = (lead.inviteeName || '').toLowerCase().split(' ');
          const nameMatch = nameParts.some(part => part.length > 2 && titleLower.includes(part));

          // Check if participants contain email
          const participantsStr = JSON.stringify(t.participants || []).toLowerCase();
          const emailMatch = lead.inviteeEmail && participantsStr.includes(lead.inviteeEmail.toLowerCase());

          return nameMatch || emailMatch;
        });

        if (matches.length > 0) {
          // Find the closest match by time
          const closest = matches.reduce((prev, curr) => {
            const prevDiff = Math.abs(new Date(prev.call_datetime).getTime() - bookingTime);
            const currDiff = Math.abs(new Date(curr.call_datetime).getTime() - bookingTime);
            return currDiff < prevDiff ? curr : prev;
          });

          // Only match if within 2 hours of booking
          const timeDiff = Math.abs(new Date(closest.call_datetime).getTime() - bookingTime);
          if (timeDiff < 2 * 60 * 60 * 1000) {
            result.availableInCallsTab = true;
            result.callsTabMatch = {
              id: closest.id,
              title: closest.title,
              datetime: closest.call_datetime
            };
          }
        }
      }
    } catch (err) {
      console.warn('[LeadQuality] Calls tab check failed:', err.message);
    }

    // Check Fireflies
    try {
      const fireflies = require('./fireflies');
      if (fireflies.isConfigured && fireflies.isConfigured()) {
        const bookingStart = new Date(bookingTime - 60 * 60 * 1000);
        const bookingEnd = new Date(bookingTime + 2 * 60 * 60 * 1000);

        const ffTranscripts = await fireflies.getTranscriptsInDateRange(
          bookingStart.toISOString(),
          bookingEnd.toISOString()
        );

        if (ffTranscripts && ffTranscripts.length > 0) {
          // Find matching by email or name
          const match = ffTranscripts.find(t =>
            t.organizer_email?.toLowerCase().includes(lead.inviteeEmail?.toLowerCase()) ||
            t.title?.toLowerCase().includes(lead.inviteeName?.toLowerCase().split(' ')[0])
          );

          if (match) {
            result.availableInFireflies = true;
            result.firefliesMatch = {
              id: match.id,
              title: match.title,
              datetime: match.date
            };
          }
        }
      }
    } catch (err) {
      console.warn('[LeadQuality] Fireflies check failed:', err.message);
    }
  }

  return result;
}

/**
 * Fetch and link transcript from Calls tab or Fireflies
 * @param {string} leadId - Lead ID
 * @param {Object} options - Fetch options
 * @returns {Promise<Object>} - { success, transcriptId, source, synced, analyzed }
 */
async function fetchAndLinkTranscript(leadId, options = {}) {
  const { source = 'auto', syncToCallsTab = true, autoAnalyze = true } = options;

  const lead = await leadQualityDb.getLead(leadId);
  if (!lead) {
    throw new Error('Lead not found');
  }

  // Check availability first
  const availability = await checkTranscriptAvailability(leadId);

  // If source is 'auto', prefer Calls tab, then Fireflies
  let transcriptId = null;
  let actualSource = null;

  if (source === 'auto' || source === 'calls_tab') {
    if (availability.availableInCallsTab) {
      transcriptId = availability.callsTabMatch.id;
      actualSource = 'calls_tab';
    }
  }

  if (!transcriptId && (source === 'auto' || source === 'fireflies')) {
    if (availability.availableInFireflies) {
      // Fetch from Fireflies and optionally sync to Calls tab
      const fireflies = require('./fireflies');
      const ffTranscript = await fireflies.getTranscript(availability.firefliesMatch.id);

      if (syncToCallsTab) {
        // Sync to Calls tab
        const synced = await transcriptDb.upsertTranscript({
          fireflies_id: ffTranscript.id,
          title: ffTranscript.title,
          transcript: ffTranscript.sentences?.map(s => `${s.speaker_name || 'Speaker'}: ${s.text}`).join('\n') || ffTranscript.transcript_text,
          call_datetime: ffTranscript.date,
          duration: ffTranscript.duration,
          organizer_email: ffTranscript.organizer_email,
          participants: JSON.stringify(ffTranscript.participants || [])
        });
        transcriptId = synced.id;

        // Trigger full analysis if requested
        if (autoAnalyze) {
          try {
            const analysisService = require('./callAnalysisService');
            await analysisService.analyzeCall(transcriptId);
          } catch (err) {
            console.warn('[LeadQuality] Auto-analysis failed:', err.message);
          }
        }
      } else {
        // Just use Fireflies ID directly (not synced)
        transcriptId = availability.firefliesMatch.id;
      }

      actualSource = 'fireflies';
    }
  }

  if (!transcriptId) {
    return {
      success: false,
      error: 'No matching transcript found. Check Fireflies for the recording.',
      checkedCallsTab: availability.availableInCallsTab,
      checkedFireflies: availability.availableInFireflies
    };
  }

  // Link to lead
  await linkTranscript(leadId, transcriptId);

  return {
    success: true,
    transcriptId,
    source: actualSource,
    synced: actualSource === 'fireflies' && syncToCallsTab,
    analyzed: actualSource === 'fireflies' && syncToCallsTab && autoAnalyze
  };
}

/**
 * Link a transcript to a lead
 * @param {string} leadId - Lead ID
 * @param {string} transcriptId - Transcript ID
 * @returns {Promise<Object>} - Updated lead
 */
async function linkTranscript(leadId, transcriptId) {
  return leadQualityDb.updateLead(leadId, { transcript_id: transcriptId });
}

module.exports = {
  // Scoring functions (exported for testing)
  scoreCompanyStrength,
  scoreAffiliateReadiness,
  scoreBuyerAuthority,
  scoreInboundQuality,
  calculateTotalScore,
  detectAffiliateSoftwareInFormData,

  // Main functions
  analyzeLeadQuality,
  syncAndAnalyzeLeads,
  reanalyzeLead,
  getLeadsWithStats,
  analyzeTranscript,
  linkTranscript,
  checkTranscriptAvailability,
  fetchAndLinkTranscript,

  // Prompts
  getDefaultTranscriptPrompts,
  getTranscriptAnalysisPrompts,

  // Utilities
  isBusinessEmail,
  getEmailDomain,

  // Constants
  FREE_EMAIL_DOMAINS,
  AFFILIATE_SOFTWARE
};
