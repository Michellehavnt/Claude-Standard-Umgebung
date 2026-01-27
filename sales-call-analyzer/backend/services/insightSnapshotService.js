/**
 * Insight Snapshot Generator Service
 *
 * Generates structured, decision-ready summaries for a given date range.
 * Focuses on marketing-relevant insights: prospect language, conversion patterns,
 * and actionable recommendations.
 *
 * OUTPUT FORMAT:
 * - summary: 5-7 bullet insights for marketing/founder
 * - top_pains: ranked with conversion deltas and verbatim quotes
 * - top_goals: ranked with conversion deltas
 * - key_questions: by topic with buying-signal correlation
 * - excitement_triggers: ranked by conversion lift
 * - dfy_analysis: Phil's DFY pitch patterns
 * - churn_signals: patterns in churned users only
 * - recommendations: sales + positioning directives
 */

const dashboardAggregation = require('./dashboardAggregationService');
const stripeEnrichment = require('./stripeEnrichmentService');
const dfyPitchService = require('./dfyPitchService');

/**
 * Enrich transcripts with Stripe data
 * @param {Array} transcripts - Array of transcript objects
 * @returns {Promise<Array>} - Transcripts with stripeData attached
 */
async function enrichWithStripeData(transcripts) {
  const enriched = [];

  for (const transcript of transcripts) {
    try {
      const stripeData = await stripeEnrichment.enrichCall(transcript);
      enriched.push({
        ...transcript,
        stripeData
      });
    } catch (error) {
      // If enrichment fails, continue without Stripe data
      enriched.push({
        ...transcript,
        stripeData: { matched: false, status: 'unmatched', error: error.message }
      });
    }
  }

  return enriched;
}

/**
 * Calculate conversion delta for an insight item
 * Compares conversion rate of calls WITH this item vs WITHOUT
 *
 * @param {string} itemKey - The key to match (e.g., pain category, goal text)
 * @param {string} itemType - Type of insight ('pain', 'goal', 'question', 'excitement')
 * @param {Array} transcripts - All transcripts with Stripe data
 * @returns {Object} - { withItem, withoutItem, delta }
 */
function calculateConversionDelta(itemKey, itemType, transcripts) {
  const callsWithItem = [];
  const callsWithoutItem = [];

  for (const t of transcripts) {
    if (!t.analysis?.insights) continue;

    let hasItem = false;

    switch (itemType) {
      case 'pain':
        hasItem = t.analysis.insights.pains?.some(p => p.category === itemKey);
        break;
      case 'goal':
        hasItem = t.analysis.insights.goals?.some(g => g.goal === itemKey);
        break;
      case 'question':
        hasItem = t.analysis.insights.questions?.some(q =>
          q.question?.toLowerCase().includes(itemKey.toLowerCase())
        );
        break;
      case 'excitement':
        hasItem = t.analysis.insights.excitement_triggers?.some(e => e.trigger === itemKey);
        break;
    }

    if (hasItem) {
      callsWithItem.push(t);
    } else {
      callsWithoutItem.push(t);
    }
  }

  // Calculate conversion rates
  const getConversionRate = (calls) => {
    if (calls.length === 0) return 0;
    const converted = calls.filter(c =>
      c.stripeData?.matched &&
      ['active', 'trialing', 'canceled'].includes(c.stripeData.status)
    ).length;
    return Math.round((converted / calls.length) * 100);
  };

  const withItemRate = getConversionRate(callsWithItem);
  const withoutItemRate = getConversionRate(callsWithoutItem);
  const delta = withItemRate - withoutItemRate;

  return {
    withItem: withItemRate,
    withoutItem: withoutItemRate,
    delta,
    deltaFormatted: delta >= 0 ? `+${delta}%` : `${delta}%`,
    callsWithItem: callsWithItem.length,
    callsWithoutItem: callsWithoutItem.length
  };
}

/**
 * Classify a DFY pitch as justified, avoidable, or premature
 *
 * JUSTIFIED: Prospect showed need (resource/time constraints)
 * PREMATURE: Pitched early without establishing context
 * AVOIDABLE: Prospect had capability/team, didn't need DFY
 *
 * @param {Object} pitch - DFY pitch object from dfyPitchService
 * @returns {string} - 'justified' | 'avoidable' | 'premature'
 */
function classifyDFYPitch(pitch) {
  // Justified if prospect showed clear need
  if (pitch.prospectNeed) {
    return 'justified';
  }

  // Premature if pitched early without trigger
  if (pitch.trigger?.category === 'PROACTIVE' && !pitch.prospectNeed) {
    // Check line position - if in first 20% of call, likely premature
    if (pitch.lineIndex !== undefined && pitch.lineIndex < 10) {
      return 'premature';
    }
  }

  // Check trigger category
  const justifiedTriggers = ['TIME', 'RESOURCE', 'CAPABILITY'];
  if (justifiedTriggers.includes(pitch.trigger?.category)) {
    return 'justified';
  }

  // If hypothetical mention, it's more exploratory
  if (pitch.isHypothetical) {
    return 'justified'; // Offering options is OK
  }

  // Default to avoidable if no clear justification
  return 'avoidable';
}

/**
 * Analyze DFY pitches for Phil
 * @param {Array} transcripts - Transcripts with analysis
 * @returns {Object} - DFY analysis summary
 */
function analyzeDFYPitches(transcripts) {
  const philTranscripts = transcripts.filter(t =>
    t.rep_name?.toLowerCase().includes('phil')
  );

  const allPitches = [];
  const classificationCounts = { justified: 0, avoidable: 0, premature: 0 };
  const conversionByClass = { justified: [], avoidable: [], premature: [] };

  for (const t of philTranscripts) {
    const pitches = dfyPitchService.detectDFYPitches(t);

    for (const pitch of pitches) {
      const classification = classifyDFYPitch(pitch);
      classificationCounts[classification]++;

      allPitches.push({
        ...pitch,
        classification,
        stripeStatus: t.stripeData?.status || 'unmatched'
      });

      // Track for conversion calculation
      if (t.stripeData?.matched) {
        conversionByClass[classification].push(t.stripeData.status);
      }
    }
  }

  // Calculate conversion rates by classification
  const calcConvRate = (statuses) => {
    if (statuses.length === 0) return 0;
    const converted = statuses.filter(s => ['active', 'trialing'].includes(s)).length;
    return Math.round((converted / statuses.length) * 100);
  };

  const totalPitches = allPitches.length;
  const summary = totalPitches > 0
    ? `Phil pitched DFY ${totalPitches} times this period. ${classificationCounts.justified} were justified (resource/time triggers), ${classificationCounts.avoidable} avoidable (prospect had team), ${classificationCounts.premature} premature (before pain discovery).`
    : 'No DFY pitches detected from Phil in this period.';

  return {
    phil_summary: summary,
    total_pitches: totalPitches,
    justified_vs_avoidable_vs_premature: classificationCounts,
    conversion_by_classification: {
      justified: calcConvRate(conversionByClass.justified),
      avoidable: calcConvRate(conversionByClass.avoidable),
      premature: calcConvRate(conversionByClass.premature)
    },
    pitches: allPitches.slice(0, 10) // Top 10 for detail
  };
}

/**
 * Identify patterns that appear disproportionately in churned calls
 * @param {Array} transcripts - Transcripts with Stripe data
 * @returns {Array} - Churn signals
 */
function identifyChurnSignals(transcripts) {
  const churnedCalls = transcripts.filter(t => t.stripeData?.status === 'canceled');
  const activeCalls = transcripts.filter(t => t.stripeData?.status === 'active');

  if (churnedCalls.length === 0) {
    return [];
  }

  // Count pain categories in churned vs active
  const countPainCategories = (calls) => {
    const counts = {};
    for (const t of calls) {
      const pains = t.analysis?.insights?.pains || [];
      for (const pain of pains) {
        const cat = pain.category || 'Other';
        counts[cat] = (counts[cat] || 0) + 1;
      }
    }
    return counts;
  };

  const churnedPains = countPainCategories(churnedCalls);
  const activePains = countPainCategories(activeCalls);

  // Find pains that are disproportionately in churned
  const signals = [];

  for (const [category, churnedCount] of Object.entries(churnedPains)) {
    const activeCount = activePains[category] || 0;
    const churnedRate = churnedCount / churnedCalls.length;
    const activeRate = activeCalls.length > 0 ? activeCount / activeCalls.length : 0;

    // If appears 2x more often in churned, it's a signal
    if (churnedRate > activeRate * 1.5 && churnedCount >= 2) {
      signals.push({
        pattern: category,
        type: 'pain_point',
        occurrencesInChurned: churnedCount,
        occurrencesInActive: activeCount,
        churnedRate: Math.round(churnedRate * 100),
        activeRate: Math.round(activeRate * 100)
      });
    }
  }

  // Sort by disparity
  signals.sort((a, b) => (b.churnedRate - b.activeRate) - (a.churnedRate - a.activeRate));

  return signals.slice(0, 5); // Top 5 signals
}

/**
 * Extract verbatim quotes for marketing use
 * @param {Array} items - Array of pain/goal/excitement items
 * @param {number} maxQuotes - Maximum quotes per item
 * @returns {Array} - Items with verbatim_quotes array
 */
function extractVerbatimQuotes(items, maxQuotes = 3) {
  return items.map(item => ({
    ...item,
    verbatim_quotes: (item.sampleQuotes || []).slice(0, maxQuotes)
  }));
}

/**
 * Generate actionable recommendations based on snapshot data
 * @param {Object} data - Snapshot data (pains, goals, excitement, dfy, churn)
 * @returns {Object} - { sales: [...], positioning: [...] }
 */
function generateRecommendations(data) {
  const sales = [];
  const positioning = [];

  // Excitement-based recommendations
  if (data.excitement && data.excitement.length > 0) {
    const topTrigger = data.excitement[0];
    if (topTrigger.conversionDelta?.delta > 10) {
      sales.push(`Lead with "${topTrigger.trigger}" language - strongest conversion signal (+${topTrigger.conversionDelta.delta}%)`);
      positioning.push(`Homepage should emphasize: "${topTrigger.verbatim_quotes?.[0] || topTrigger.trigger}"`);
    }
  }

  // Pain-based recommendations
  if (data.pains && data.pains.length > 0) {
    const topPain = data.pains[0];
    if (topPain.conversionDelta?.delta > 5) {
      positioning.push(`Address "${topPain.category}" prominently - mentioned in ${topPain.calls} calls with +${topPain.conversionDelta.delta}% conversion lift`);
    }
  }

  // DFY recommendations
  if (data.dfy) {
    const { justified_vs_avoidable_vs_premature: counts, conversion_by_classification: conv } = data.dfy;

    if (counts.premature > 0) {
      sales.push(`Avoid DFY pitch before minute 15 unless prospect explicitly asks - ${counts.premature} premature pitches detected`);
    }

    if (counts.justified > counts.avoidable && conv.justified > conv.avoidable) {
      sales.push(`DFY pitch works when triggered by resource/time constraints (${conv.justified}% conversion vs ${conv.avoidable}% when avoidable)`);
    }
  }

  // Churn signal recommendations
  if (data.churnSignals && data.churnSignals.length > 0) {
    const topSignal = data.churnSignals[0];
    positioning.push(`Add FAQ section addressing "${topSignal.pattern}" - ${topSignal.churnedRate}% of churned users mentioned this vs ${topSignal.activeRate}% of active`);
  }

  // Question-based recommendations
  if (data.questions && data.questions.length > 0) {
    const topQuestion = data.questions[0];
    if (topQuestion.occurrences >= 3) {
      positioning.push(`Create content answering: "${topQuestion.question}" (asked ${topQuestion.occurrences} times)`);
    }
  }

  // Ensure we have at least some recommendations
  if (sales.length === 0) {
    sales.push('Continue current sales approach - no significant patterns detected');
  }
  if (positioning.length === 0) {
    positioning.push('Review call transcripts for messaging opportunities');
  }

  return { sales, positioning };
}

/**
 * Generate summary bullets for the snapshot
 * @param {Object} data - Full snapshot data
 * @returns {Array} - 5-7 summary bullets
 */
function generateSummaryBullets(data) {
  const bullets = [];

  // Conversion insight
  if (data.conversionMetrics) {
    const { conversionRate, matchedCalls, totalCalls } = data.conversionMetrics;
    bullets.push(`${matchedCalls} of ${totalCalls} calls matched to Stripe customers with ${conversionRate}% conversion rate`);
  }

  // Top excitement trigger
  if (data.excitement?.[0]) {
    const top = data.excitement[0];
    if (top.conversionDelta?.delta > 0) {
      bullets.push(`"${top.trigger}" is the strongest buying signal with +${top.conversionDelta.delta}% conversion lift`);
    }
  }

  // Top pain point
  if (data.pains?.[0]) {
    const top = data.pains[0];
    bullets.push(`"${top.category}" is the most common pain point (${top.occurrences} mentions across ${top.calls} calls)`);
  }

  // DFY insight
  if (data.dfy?.total_pitches > 0) {
    const { justified_vs_avoidable_vs_premature: counts } = data.dfy;
    const justifiedPct = Math.round((counts.justified / data.dfy.total_pitches) * 100);
    bullets.push(`DFY pitch timing: ${justifiedPct}% justified, ${counts.avoidable} could have been avoided`);
  }

  // Churn insight
  if (data.churnSignals?.[0]) {
    const signal = data.churnSignals[0];
    bullets.push(`Churn signal: "${signal.pattern}" appeared ${signal.churnedRate}% in churned vs ${signal.activeRate}% in active customers`);
  }

  // Question insight
  if (data.questions?.[0]) {
    bullets.push(`Most asked question: "${data.questions[0].question}" (${data.questions[0].occurrences} times)`);
  }

  // Goal insight
  if (data.goals?.[0]) {
    bullets.push(`Top prospect goal: "${data.goals[0].goal}" (${data.goals[0].calls} calls)`);
  }

  return bullets.slice(0, 7); // Max 7 bullets
}

/**
 * Generate a complete insight snapshot
 *
 * @param {Object} filters - { startDate, endDate, rep }
 * @returns {Promise<Object>} - Complete snapshot object
 */
async function generateSnapshot(filters) {
  if (!filters.startDate || !filters.endDate) {
    throw new Error('startDate and endDate are required');
  }

  // Get filtered transcripts
  const transcripts = await dashboardAggregation.getFilteredAnalyzedTranscripts(filters);

  if (transcripts.length === 0) {
    return {
      summary: ['No analyzed calls found for this date range'],
      filters,
      totalCalls: 0,
      top_pains: [],
      top_goals: [],
      key_questions: [],
      excitement_triggers: [],
      dfy_analysis: {
        phil_summary: 'No calls to analyze',
        total_pitches: 0,
        justified_vs_avoidable_vs_premature: { justified: 0, avoidable: 0, premature: 0 },
        conversion_by_classification: { justified: 0, avoidable: 0, premature: 0 }
      },
      churn_signals: [],
      recommendations: { sales: [], positioning: [] }
    };
  }

  // Enrich with Stripe data
  const enrichedTranscripts = await enrichWithStripeData(transcripts);

  // Calculate conversion metrics
  const conversionMetrics = stripeEnrichment.calculateConversionMetrics(enrichedTranscripts);

  // Aggregate insights
  const pains = dashboardAggregation.aggregatePains(enrichedTranscripts);
  const goals = dashboardAggregation.aggregateGoals(enrichedTranscripts);
  const questions = dashboardAggregation.aggregateQuestions(enrichedTranscripts);
  const excitement = dashboardAggregation.aggregateExcitement(enrichedTranscripts);

  // Add conversion deltas to top items
  const painsWithDelta = pains.slice(0, 10).map(p => ({
    ...p,
    conversionDelta: calculateConversionDelta(p.category, 'pain', enrichedTranscripts)
  }));

  const goalsWithDelta = goals.slice(0, 10).map(g => ({
    ...g,
    conversionDelta: calculateConversionDelta(g.goal, 'goal', enrichedTranscripts)
  }));

  const excitementWithDelta = excitement.slice(0, 10).map(e => ({
    ...e,
    conversionDelta: calculateConversionDelta(e.trigger, 'excitement', enrichedTranscripts)
  }));

  // Extract verbatim quotes
  const painsWithQuotes = extractVerbatimQuotes(painsWithDelta);
  const excitementWithQuotes = extractVerbatimQuotes(excitementWithDelta);

  // Analyze DFY pitches
  const dfyAnalysis = analyzeDFYPitches(enrichedTranscripts);

  // Identify churn signals
  const churnSignals = identifyChurnSignals(enrichedTranscripts);

  // Build the snapshot data object
  const snapshotData = {
    pains: painsWithQuotes,
    goals: goalsWithDelta,
    questions: questions.slice(0, 10),
    excitement: excitementWithQuotes,
    dfy: dfyAnalysis,
    churnSignals,
    conversionMetrics
  };

  // Generate recommendations
  const recommendations = generateRecommendations(snapshotData);

  // Generate summary bullets
  const summary = generateSummaryBullets(snapshotData);

  return {
    summary,
    filters,
    generatedAt: new Date().toISOString(),
    totalCalls: transcripts.length,
    conversionMetrics,
    top_pains: painsWithQuotes,
    top_goals: goalsWithDelta,
    key_questions: questions.slice(0, 10),
    excitement_triggers: excitementWithQuotes,
    dfy_analysis: dfyAnalysis,
    churn_signals: churnSignals,
    recommendations
  };
}

/**
 * Format snapshot as Notion-flavored markdown
 * @param {Object} snapshot - Generated snapshot
 * @returns {string} - Markdown string
 */
function formatForNotion(snapshot) {
  let md = `# Insight Snapshot\n\n`;
  md += `**Generated:** ${new Date(snapshot.generatedAt).toLocaleDateString()}\n`;
  md += `**Period:** ${snapshot.filters.startDate} to ${snapshot.filters.endDate}\n`;
  if (snapshot.filters.rep) {
    md += `**Rep:** ${snapshot.filters.rep}\n`;
  }
  md += `**Total Calls:** ${snapshot.totalCalls}\n\n`;

  // Summary
  md += `## Summary\n\n`;
  for (const bullet of snapshot.summary) {
    md += `- ${bullet}\n`;
  }
  md += `\n`;

  // Top Pain Points
  if (snapshot.top_pains.length > 0) {
    md += `## Top Pain Points\n\n`;
    for (const pain of snapshot.top_pains.slice(0, 5)) {
      md += `### ${pain.category} (${pain.occurrences} mentions, ${pain.conversionDelta?.deltaFormatted || 'N/A'} conversion)\n\n`;
      if (pain.verbatim_quotes?.length > 0) {
        for (const quote of pain.verbatim_quotes) {
          md += `> "${quote}"\n\n`;
        }
      }
    }
  }

  // Excitement Triggers
  if (snapshot.excitement_triggers.length > 0) {
    md += `## Excitement Triggers\n\n`;
    for (const trigger of snapshot.excitement_triggers.slice(0, 5)) {
      md += `- **${trigger.trigger}** - ${trigger.occurrences} mentions, ${trigger.conversionDelta?.deltaFormatted || 'N/A'} lift\n`;
      if (trigger.verbatim_quotes?.[0]) {
        md += `  > "${trigger.verbatim_quotes[0]}"\n`;
      }
    }
    md += `\n`;
  }

  // DFY Analysis
  md += `## DFY Analysis\n\n`;
  md += `${snapshot.dfy_analysis.phil_summary}\n\n`;
  const counts = snapshot.dfy_analysis.justified_vs_avoidable_vs_premature;
  md += `| Classification | Count | Conversion |\n`;
  md += `|----------------|-------|------------|\n`;
  md += `| Justified | ${counts.justified} | ${snapshot.dfy_analysis.conversion_by_classification.justified}% |\n`;
  md += `| Avoidable | ${counts.avoidable} | ${snapshot.dfy_analysis.conversion_by_classification.avoidable}% |\n`;
  md += `| Premature | ${counts.premature} | ${snapshot.dfy_analysis.conversion_by_classification.premature}% |\n\n`;

  // Churn Signals
  if (snapshot.churn_signals.length > 0) {
    md += `## Churn Signals\n\n`;
    for (const signal of snapshot.churn_signals) {
      md += `- **${signal.pattern}**: ${signal.churnedRate}% in churned vs ${signal.activeRate}% in active\n`;
    }
    md += `\n`;
  }

  // Recommendations
  md += `## Recommendations\n\n`;
  md += `### Sales\n\n`;
  for (const rec of snapshot.recommendations.sales) {
    md += `- ${rec}\n`;
  }
  md += `\n### Positioning\n\n`;
  for (const rec of snapshot.recommendations.positioning) {
    md += `- ${rec}\n`;
  }

  return md;
}

/**
 * Format snapshot as Slack Block Kit JSON
 * @param {Object} snapshot - Generated snapshot
 * @returns {Object} - Slack blocks array
 */
function formatForSlack(snapshot) {
  const blocks = [];

  // Header
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: '📊 Insight Snapshot',
      emoji: true
    }
  });

  // Context
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `*Period:* ${snapshot.filters.startDate} to ${snapshot.filters.endDate} | *Calls:* ${snapshot.totalCalls}`
      }
    ]
  });

  blocks.push({ type: 'divider' });

  // Summary
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*Summary*\n' + snapshot.summary.map(b => `• ${b}`).join('\n')
    }
  });

  blocks.push({ type: 'divider' });

  // Top Pain Points (compact)
  if (snapshot.top_pains.length > 0) {
    const painText = snapshot.top_pains.slice(0, 3).map(p =>
      `*${p.category}* (${p.occurrences} mentions, ${p.conversionDelta?.deltaFormatted || 'N/A'})`
    ).join('\n');

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*🎯 Top Pain Points*\n${painText}`
      }
    });
  }

  // DFY Summary
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*📞 DFY Analysis*\n${snapshot.dfy_analysis.phil_summary}`
    }
  });

  blocks.push({ type: 'divider' });

  // Recommendations
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*💡 Recommendations*\n' +
        '*Sales:*\n' + snapshot.recommendations.sales.map(r => `• ${r}`).join('\n') +
        '\n\n*Positioning:*\n' + snapshot.recommendations.positioning.map(r => `• ${r}`).join('\n')
    }
  });

  return { blocks };
}

module.exports = {
  generateSnapshot,
  formatForNotion,
  formatForSlack,
  // Exported for testing
  calculateConversionDelta,
  classifyDFYPitch,
  analyzeDFYPitches,
  identifyChurnSignals,
  extractVerbatimQuotes,
  generateRecommendations,
  generateSummaryBullets,
  enrichWithStripeData
};
