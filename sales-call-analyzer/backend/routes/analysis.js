const express = require('express');
const router = express.Router();
const fireflies = require('../services/fireflies');
const { analyzeTranscript, isSalesCall } = require('../services/analyzer');
const {
  saveCall,
  getCalls,
  getCallById,
  getCallByFirefliesId,
  getStats,
  getAggregatedPainPoints,
  getLanguageDatabase,
  getDFYReport,
  deleteCallsInRange
} = require('../services/database');
const { generateDFYReport } = require('../utils/dfyDetector');
const { aggregatePainPoints } = require('../utils/painPointExtractor');
const { getProspectDealStatus, isSlackConfigured } = require('../services/slack');

// Store analysis progress
const analysisProgress = {
  inProgress: false,
  current: 0,
  total: 0,
  currentCall: '',
  errors: [],
  skipped: 0
};

/**
 * GET /api/calls
 * Get analyzed calls with filters
 */
router.get('/calls', async (req, res) => {
  try {
    const { startDate, endDate, salesRep, limit, offset } = req.query;

    const calls = await getCalls({
      startDate,
      endDate,
      salesRep,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined
    });

    res.json({
      success: true,
      data: calls,
      count: calls.length
    });
  } catch (error) {
    console.error('Error getting calls:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/calls/:id
 * Get single call full analysis
 */
router.get('/calls/:id', async (req, res) => {
  try {
    const call = await getCallById(req.params.id);

    if (!call) {
      return res.status(404).json({
        success: false,
        error: 'Call not found'
      });
    }

    res.json({
      success: true,
      data: call
    });
  } catch (error) {
    console.error('Error getting call:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/analyze
 * Trigger analysis for calls
 */
router.post('/analyze', async (req, res) => {
  try {
    const { startDate, endDate, reanalyze, transcriptIds } = req.body;

    if (analysisProgress.inProgress) {
      return res.status(409).json({
        success: false,
        error: 'Analysis already in progress',
        progress: analysisProgress
      });
    }

    // Reset progress
    analysisProgress.inProgress = true;
    analysisProgress.current = 0;
    analysisProgress.total = 0;
    analysisProgress.currentCall = '';
    analysisProgress.errors = [];
    analysisProgress.skipped = 0;

    // Respond immediately
    res.json({
      success: true,
      message: 'Analysis started',
      progress: analysisProgress
    });

    // Run analysis in background
    runAnalysis(startDate, endDate, reanalyze, transcriptIds).catch(err => {
      console.error('Analysis error:', err);
      analysisProgress.errors.push(err.message);
    }).finally(() => {
      analysisProgress.inProgress = false;
    });

  } catch (error) {
    analysisProgress.inProgress = false;
    console.error('Error starting analysis:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Background analysis function
 */
async function runAnalysis(startDate, endDate, reanalyze, transcriptIds) {
  let transcriptsToAnalyze = [];

  if (transcriptIds && transcriptIds.length > 0) {
    // Analyze specific transcripts
    analysisProgress.total = transcriptIds.length;

    for (const id of transcriptIds) {
      try {
        const existing = await getCallByFirefliesId(id);
        if (existing && !reanalyze) continue;

        const transcript = await fireflies.getTranscript(id);
        if (transcript) {
          transcriptsToAnalyze.push(transcript);
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (err) {
        analysisProgress.errors.push(`Error fetching ${id}: ${err.message}`);
      }
    }
  } else if (startDate && endDate) {
    // Get transcripts in date range
    const transcripts = await fireflies.getTranscriptsInDateRange(startDate, endDate);

    // If reanalyze, delete existing analyses in range first
    if (reanalyze) {
      await deleteCallsInRange(startDate, endDate);
    }

    // Filter out already analyzed unless reanalyze
    for (const t of transcripts) {
      const existing = await getCallByFirefliesId(t.id);
      if (!existing || reanalyze) {
        transcriptsToAnalyze.push(t);
      }
    }
  } else {
    // Get new transcripts (not yet analyzed)
    const existingCalls = await getCalls({ limit: 1000 });
    const existingIds = existingCalls.map(c => c.fireflies_id);
    const newTranscripts = await fireflies.getNewTranscripts(existingIds);
    transcriptsToAnalyze = newTranscripts;
  }

  analysisProgress.total = transcriptsToAnalyze.length;

  // Analyze each transcript
  for (let i = 0; i < transcriptsToAnalyze.length; i++) {
    const t = transcriptsToAnalyze[i];
    analysisProgress.current = i + 1;
    analysisProgress.currentCall = t.title || t.id;

    try {
      // Skip non-sales calls (catch-ups, weekly meetings, etc.)
      if (!isSalesCall(t.title, t.participants)) {
        console.log(`Skipping non-sales call: ${t.title}`);
        analysisProgress.skipped++;
        continue;
      }

      // Fetch full transcript if we only have summary
      let fullTranscript = t;
      if (!t.sentences) {
        fullTranscript = await fireflies.getTranscript(t.id);
      }

      if (!fullTranscript || !fullTranscript.sentences) {
        analysisProgress.errors.push(`No transcript data for ${t.id}`);
        continue;
      }

      // Analyze
      const analysis = analyzeTranscript(fullTranscript);

      // Save to database
      await saveCall(analysis);

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (err) {
      console.error(`Error analyzing ${t.id}:`, err);
      analysisProgress.errors.push(`Error analyzing ${t.title || t.id}: ${err.message}`);
    }
  }
}

/**
 * GET /api/analyze/progress
 * Get current analysis progress
 */
router.get('/analyze/progress', (req, res) => {
  res.json({
    success: true,
    data: analysisProgress
  });
});

/**
 * GET /api/stats
 * Get aggregated statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const { startDate, endDate, salesRep } = req.query;

    const stats = await getStats({ startDate, endDate, salesRep });

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/pain-points
 * Get aggregated pain points with ALL quotes for "See more" functionality
 */
router.get('/pain-points', async (req, res) => {
  try {
    const { startDate, endDate, salesRep, limit } = req.query;

    const rawPainPoints = await getAggregatedPainPoints({ startDate, endDate, salesRep });

    // Group by category - keep ALL quotes
    const grouped = {};
    for (const pp of rawPainPoints) {
      if (!grouped[pp.category]) {
        grouped[pp.category] = {
          category: pp.category,
          count: 0,
          quotes: []
        };
      }
      grouped[pp.category].count++;
      grouped[pp.category].quotes.push({
        quote: pp.quote,
        context: pp.context,
        prospect: pp.prospect_name,
        date: pp.date,
        intensity: pp.intensity,
        timestamp: pp.timestamp,
        callId: pp.call_id
      });
    }

    // Sort by count and sort quotes by intensity/date
    const result = Object.values(grouped)
      .sort((a, b) => b.count - a.count)
      .map(g => ({
        ...g,
        // Sort quotes: high intensity first, then most recent
        quotes: g.quotes.sort((a, b) => {
          const intensityOrder = { 'High': 0, 'Medium': 1, 'Low': 2 };
          const intensityDiff = (intensityOrder[a.intensity] || 1) - (intensityOrder[b.intensity] || 1);
          if (intensityDiff !== 0) return intensityDiff;
          return new Date(b.date) - new Date(a.date);
        })
        // Note: NOT limiting quotes - frontend will handle "See more"
      }));

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error getting pain points:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/language
 * Get customer language database
 */
router.get('/language', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const language = await getLanguageDatabase({ startDate, endDate });

    // Group by type
    const grouped = {
      industry_term: [],
      emotional: [],
      metaphor: [],
      power_word: []
    };

    for (const item of language) {
      if (grouped[item.type]) {
        grouped[item.type].push({
          phrase: item.phrase,
          context: item.context,
          prospect: item.prospect_name,
          date: item.date
        });
      }
    }

    res.json({
      success: true,
      data: grouped
    });
  } catch (error) {
    console.error('Error getting language database:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/dfy-report
 * Get DFY tracking report
 */
router.get('/dfy-report', async (req, res) => {
  try {
    const { startDate, endDate, salesRep } = req.query;

    const report = await getDFYReport({ startDate, endDate, salesRep });

    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    console.error('Error getting DFY report:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/export
 * Export report as markdown
 */
router.post('/export', async (req, res) => {
  try {
    const { startDate, endDate, salesRep, format } = req.body;

    const calls = await getCalls({ startDate, endDate, salesRep });
    const stats = await getStats({ startDate, endDate, salesRep });
    const dfyReport = await getDFYReport({ startDate, endDate, salesRep });

    const markdown = generateMarkdownReport(calls, stats, dfyReport, { startDate, endDate, salesRep });

    if (format === 'json') {
      res.json({
        success: true,
        data: { calls, stats, dfyReport }
      });
    } else {
      res.setHeader('Content-Type', 'text/markdown');
      res.setHeader('Content-Disposition', `attachment; filename=sales-analysis-${startDate || 'all'}-${endDate || 'time'}.md`);
      res.send(markdown);
    }
  } catch (error) {
    console.error('Error exporting report:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Generate markdown report
 */
function generateMarkdownReport(calls, stats, dfyReport, filters) {
  const dateRange = filters.startDate && filters.endDate
    ? `${filters.startDate} to ${filters.endDate}`
    : 'All Time';

  const rep = filters.salesRep && filters.salesRep !== 'all'
    ? filters.salesRep
    : 'All Reps';

  let md = `# AffiliateFinder.ai Sales Call Analysis Report

**Date Range:** ${dateRange}
**Sales Rep:** ${rep}
**Generated:** ${new Date().toISOString()}

---

## Summary Statistics

| Metric | Value |
|--------|-------|
| Total Calls Analyzed | ${stats.totalCalls} |
| Conversion Rate | ${stats.conversionRate}% |
| Software-Only Pitches | ${stats.softwareOnlyRate}% |
| DFY Mentions | ${stats.dfyMentions} |
| Average Duration | ${stats.avgDuration} minutes |
| Average Pain Level | ${stats.avgPainLevel}/10 |
| Average Score | ${stats.avgScore}/100 |

## Top Pain Points

`;

  if (stats.topPainPoints && stats.topPainPoints.length > 0) {
    for (const pp of stats.topPainPoints) {
      md += `- **${pp.category}** (${pp.count} mentions)\n`;
    }
  } else {
    md += `_No pain points recorded_\n`;
  }

  md += `\n## DFY Analysis

| Metric | Value |
|--------|-------|
| Total DFY Mentions | ${dfyReport.mentions?.length || 0} |
| Initiated by Prospect | ${dfyReport.byInitiator?.find(i => i.who_initiated === 'prospect')?.count || 0} |
| Initiated by Sales | ${dfyReport.byInitiator?.find(i => i.who_initiated === 'sales')?.count || 0} |

### Classification Breakdown

`;

  if (dfyReport.byClassification && dfyReport.byClassification.length > 0) {
    for (const c of dfyReport.byClassification) {
      const emoji = c.classification === 'avoidable' ? '⚠️' : c.classification === 'justified' ? '✅' : '❓';
      md += `- ${emoji} **${c.classification}**: ${c.count}\n`;
    }
  } else {
    md += `_No DFY mentions recorded_\n`;
  }

  md += `\n---\n\n## Call Details\n\n`;

  for (const call of calls) {
    const analysis = call.analysis || {};
    const offerEmoji = call.offer_pitched === 'software_only' ? '✅' : '⚠️';

    md += `### ${call.prospect_name || 'Unknown'} - ${call.date}

- **Sales Rep:** ${call.sales_rep || 'Unknown'}
- **Duration:** ${call.duration || 0} minutes
- **Outcome:** ${call.outcome || 'Unknown'}
- **Offer:** ${offerEmoji} ${call.offer_pitched || 'Unknown'}
- **Pain Level:** ${call.pain_level || 5}/10
- **Score:** ${call.overall_score || 0}/100

`;

    // Pain points
    if (analysis.painPoints) {
      const allPains = [
        ...(analysis.painPoints.immediate || []),
        ...(analysis.painPoints.shortTerm || []),
        ...(analysis.painPoints.longTerm || [])
      ];

      if (allPains.length > 0) {
        md += `**Pain Points:**\n`;
        for (const pp of allPains.slice(0, 3)) {
          md += `> "${pp.quote}"\n> _Category: ${pp.category} | Intensity: ${pp.intensity}_\n\n`;
        }
      }
    }

    md += `---\n\n`;
  }

  return md;
}

/**
 * GET /api/slack/status
 * Check if Slack integration is configured
 */
router.get('/slack/status', (req, res) => {
  res.json({
    success: true,
    data: {
      configured: isSlackConfigured(),
      hasToken: !!process.env.SLACK_BOT_TOKEN
    }
  });
});

/**
 * GET /api/slack/deal-status/:callId
 * Get deal status for a specific call's prospect from Slack
 */
router.get('/slack/deal-status/:callId', async (req, res) => {
  try {
    if (!isSlackConfigured()) {
      return res.json({
        success: false,
        error: 'Slack integration not configured'
      });
    }

    const call = await getCallById(req.params.callId);
    if (!call) {
      return res.status(404).json({
        success: false,
        error: 'Call not found'
      });
    }

    const analysis = call.analysis || {};
    const prospectName = call.prospect_name;
    const website = analysis.prospectProfile?.website;
    const brand = analysis.prospectProfile?.company;

    const dealStatus = await getProspectDealStatus(prospectName, website, brand);

    res.json({
      success: true,
      data: {
        callId: call.id,
        prospectName,
        ...dealStatus
      }
    });
  } catch (error) {
    console.error('Error getting deal status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/slack/check-deal
 * Check deal status for a prospect by name/website/brand
 */
router.post('/slack/check-deal', async (req, res) => {
  try {
    if (!isSlackConfigured()) {
      return res.json({
        success: false,
        error: 'Slack integration not configured'
      });
    }

    const { prospectName, website, brand } = req.body;

    if (!prospectName && !website && !brand) {
      return res.status(400).json({
        success: false,
        error: 'At least one of prospectName, website, or brand is required'
      });
    }

    const dealStatus = await getProspectDealStatus(prospectName, website, brand);

    res.json({
      success: true,
      data: dealStatus
    });
  } catch (error) {
    console.error('Error checking deal:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/slack/bulk-check
 * Check deal status for all analyzed calls
 */
router.get('/slack/bulk-check', async (req, res) => {
  try {
    if (!isSlackConfigured()) {
      return res.json({
        success: false,
        error: 'Slack integration not configured'
      });
    }

    const { startDate, endDate, limit } = req.query;

    const calls = await getCalls({
      startDate,
      endDate,
      limit: limit ? parseInt(limit) : 100
    });

    const results = [];

    for (const call of calls) {
      const analysis = call.analysis || {};
      const prospectName = call.prospect_name;
      const website = analysis.prospectProfile?.website;
      const brand = analysis.prospectProfile?.company;

      try {
        const dealStatus = await getProspectDealStatus(prospectName, website, brand);
        results.push({
          callId: call.id,
          prospectName,
          date: call.date,
          ...dealStatus.summary
        });
      } catch (err) {
        results.push({
          callId: call.id,
          prospectName,
          date: call.date,
          error: err.message
        });
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Summary stats
    const summary = {
      totalChecked: results.length,
      dealsClosed: results.filter(r => r.dealClosed).length,
      softwareDeals: results.filter(r => r.dealType === 'software').length,
      dfyDeals: results.filter(r => r.dealType === 'dfy').length,
      activeCustomers: results.filter(r => r.isActive).length,
      churned: results.filter(r => r.isChurned).length,
      notFound: results.filter(r => r.status === 'not_found').length
    };

    res.json({
      success: true,
      data: {
        summary,
        results
      }
    });
  } catch (error) {
    console.error('Error in bulk check:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
