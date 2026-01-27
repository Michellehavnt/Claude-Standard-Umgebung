/**
 * Re-analysis Service
 * Handles controlled re-analysis of transcripts when model settings change
 *
 * Features:
 * - Only processes SALES calls (skips internal meetings)
 * - Uses currently selected OpenAI model
 * - Batch processing with progress tracking
 * - Resumable if interrupted
 */

const { CLASSIFICATION, classifyCall } = require('./analyzer');
const transcriptDb = require('./transcriptDb');
const secretManager = require('./secretManager');
const { analyzeCall } = require('./callAnalysisService');

// Re-analysis job statuses
const JOB_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

// In-memory job state (persisted to database for resumability)
let currentJob = null;

/**
 * Initialize the reanalysis_jobs table
 */
async function initReanalysisTable() {
  const database = await transcriptDb.getDb();

  database.run(`
    CREATE TABLE IF NOT EXISTS reanalysis_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at DATETIME,
      completed_at DATETIME,
      model TEXT NOT NULL,
      total_calls INTEGER DEFAULT 0,
      processed INTEGER DEFAULT 0,
      skipped INTEGER DEFAULT 0,
      errors INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      last_processed_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Index for quick lookups
  try {
    database.run('CREATE INDEX IF NOT EXISTS idx_reanalysis_jobs_status ON reanalysis_jobs(status)');
  } catch (e) { /* index may already exist */ }

  // Save database
  const data = database.export();
  const buffer = Buffer.from(data);
  const fs = require('fs');
  const path = require('path');
  const dbPath = path.join(__dirname, '..', 'database.sqlite');
  fs.writeFileSync(dbPath, buffer);
}

/**
 * Get all SALES calls that need re-analysis
 * @param {string} applyMode - The apply mode to filter calls (optional)
 * @returns {Promise<Array>} - List of transcript IDs for sales calls
 */
async function getSalesCallsForReanalysis(applyMode = null) {
  const database = await transcriptDb.getDb();

  // Build date filter based on apply mode
  let dateFilter = '';
  if (applyMode === secretManager.APPLY_MODES.RERUN_LAST_DAY) {
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    dateFilter = `AND call_datetime >= '${oneDayAgo.toISOString()}'`;
  } else if (applyMode === secretManager.APPLY_MODES.RERUN_LAST_WEEK) {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    dateFilter = `AND call_datetime >= '${oneWeekAgo.toISOString()}'`;
  }
  // For RERUN_ALL, no date filter is applied

  // Get all transcripts with transcript text
  const result = database.exec(`
    SELECT id, call_title, analysis_json FROM transcripts
    WHERE transcript_text IS NOT NULL AND transcript_text != ''
    ${dateFilter}
    ORDER BY call_datetime DESC
  `);

  if (!result.length) return [];

  const columns = result[0].columns;
  const salesCalls = [];

  for (const row of result[0].values) {
    const obj = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });

    // Check if it's a sales call using the classifier
    const classification = classifyCall(obj.call_title);
    if (classification.classification === CLASSIFICATION.SALES) {
      salesCalls.push({
        id: obj.id,
        title: obj.call_title,
        hasAnalysis: !!obj.analysis_json
      });
    }
  }

  return salesCalls;
}

/**
 * Create a new re-analysis job
 * @param {string} model - The OpenAI model to use
 * @param {string} applyMode - The apply mode to filter calls (optional)
 * @returns {Promise<Object>} - Job info
 */
async function createReanalysisJob(model, applyMode = null) {
  const database = await transcriptDb.getDb();
  const now = new Date().toISOString();

  // Check if there's already a running job
  const existingResult = database.exec(`
    SELECT id FROM reanalysis_jobs WHERE status IN ('pending', 'running')
  `);

  if (existingResult.length && existingResult[0].values.length) {
    return {
      success: false,
      error: 'A re-analysis job is already running'
    };
  }

  // Get count of sales calls filtered by apply mode
  const salesCalls = await getSalesCallsForReanalysis(applyMode);
  const totalCalls = salesCalls.length;

  if (totalCalls === 0) {
    return {
      success: false,
      error: 'No sales calls found to re-analyze'
    };
  }

  // Create the job
  database.run(`
    INSERT INTO reanalysis_jobs (started_at, model, total_calls, status)
    VALUES (?, ?, ?, 'pending')
  `, [now, model, totalCalls]);

  // Get the job ID
  const idResult = database.exec('SELECT MAX(id) FROM reanalysis_jobs');
  const jobId = idResult[0].values[0][0];

  // Save database
  const data = database.export();
  const buffer = Buffer.from(data);
  const fs = require('fs');
  const path = require('path');
  const dbPath = path.join(__dirname, '..', 'database.sqlite');
  fs.writeFileSync(dbPath, buffer);

  return {
    success: true,
    jobId,
    totalCalls,
    model
  };
}

/**
 * Get the current or most recent re-analysis job
 * @returns {Promise<Object|null>} - Job info or null
 */
async function getReanalysisJob(jobId = null) {
  const database = await transcriptDb.getDb();

  let result;
  if (jobId) {
    result = database.exec('SELECT * FROM reanalysis_jobs WHERE id = ?', [jobId]);
  } else {
    // Get the most recent job
    result = database.exec('SELECT * FROM reanalysis_jobs ORDER BY id DESC LIMIT 1');
  }

  if (!result.length || !result[0].values.length) return null;

  const columns = result[0].columns;
  const row = result[0].values[0];
  const job = {};
  columns.forEach((col, i) => {
    job[col] = row[i];
  });

  return job;
}

/**
 * Update job progress
 * @param {number} jobId - Job ID
 * @param {Object} updates - Fields to update
 */
async function updateJobProgress(jobId, updates) {
  const database = await transcriptDb.getDb();

  const setClause = Object.keys(updates)
    .map(key => `${key} = ?`)
    .join(', ');
  const values = Object.values(updates);
  values.push(jobId);

  database.run(`UPDATE reanalysis_jobs SET ${setClause} WHERE id = ?`, values);

  // Save database
  const data = database.export();
  const buffer = Buffer.from(data);
  const fs = require('fs');
  const path = require('path');
  const dbPath = path.join(__dirname, '..', 'database.sqlite');
  fs.writeFileSync(dbPath, buffer);
}

/**
 * Run the re-analysis job
 * @param {number} jobId - Job ID to run
 * @param {Function} progressCallback - Optional callback for progress updates
 * @returns {Promise<Object>} - Final results
 */
async function runReanalysisJob(jobId, progressCallback = null) {
  const job = await getReanalysisJob(jobId);

  if (!job) {
    return { success: false, error: 'Job not found' };
  }

  if (job.status !== 'pending' && job.status !== 'paused') {
    return { success: false, error: `Job is ${job.status}, cannot run` };
  }

  // Check OpenAI API key is configured
  if (!secretManager.isConfigured('OPENAI_API_KEY')) {
    await updateJobProgress(jobId, {
      status: JOB_STATUS.FAILED,
      error_message: 'OpenAI API key not configured'
    });
    return { success: false, error: 'OpenAI API key not configured' };
  }

  // Update job status to running
  await updateJobProgress(jobId, { status: JOB_STATUS.RUNNING });
  currentJob = { id: jobId, cancelled: false };

  // Get sales calls filtered by current apply mode
  const applyMode = getCurrentApplyMode();
  const salesCalls = await getSalesCallsForReanalysis(applyMode);

  // Find where to resume from (if paused)
  let startIndex = 0;
  if (job.last_processed_id) {
    const idx = salesCalls.findIndex(c => c.id === job.last_processed_id);
    if (idx >= 0) {
      startIndex = idx + 1; // Start from the next one
    }
  }

  let processed = job.processed || 0;
  let skipped = job.skipped || 0;
  let errors = job.errors || 0;

  // Process each sales call
  for (let i = startIndex; i < salesCalls.length; i++) {
    // Check if cancelled
    if (currentJob.cancelled) {
      await updateJobProgress(jobId, {
        status: JOB_STATUS.PAUSED,
        processed,
        skipped,
        errors,
        last_processed_id: salesCalls[i - 1]?.id
      });
      return {
        success: true,
        paused: true,
        processed,
        skipped,
        errors,
        remaining: salesCalls.length - i
      };
    }

    const call = salesCalls[i];

    try {
      // Re-analyze the call with force=true
      const result = await analyzeCall(call.id, { force: true });

      if (result.success) {
        if (result.skipped) {
          skipped++;
        } else {
          processed++;
        }
      } else {
        errors++;
      }

      // Update progress every 5 calls or on last call
      if ((i + 1) % 5 === 0 || i === salesCalls.length - 1) {
        await updateJobProgress(jobId, {
          processed,
          skipped,
          errors,
          last_processed_id: call.id
        });

        if (progressCallback) {
          progressCallback({
            processed,
            skipped,
            errors,
            total: salesCalls.length,
            current: i + 1,
            percentage: Math.round(((i + 1) / salesCalls.length) * 100)
          });
        }
      }

    } catch (error) {
      errors++;
      console.error(`[ReanalysisService] Error processing ${call.id}:`, error.message);
    }
  }

  // Job completed
  const now = new Date().toISOString();
  await updateJobProgress(jobId, {
    status: JOB_STATUS.COMPLETED,
    completed_at: now,
    processed,
    skipped,
    errors
  });

  currentJob = null;

  return {
    success: true,
    completed: true,
    processed,
    skipped,
    errors,
    total: salesCalls.length
  };
}

/**
 * Cancel the currently running job
 */
function cancelReanalysisJob() {
  if (currentJob) {
    currentJob.cancelled = true;
    return true;
  }
  return false;
}

/**
 * Check if apply mode requires re-analysis
 * @returns {boolean} - True if re-analysis should be triggered
 */
function shouldTriggerReanalysis() {
  const config = secretManager.getOpenAIConfig();
  const reanalyzeModes = [
    secretManager.APPLY_MODES.RERUN_ALL,
    secretManager.APPLY_MODES.RERUN_LAST_DAY,
    secretManager.APPLY_MODES.RERUN_LAST_WEEK
  ];
  return reanalyzeModes.includes(config.applyMode);
}

/**
 * Get the current apply mode
 * @returns {string} - Apply mode
 */
function getCurrentApplyMode() {
  const config = secretManager.getOpenAIConfig();
  return config.applyMode || secretManager.APPLY_MODES.FUTURE_ONLY;
}

/**
 * Get the currently configured model
 * @returns {string} - Model ID
 */
function getCurrentModel() {
  const config = secretManager.getOpenAIConfig();
  return config.model || 'gpt-4o';
}

/**
 * Start re-analysis if apply mode requires it
 * @returns {Promise<Object>} - Result of starting the job
 */
async function startReanalysisIfNeeded() {
  if (!shouldTriggerReanalysis()) {
    return {
      success: true,
      triggered: false,
      message: 'Apply mode is future_only, no re-analysis needed'
    };
  }

  const model = getCurrentModel();
  const applyMode = getCurrentApplyMode();
  const jobResult = await createReanalysisJob(model, applyMode);

  if (!jobResult.success) {
    return jobResult;
  }

  // Start the job asynchronously
  setImmediate(async () => {
    try {
      await runReanalysisJob(jobResult.jobId);
    } catch (error) {
      console.error('[ReanalysisService] Job failed:', error.message);
      await updateJobProgress(jobResult.jobId, {
        status: JOB_STATUS.FAILED,
        error_message: error.message
      });
    }
  });

  return {
    success: true,
    triggered: true,
    jobId: jobResult.jobId,
    totalCalls: jobResult.totalCalls,
    model
  };
}

/**
 * Get statistics about current re-analysis status
 */
async function getReanalysisStats() {
  const job = await getReanalysisJob();
  const salesCalls = await getSalesCallsForReanalysis();

  return {
    totalSalesCalls: salesCalls.length,
    currentJob: job,
    hasRunningJob: job && (job.status === 'pending' || job.status === 'running')
  };
}

module.exports = {
  initReanalysisTable,
  getSalesCallsForReanalysis,
  createReanalysisJob,
  getReanalysisJob,
  runReanalysisJob,
  cancelReanalysisJob,
  shouldTriggerReanalysis,
  getCurrentModel,
  getCurrentApplyMode,
  startReanalysisIfNeeded,
  getReanalysisStats,
  JOB_STATUS
};
