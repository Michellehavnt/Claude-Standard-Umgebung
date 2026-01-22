const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database.sqlite');
let db = null;

function getDb() {
  if (!db) {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

function initDatabase() {
  const db = getDb();

  // Analyzed calls table
  db.exec(`
    CREATE TABLE IF NOT EXISTS analyzed_calls (
      id TEXT PRIMARY KEY,
      fireflies_id TEXT UNIQUE,
      title TEXT,
      date DATE,
      duration INTEGER,
      prospect_name TEXT,
      sales_rep TEXT,
      outcome TEXT,
      offer_pitched TEXT,
      overall_score INTEGER,
      pain_level INTEGER,
      analysis_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Pain points table
  db.exec(`
    CREATE TABLE IF NOT EXISTS pain_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id TEXT,
      category TEXT,
      quote TEXT,
      intensity TEXT,
      FOREIGN KEY (call_id) REFERENCES analyzed_calls(id)
    )
  `);

  // Customer language table
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_language (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id TEXT,
      type TEXT,
      phrase TEXT,
      context TEXT,
      FOREIGN KEY (call_id) REFERENCES analyzed_calls(id)
    )
  `);

  // DFY tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS dfy_mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id TEXT,
      mentioned BOOLEAN,
      who_initiated TEXT,
      timestamp TEXT,
      reason TEXT,
      classification TEXT,
      FOREIGN KEY (call_id) REFERENCES analyzed_calls(id)
    )
  `);

  // Objections table
  db.exec(`
    CREATE TABLE IF NOT EXISTS objections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id TEXT,
      type TEXT,
      quote TEXT,
      resolution_attempted TEXT,
      outcome TEXT,
      FOREIGN KEY (call_id) REFERENCES analyzed_calls(id)
    )
  `);

  // Create indexes for better query performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_calls_date ON analyzed_calls(date);
    CREATE INDEX IF NOT EXISTS idx_calls_sales_rep ON analyzed_calls(sales_rep);
    CREATE INDEX IF NOT EXISTS idx_pain_points_call ON pain_points(call_id);
    CREATE INDEX IF NOT EXISTS idx_language_call ON customer_language(call_id);
    CREATE INDEX IF NOT EXISTS idx_dfy_call ON dfy_mentions(call_id);
  `);

  console.log('Database initialized successfully');
}

// Call operations
function saveCall(analysis) {
  const db = getDb();

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO analyzed_calls
    (id, fireflies_id, title, date, duration, prospect_name, sales_rep,
     outcome, offer_pitched, overall_score, pain_level, analysis_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  stmt.run(
    analysis.id,
    analysis.fireflies_id || analysis.id,
    analysis.title,
    analysis.date,
    analysis.duration,
    analysis.prospectName,
    analysis.salesRep,
    analysis.outcome,
    analysis.offerPitched,
    analysis.overallScore,
    analysis.prospectProfile?.painLevel || 5,
    JSON.stringify(analysis)
  );

  // Save related data
  savePainPoints(analysis.id, analysis.painPoints);
  saveLanguageAssets(analysis.id, analysis.languageAssets);
  saveDFYAnalysis(analysis.id, analysis.dfyAnalysis);
  saveObjections(analysis.id, analysis.objections);

  return analysis.id;
}

function savePainPoints(callId, painPoints) {
  if (!painPoints) return;

  const db = getDb();

  // Delete existing
  db.prepare('DELETE FROM pain_points WHERE call_id = ?').run(callId);

  const stmt = db.prepare(`
    INSERT INTO pain_points (call_id, category, quote, intensity)
    VALUES (?, ?, ?, ?)
  `);

  const allPainPoints = [
    ...(painPoints.immediate || []),
    ...(painPoints.shortTerm || []),
    ...(painPoints.longTerm || [])
  ];

  for (const pp of allPainPoints) {
    stmt.run(callId, pp.category, pp.quote, pp.intensity);
  }
}

function saveLanguageAssets(callId, assets) {
  if (!assets) return;

  const db = getDb();

  // Delete existing
  db.prepare('DELETE FROM customer_language WHERE call_id = ?').run(callId);

  const stmt = db.prepare(`
    INSERT INTO customer_language (call_id, type, phrase, context)
    VALUES (?, ?, ?, ?)
  `);

  for (const term of (assets.industryTerms || [])) {
    stmt.run(callId, 'industry_term', term.term, term.context);
  }
  for (const lang of (assets.emotionalLanguage || [])) {
    stmt.run(callId, 'emotional', lang.phrase, lang.emotion);
  }
  for (const meta of (assets.metaphors || [])) {
    stmt.run(callId, 'metaphor', meta.phrase || meta, meta.context || '');
  }
  for (const word of (assets.powerWords || [])) {
    stmt.run(callId, 'power_word', word, '');
  }
}

function saveDFYAnalysis(callId, dfyAnalysis) {
  if (!dfyAnalysis) return;

  const db = getDb();

  // Delete existing
  db.prepare('DELETE FROM dfy_mentions WHERE call_id = ?').run(callId);

  if (dfyAnalysis.mentioned) {
    db.prepare(`
      INSERT INTO dfy_mentions (call_id, mentioned, who_initiated, timestamp, reason, classification)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      callId,
      dfyAnalysis.mentioned ? 1 : 0,
      dfyAnalysis.whoInitiated,
      dfyAnalysis.timestamp,
      dfyAnalysis.reason,
      dfyAnalysis.classification
    );
  }
}

function saveObjections(callId, objections) {
  if (!objections || !Array.isArray(objections)) return;

  const db = getDb();

  // Delete existing
  db.prepare('DELETE FROM objections WHERE call_id = ?').run(callId);

  const stmt = db.prepare(`
    INSERT INTO objections (call_id, type, quote, resolution_attempted, outcome)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const obj of objections) {
    stmt.run(callId, obj.type, obj.quote, obj.resolutionAttempted, obj.outcome);
  }
}

function getCalls(filters = {}) {
  const db = getDb();

  let query = 'SELECT * FROM analyzed_calls WHERE 1=1';
  const params = [];

  if (filters.startDate) {
    query += ' AND date >= ?';
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    query += ' AND date <= ?';
    params.push(filters.endDate);
  }
  if (filters.salesRep && filters.salesRep !== 'all') {
    query += ' AND LOWER(sales_rep) = LOWER(?)';
    params.push(filters.salesRep);
  }

  query += ' ORDER BY date DESC';

  if (filters.limit) {
    query += ' LIMIT ?';
    params.push(filters.limit);
  }
  if (filters.offset) {
    query += ' OFFSET ?';
    params.push(filters.offset);
  }

  const calls = db.prepare(query).all(...params);

  return calls.map(call => ({
    ...call,
    analysis: JSON.parse(call.analysis_json || '{}')
  }));
}

function getCallById(id) {
  const db = getDb();
  const call = db.prepare('SELECT * FROM analyzed_calls WHERE id = ?').get(id);

  if (!call) return null;

  return {
    ...call,
    analysis: JSON.parse(call.analysis_json || '{}')
  };
}

function getCallByFirefliesId(firefliesId) {
  const db = getDb();
  const call = db.prepare('SELECT * FROM analyzed_calls WHERE fireflies_id = ?').get(firefliesId);

  if (!call) return null;

  return {
    ...call,
    analysis: JSON.parse(call.analysis_json || '{}')
  };
}

function getStats(filters = {}) {
  const db = getDb();

  let whereClause = '1=1';
  const params = [];

  if (filters.startDate) {
    whereClause += ' AND date >= ?';
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    whereClause += ' AND date <= ?';
    params.push(filters.endDate);
  }
  if (filters.salesRep && filters.salesRep !== 'all') {
    whereClause += ' AND LOWER(sales_rep) = LOWER(?)';
    params.push(filters.salesRep);
  }

  const totalCalls = db.prepare(`SELECT COUNT(*) as count FROM analyzed_calls WHERE ${whereClause}`).get(...params).count;

  const conversions = db.prepare(`
    SELECT COUNT(*) as count FROM analyzed_calls
    WHERE ${whereClause} AND outcome IN ('trial_signup', 'demo_scheduled')
  `).get(...params).count;

  const softwareOnly = db.prepare(`
    SELECT COUNT(*) as count FROM analyzed_calls
    WHERE ${whereClause} AND offer_pitched = 'software_only'
  `).get(...params).count;

  const dfyMentions = db.prepare(`
    SELECT COUNT(*) as count FROM dfy_mentions dm
    JOIN analyzed_calls ac ON dm.call_id = ac.id
    WHERE dm.mentioned = 1 AND ${whereClause.replace(/date/g, 'ac.date').replace(/sales_rep/g, 'ac.sales_rep')}
  `).get(...params).count;

  const avgDuration = db.prepare(`
    SELECT AVG(duration) as avg FROM analyzed_calls WHERE ${whereClause}
  `).get(...params).avg || 0;

  const avgPainLevel = db.prepare(`
    SELECT AVG(pain_level) as avg FROM analyzed_calls WHERE ${whereClause}
  `).get(...params).avg || 0;

  const avgScore = db.prepare(`
    SELECT AVG(overall_score) as avg FROM analyzed_calls WHERE ${whereClause}
  `).get(...params).avg || 0;

  // Top pain points
  const topPainPoints = db.prepare(`
    SELECT category, COUNT(*) as count FROM pain_points pp
    JOIN analyzed_calls ac ON pp.call_id = ac.id
    WHERE ${whereClause.replace(/date/g, 'ac.date').replace(/sales_rep/g, 'ac.sales_rep')}
    GROUP BY category ORDER BY count DESC LIMIT 5
  `).all(...params);

  return {
    totalCalls,
    conversionRate: totalCalls > 0 ? Math.round((conversions / totalCalls) * 100) : 0,
    softwareOnlyRate: totalCalls > 0 ? Math.round((softwareOnly / totalCalls) * 100) : 0,
    dfyMentions,
    avgDuration: Math.round(avgDuration),
    avgPainLevel: Math.round(avgPainLevel * 10) / 10,
    avgScore: Math.round(avgScore),
    topPainPoints
  };
}

function getAggregatedPainPoints(filters = {}) {
  const db = getDb();

  let whereClause = '1=1';
  const params = [];

  if (filters.startDate) {
    whereClause += ' AND ac.date >= ?';
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    whereClause += ' AND ac.date <= ?';
    params.push(filters.endDate);
  }
  if (filters.salesRep && filters.salesRep !== 'all') {
    whereClause += ' AND LOWER(ac.sales_rep) = LOWER(?)';
    params.push(filters.salesRep);
  }

  return db.prepare(`
    SELECT pp.category, pp.quote, pp.intensity, ac.prospect_name, ac.date
    FROM pain_points pp
    JOIN analyzed_calls ac ON pp.call_id = ac.id
    WHERE ${whereClause}
    ORDER BY ac.date DESC
  `).all(...params);
}

function getLanguageDatabase(filters = {}) {
  const db = getDb();

  let whereClause = '1=1';
  const params = [];

  if (filters.startDate) {
    whereClause += ' AND ac.date >= ?';
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    whereClause += ' AND ac.date <= ?';
    params.push(filters.endDate);
  }

  return db.prepare(`
    SELECT cl.type, cl.phrase, cl.context, ac.prospect_name, ac.date
    FROM customer_language cl
    JOIN analyzed_calls ac ON cl.call_id = ac.id
    WHERE ${whereClause}
    ORDER BY cl.type, ac.date DESC
  `).all(...params);
}

function getDFYReport(filters = {}) {
  const db = getDb();

  let whereClause = '1=1';
  const params = [];

  if (filters.startDate) {
    whereClause += ' AND ac.date >= ?';
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    whereClause += ' AND ac.date <= ?';
    params.push(filters.endDate);
  }
  if (filters.salesRep && filters.salesRep !== 'all') {
    whereClause += ' AND LOWER(ac.sales_rep) = LOWER(?)';
    params.push(filters.salesRep);
  }

  const mentions = db.prepare(`
    SELECT dm.*, ac.title, ac.prospect_name, ac.sales_rep, ac.date
    FROM dfy_mentions dm
    JOIN analyzed_calls ac ON dm.call_id = ac.id
    WHERE dm.mentioned = 1 AND ${whereClause}
    ORDER BY ac.date DESC
  `).all(...params);

  const byClassification = db.prepare(`
    SELECT dm.classification, COUNT(*) as count
    FROM dfy_mentions dm
    JOIN analyzed_calls ac ON dm.call_id = ac.id
    WHERE dm.mentioned = 1 AND ${whereClause}
    GROUP BY dm.classification
  `).all(...params);

  const byInitiator = db.prepare(`
    SELECT dm.who_initiated, COUNT(*) as count
    FROM dfy_mentions dm
    JOIN analyzed_calls ac ON dm.call_id = ac.id
    WHERE dm.mentioned = 1 AND ${whereClause}
    GROUP BY dm.who_initiated
  `).all(...params);

  return {
    mentions,
    byClassification,
    byInitiator
  };
}

function deleteCallsInRange(startDate, endDate) {
  const db = getDb();

  const callIds = db.prepare(`
    SELECT id FROM analyzed_calls WHERE date >= ? AND date <= ?
  `).all(startDate, endDate).map(r => r.id);

  for (const id of callIds) {
    db.prepare('DELETE FROM pain_points WHERE call_id = ?').run(id);
    db.prepare('DELETE FROM customer_language WHERE call_id = ?').run(id);
    db.prepare('DELETE FROM dfy_mentions WHERE call_id = ?').run(id);
    db.prepare('DELETE FROM objections WHERE call_id = ?').run(id);
    db.prepare('DELETE FROM analyzed_calls WHERE id = ?').run(id);
  }

  return callIds.length;
}

module.exports = {
  getDb,
  initDatabase,
  saveCall,
  getCalls,
  getCallById,
  getCallByFirefliesId,
  getStats,
  getAggregatedPainPoints,
  getLanguageDatabase,
  getDFYReport,
  deleteCallsInRange
};
