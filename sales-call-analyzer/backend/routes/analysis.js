const express = require('express');
const router = express.Router();
const fireflies = require('../services/fireflies');
const { analyzeTranscript } = require('../services/analyzer');
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

// Store analysis progress
const analysisProgress = {
  inProgress: false,
  current: 0,
  total: 0,
  currentCall: '',
  errors: []
};

/**
 * GET /api/calls
 * Get analyzed calls with filters
 */
router.get('/calls', (req, res) => {
  try {
    const { startDate, endDate, salesRep, limit, offset } = req.query;

    const calls = getCalls({
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
router.get('/calls/:id', (req, res) => {
  try {
    const call = getCallById(req.params.id);

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
        const existing = getCallByFirefliesId(id);
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
      deleteCallsInRange(startDate, endDate);
    }

    // Filter out already analyzed unless reanalyze
    for (const t of transcripts) {
      const existing = getCallByFirefliesId(t.id);
      if (!existing || reanalyze) {
        transcriptsToAnalyze.push(t);
      }
    }
  } else {
    // Get new transcripts (not yet analyzed)
    const existingCalls = getCalls({ limit: 1000 });
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
      saveCall(analysis);

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
router.get('/stats', (req, res) => {
  try {
    const { startDate, endDate, salesRep } = req.query;

    const stats = getStats({ startDate, endDate, salesRep });

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
 * Get aggregated pain points
 */
router.get('/pain-points', (req, res) => {
  try {
    const { startDate, endDate, salesRep } = req.query;

    const rawPainPoints = getAggregatedPainPoints({ startDate, endDate, salesRep });

    // Group by category
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
        prospect: pp.prospect_name,
        date: pp.date,
        intensity: pp.intensity
      });
    }

    const result = Object.values(grouped)
      .sort((a, b) => b.count - a.count)
      .map(g => ({
        ...g,
        quotes: g.quotes.slice(0, 10)
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
router.get('/language', (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const language = getLanguageDatabase({ startDate, endDate });

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
router.get('/dfy-report', (req, res) => {
  try {
    const { startDate, endDate, salesRep } = req.query;

    const report = getDFYReport({ startDate, endDate, salesRep });

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
router.post('/export', (req, res) => {
  try {
    const { startDate, endDate, salesRep, format } = req.body;

    const calls = getCalls({ startDate, endDate, salesRep });
    const stats = getStats({ startDate, endDate, salesRep });
    const dfyReport = getDFYReport({ startDate, endDate, salesRep });

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

module.exports = router;
