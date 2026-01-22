/**
 * DFY (Done-For-You) Detection Module
 * Detects and classifies mentions of agency/managed services in sales calls
 */

const dfyKeywords = [
  'agency', 'done for you', 'done-for-you', 'full service', 'full-service',
  'we can do it for you', 'managed service', 'we\'ll handle it',
  'we manage', 'full management', 'hands-off', 'we do the outreach',
  '$1,800', '1800', 'eighteen hundred', '$1800', 'agency service',
  'dfy', 'done for you service', 'we handle everything'
];

const justifiedTriggers = [
  'don\'t have time', 'no time', 'can\'t dedicate', 'no resources',
  'need someone to manage', 'want hands-off', 'can you do it for me',
  'is there a service', 'do you offer managed', 'too busy',
  'need help managing', 'can someone do this', 'don\'t have staff',
  'overwhelmed', 'stretched thin', 'no bandwidth'
];

const avoidableTriggers = [
  'i have a team', 'we can handle', 'just need the tool',
  'we\'ll do the outreach', 'i can manage', 'have the resources',
  'prefer self-service', 'just the software', 'diy', 'do it myself',
  'i\'ll handle', 'my team will'
];

/**
 * Check if a speaker is the prospect (not sales rep)
 */
function isProspectSpeaker(speakerName, prospectName) {
  if (!speakerName) return false;

  const speaker = speakerName.toLowerCase();

  // Exclude known sales rep names
  const salesRepNames = ['jamie', 'phil', 'phil norris', 'jamie i.f.', 'jamie if'];
  if (salesRepNames.some(rep => speaker.includes(rep))) {
    return false;
  }

  // Include if matches prospect name or is a generic speaker
  if (prospectName) {
    const prospectFirst = prospectName.toLowerCase().split(' ')[0];
    if (speaker.includes(prospectFirst)) return true;
  }

  return true;
}

/**
 * Format milliseconds to MM:SS
 */
function formatTimestamp(ms) {
  if (!ms) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Detect and analyze DFY mentions in a transcript
 */
function detectDFY(sentences, prospectName) {
  let dfyAnalysis = {
    mentioned: false,
    whoInitiated: null,
    timestamp: null,
    reason: null,
    justified: null,
    couldSoftwareOnlyWork: null,
    classification: null,
    context: []
  };

  let prospectShowsCapability = false;
  let prospectNeedsHelp = false;

  // First pass: look for capability/needs signals from prospect
  for (const sentence of sentences) {
    const text = sentence.text.toLowerCase();
    const isProspect = isProspectSpeaker(sentence.speaker_name, prospectName);

    if (!isProspect) continue;

    // Check if prospect shows self-serve capability
    if (avoidableTriggers.some(t => text.includes(t))) {
      prospectShowsCapability = true;
      dfyAnalysis.couldSoftwareOnlyWork = true;
    }

    // Check if prospect indicates need for managed service
    if (justifiedTriggers.some(t => text.includes(t))) {
      prospectNeedsHelp = true;
      dfyAnalysis.justified = true;
      dfyAnalysis.reason = sentence.text;
    }
  }

  // Second pass: find DFY mentions
  for (const sentence of sentences) {
    const text = sentence.text.toLowerCase();
    const isProspect = isProspectSpeaker(sentence.speaker_name, prospectName);

    // Check if DFY is mentioned
    const hasDFYKeyword = dfyKeywords.some(kw => text.includes(kw));

    if (hasDFYKeyword) {
      // First mention sets the initiator
      if (!dfyAnalysis.mentioned) {
        dfyAnalysis.mentioned = true;
        dfyAnalysis.whoInitiated = isProspect ? 'prospect' : 'sales';
        dfyAnalysis.timestamp = formatTimestamp(sentence.start_time);
      }

      // Add to context
      dfyAnalysis.context.push({
        speaker: sentence.speaker_name,
        text: sentence.text,
        time: formatTimestamp(sentence.start_time),
        isProspect
      });
    }
  }

  // Classify DFY mention
  if (dfyAnalysis.mentioned) {
    if (dfyAnalysis.whoInitiated === 'prospect') {
      // Prospect asked about DFY - usually justified
      dfyAnalysis.classification = 'justified';
      dfyAnalysis.couldSoftwareOnlyWork = false;
    } else {
      // Sales initiated DFY mention
      if (prospectShowsCapability && !prospectNeedsHelp) {
        // Prospect showed capability, DFY was unnecessary
        dfyAnalysis.classification = 'avoidable';
        dfyAnalysis.couldSoftwareOnlyWork = true;
        dfyAnalysis.justified = false;
        dfyAnalysis.reason = 'Prospect indicated self-serve capability';
      } else if (prospectNeedsHelp) {
        // Prospect showed need for help
        dfyAnalysis.classification = 'justified';
        dfyAnalysis.couldSoftwareOnlyWork = false;
      } else {
        // No clear signals - mark as premature
        dfyAnalysis.classification = 'premature';
        dfyAnalysis.couldSoftwareOnlyWork = true;
        dfyAnalysis.reason = 'Mentioned before assessing prospect capability';
      }
    }
  }

  return dfyAnalysis;
}

/**
 * Generate DFY report summary for a set of calls
 */
function generateDFYReport(analyses) {
  const report = {
    totalCalls: analyses.length,
    dfyMentioned: 0,
    initiatedByProspect: 0,
    initiatedBySales: 0,
    classified: {
      justified: 0,
      avoidable: 0,
      premature: 0
    },
    avoidableCalls: []
  };

  for (const analysis of analyses) {
    const dfy = analysis.dfyAnalysis;
    if (!dfy || !dfy.mentioned) continue;

    report.dfyMentioned++;

    if (dfy.whoInitiated === 'prospect') {
      report.initiatedByProspect++;
    } else {
      report.initiatedBySales++;
    }

    if (dfy.classification) {
      report.classified[dfy.classification] = (report.classified[dfy.classification] || 0) + 1;
    }

    if (dfy.classification === 'avoidable') {
      report.avoidableCalls.push({
        id: analysis.id,
        title: analysis.title,
        date: analysis.date,
        prospect: analysis.prospectName,
        salesRep: analysis.salesRep,
        reason: dfy.reason
      });
    }
  }

  report.avoidableRate = report.dfyMentioned > 0
    ? Math.round((report.classified.avoidable / report.dfyMentioned) * 100)
    : 0;

  return report;
}

module.exports = {
  detectDFY,
  generateDFYReport,
  dfyKeywords,
  justifiedTriggers,
  avoidableTriggers
};
