const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database.sqlite');
let db = null;
let SQL = null;

async function initSql() {
  if (!SQL) {
    SQL = await initSqlJs();
  }
  return SQL;
}

async function getDb() {
  if (!db) {
    const SQL = await initSql();
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
    } else {
      db = new SQL.Database();
    }
  }
  return db;
}

function saveDatabase() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
}

async function initDatabase() {
  const db = await getDb();

  // Analyzed calls table
  db.run(`
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
  db.run(`
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
  db.run(`
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
  db.run(`
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
  db.run(`
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
  db.run('CREATE INDEX IF NOT EXISTS idx_calls_date ON analyzed_calls(date)');
  db.run('CREATE INDEX IF NOT EXISTS idx_calls_sales_rep ON analyzed_calls(sales_rep)');
  db.run('CREATE INDEX IF NOT EXISTS idx_pain_points_call ON pain_points(call_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_language_call ON customer_language(call_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_dfy_call ON dfy_mentions(call_id)');

  saveDatabase();
  console.log('Database initialized successfully');
}

// Call operations
async function saveCall(analysis) {
  const db = await getDb();

  db.run(`
    INSERT OR REPLACE INTO analyzed_calls
    (id, fireflies_id, title, date, duration, prospect_name, sales_rep,
     outcome, offer_pitched, overall_score, pain_level, analysis_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `, [
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
  ]);

  // Save related data
  await savePainPoints(analysis.id, analysis.painPoints);
  await saveLanguageAssets(analysis.id, analysis.languageAssets);
  await saveDFYAnalysis(analysis.id, analysis.dfyAnalysis);
  await saveObjections(analysis.id, analysis.objections);

  saveDatabase();
  return analysis.id;
}

async function savePainPoints(callId, painPoints) {
  if (!painPoints) return;

  const db = await getDb();

  // Delete existing
  db.run('DELETE FROM pain_points WHERE call_id = ?', [callId]);

  const allPainPoints = [
    ...(painPoints.immediate || []),
    ...(painPoints.shortTerm || []),
    ...(painPoints.longTerm || [])
  ];

  for (const pp of allPainPoints) {
    db.run(`
      INSERT INTO pain_points (call_id, category, quote, intensity)
      VALUES (?, ?, ?, ?)
    `, [callId, pp.category, pp.quote, pp.intensity]);
  }
}

async function saveLanguageAssets(callId, assets) {
  if (!assets) return;

  const db = await getDb();

  // Delete existing
  db.run('DELETE FROM customer_language WHERE call_id = ?', [callId]);

  for (const term of (assets.industryTerms || [])) {
    db.run(`
      INSERT INTO customer_language (call_id, type, phrase, context)
      VALUES (?, ?, ?, ?)
    `, [callId, 'industry_term', term.term, term.context]);
  }
  for (const lang of (assets.emotionalLanguage || [])) {
    db.run(`
      INSERT INTO customer_language (call_id, type, phrase, context)
      VALUES (?, ?, ?, ?)
    `, [callId, 'emotional', lang.phrase, lang.emotion]);
  }
  for (const meta of (assets.metaphors || [])) {
    db.run(`
      INSERT INTO customer_language (call_id, type, phrase, context)
      VALUES (?, ?, ?, ?)
    `, [callId, 'metaphor', meta.phrase || meta, meta.context || '']);
  }
  for (const word of (assets.powerWords || [])) {
    db.run(`
      INSERT INTO customer_language (call_id, type, phrase, context)
      VALUES (?, ?, ?, ?)
    `, [callId, 'power_word', word, '']);
  }
}

async function saveDFYAnalysis(callId, dfyAnalysis) {
  if (!dfyAnalysis) return;

  const db = await getDb();

  // Delete existing
  db.run('DELETE FROM dfy_mentions WHERE call_id = ?', [callId]);

  if (dfyAnalysis.mentioned) {
    db.run(`
      INSERT INTO dfy_mentions (call_id, mentioned, who_initiated, timestamp, reason, classification)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      callId,
      dfyAnalysis.mentioned ? 1 : 0,
      dfyAnalysis.whoInitiated,
      dfyAnalysis.timestamp,
      dfyAnalysis.reason,
      dfyAnalysis.classification
    ]);
  }
}

async function saveObjections(callId, objections) {
  if (!objections || !Array.isArray(objections)) return;

  const db = await getDb();

  // Delete existing
  db.run('DELETE FROM objections WHERE call_id = ?', [callId]);

  for (const obj of objections) {
    db.run(`
      INSERT INTO objections (call_id, type, quote, resolution_attempted, outcome)
      VALUES (?, ?, ?, ?, ?)
    `, [callId, obj.type, obj.quote, obj.resolutionAttempted, obj.outcome]);
  }
}

async function getCalls(filters = {}) {
  const db = await getDb();

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

  const result = db.exec(query, params);
  if (!result.length) return [];

  const columns = result[0].columns;
  const calls = result[0].values.map(row => {
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });

  return calls.map(call => ({
    ...call,
    analysis: JSON.parse(call.analysis_json || '{}')
  }));
}

async function getCallById(id) {
  const db = await getDb();
  const result = db.exec('SELECT * FROM analyzed_calls WHERE id = ?', [id]);

  if (!result.length || !result[0].values.length) return null;

  const columns = result[0].columns;
  const row = result[0].values[0];
  const call = {};
  columns.forEach((col, i) => call[col] = row[i]);

  return {
    ...call,
    analysis: JSON.parse(call.analysis_json || '{}')
  };
}

async function getCallByFirefliesId(firefliesId) {
  const db = await getDb();
  const result = db.exec('SELECT * FROM analyzed_calls WHERE fireflies_id = ?', [firefliesId]);

  if (!result.length || !result[0].values.length) return null;

  const columns = result[0].columns;
  const row = result[0].values[0];
  const call = {};
  columns.forEach((col, i) => call[col] = row[i]);

  return {
    ...call,
    analysis: JSON.parse(call.analysis_json || '{}')
  };
}

async function getStats(filters = {}) {
  const db = await getDb();

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

  const getScalar = (sql, p) => {
    const r = db.exec(sql, p);
    return r.length && r[0].values.length ? r[0].values[0][0] : 0;
  };

  const totalCalls = getScalar(`SELECT COUNT(*) FROM analyzed_calls WHERE ${whereClause}`, params) || 0;

  const conversions = getScalar(`
    SELECT COUNT(*) FROM analyzed_calls
    WHERE ${whereClause} AND outcome IN ('trial_signup', 'demo_scheduled')
  `, params) || 0;

  const softwareOnly = getScalar(`
    SELECT COUNT(*) FROM analyzed_calls
    WHERE ${whereClause} AND offer_pitched = 'software_only'
  `, params) || 0;

  const dfyMentions = getScalar(`
    SELECT COUNT(*) FROM dfy_mentions dm
    JOIN analyzed_calls ac ON dm.call_id = ac.id
    WHERE dm.mentioned = 1 AND ${whereClause.replace(/date/g, 'ac.date').replace(/sales_rep/g, 'ac.sales_rep')}
  `, params) || 0;

  const avgDuration = getScalar(`
    SELECT AVG(duration) FROM analyzed_calls WHERE ${whereClause}
  `, params) || 0;

  const avgPainLevel = getScalar(`
    SELECT AVG(pain_level) FROM analyzed_calls WHERE ${whereClause}
  `, params) || 0;

  const avgScore = getScalar(`
    SELECT AVG(overall_score) FROM analyzed_calls WHERE ${whereClause}
  `, params) || 0;

  // Top pain points
  const ppResult = db.exec(`
    SELECT category, COUNT(*) as count FROM pain_points pp
    JOIN analyzed_calls ac ON pp.call_id = ac.id
    WHERE ${whereClause.replace(/date/g, 'ac.date').replace(/sales_rep/g, 'ac.sales_rep')}
    GROUP BY category ORDER BY count DESC LIMIT 5
  `, params);

  const topPainPoints = ppResult.length ? ppResult[0].values.map(row => ({
    category: row[0],
    count: row[1]
  })) : [];

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

async function getAggregatedPainPoints(filters = {}) {
  const db = await getDb();

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

  const result = db.exec(`
    SELECT pp.category, pp.quote, pp.intensity, ac.prospect_name, ac.date
    FROM pain_points pp
    JOIN analyzed_calls ac ON pp.call_id = ac.id
    WHERE ${whereClause}
    ORDER BY ac.date DESC
  `, params);

  if (!result.length) return [];

  const columns = result[0].columns;
  return result[0].values.map(row => {
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });
}

async function getLanguageDatabase(filters = {}) {
  const db = await getDb();

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

  const result = db.exec(`
    SELECT cl.type, cl.phrase, cl.context, ac.prospect_name, ac.date
    FROM customer_language cl
    JOIN analyzed_calls ac ON cl.call_id = ac.id
    WHERE ${whereClause}
    ORDER BY cl.type, ac.date DESC
  `, params);

  if (!result.length) return [];

  const columns = result[0].columns;
  return result[0].values.map(row => {
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });
}

async function getDFYReport(filters = {}) {
  const db = await getDb();

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

  const mentionsResult = db.exec(`
    SELECT dm.*, ac.title, ac.prospect_name, ac.sales_rep, ac.date
    FROM dfy_mentions dm
    JOIN analyzed_calls ac ON dm.call_id = ac.id
    WHERE dm.mentioned = 1 AND ${whereClause}
    ORDER BY ac.date DESC
  `, params);

  const mentions = mentionsResult.length ? mentionsResult[0].values.map(row => {
    const obj = {};
    mentionsResult[0].columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  }) : [];

  const classResult = db.exec(`
    SELECT dm.classification, COUNT(*) as count
    FROM dfy_mentions dm
    JOIN analyzed_calls ac ON dm.call_id = ac.id
    WHERE dm.mentioned = 1 AND ${whereClause}
    GROUP BY dm.classification
  `, params);

  const byClassification = classResult.length ? classResult[0].values.map(row => ({
    classification: row[0],
    count: row[1]
  })) : [];

  const initResult = db.exec(`
    SELECT dm.who_initiated, COUNT(*) as count
    FROM dfy_mentions dm
    JOIN analyzed_calls ac ON dm.call_id = ac.id
    WHERE dm.mentioned = 1 AND ${whereClause}
    GROUP BY dm.who_initiated
  `, params);

  const byInitiator = initResult.length ? initResult[0].values.map(row => ({
    who_initiated: row[0],
    count: row[1]
  })) : [];

  return {
    mentions,
    byClassification,
    byInitiator
  };
}

async function deleteCallsInRange(startDate, endDate) {
  const db = await getDb();

  const result = db.exec(`
    SELECT id FROM analyzed_calls WHERE date >= ? AND date <= ?
  `, [startDate, endDate]);

  const callIds = result.length ? result[0].values.map(r => r[0]) : [];

  for (const id of callIds) {
    db.run('DELETE FROM pain_points WHERE call_id = ?', [id]);
    db.run('DELETE FROM customer_language WHERE call_id = ?', [id]);
    db.run('DELETE FROM dfy_mentions WHERE call_id = ?', [id]);
    db.run('DELETE FROM objections WHERE call_id = ?', [id]);
    db.run('DELETE FROM analyzed_calls WHERE id = ?', [id]);
  }

  saveDatabase();
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
