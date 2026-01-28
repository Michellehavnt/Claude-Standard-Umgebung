/**
 * Search Service
 * Full-text search functionality for transcripts
 * Supports both SQLite FTS4 and PostgreSQL full-text search
 */

const transcriptDb = require('./transcriptDb');
const dbAdapter = require('./dbAdapter');

/**
 * Initialize the FTS table for full-text search
 * Should be called after transcripts table is initialized
 */
async function initSearchTable() {
  if (dbAdapter.isUsingPostgres()) {
    // PostgreSQL uses tsvector columns and GIN indexes
    try {
      // Add tsvector column if not exists
      await dbAdapter.execute(`
        ALTER TABLE transcripts
        ADD COLUMN IF NOT EXISTS search_vector tsvector
      `);

      // Create GIN index for fast full-text search
      await dbAdapter.execute(`
        CREATE INDEX IF NOT EXISTS idx_transcripts_search
        ON transcripts USING GIN(search_vector)
      `);

      // Update existing rows with search vectors
      await rebuildSearchIndex();

      console.log('[SearchService] PostgreSQL FTS initialized');
    } catch (e) {
      console.error('[SearchService] Error initializing PostgreSQL FTS:', e.message);
    }
  } else {
    // SQLite uses FTS4 virtual table
    const database = await transcriptDb.getDb();

    try {
      database.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS transcripts_fts USING fts4(
          id,
          call_title,
          transcript_text,
          rep_name,
          participants,
          tokenize=porter
        )
      `);
    } catch (e) {
      if (!e.message.includes('already exists')) {
        console.error('[SearchService] Error creating FTS table:', e.message);
      }
    }

    await rebuildSearchIndex();
    transcriptDb.saveDatabase();
    console.log('[SearchService] SQLite FTS4 table initialized');
  }
}

/**
 * Rebuild the entire FTS index from the transcripts table
 * This should be called on initialization and when data is out of sync
 */
async function rebuildSearchIndex() {
  if (dbAdapter.isUsingPostgres()) {
    try {
      // Update search_vector for all transcripts
      await dbAdapter.execute(`
        UPDATE transcripts
        SET search_vector = to_tsvector('english',
          COALESCE(call_title, '') || ' ' ||
          COALESCE(transcript_text, '') || ' ' ||
          COALESCE(rep_name, '') || ' ' ||
          COALESCE(participants::text, '')
        )
        WHERE transcript_text IS NOT NULL AND transcript_text != ''
      `);
      console.log('[SearchService] PostgreSQL FTS index rebuilt');
    } catch (e) {
      console.error('[SearchService] Error rebuilding PostgreSQL FTS index:', e.message);
    }
  } else {
    const database = await transcriptDb.getDb();

    try {
      database.run('DELETE FROM transcripts_fts');
      database.run(`
        INSERT INTO transcripts_fts(id, call_title, transcript_text, rep_name, participants)
        SELECT id, call_title, transcript_text, rep_name, participants
        FROM transcripts
        WHERE transcript_text IS NOT NULL AND transcript_text != ''
      `);
      transcriptDb.saveDatabase();
      console.log('[SearchService] SQLite FTS index rebuilt');
    } catch (e) {
      console.error('[SearchService] Error rebuilding FTS index:', e.message);
    }
  }
}

/**
 * Index a single transcript (call after saving a new transcript)
 * @param {Object} transcript - Transcript to index
 */
async function indexTranscript(transcript) {
  if (!transcript.transcript_text) {
    return;
  }

  if (dbAdapter.isUsingPostgres()) {
    try {
      await dbAdapter.execute(`
        UPDATE transcripts
        SET search_vector = to_tsvector('english',
          COALESCE(call_title, '') || ' ' ||
          COALESCE(transcript_text, '') || ' ' ||
          COALESCE(rep_name, '') || ' ' ||
          COALESCE(participants::text, '')
        )
        WHERE id = $1
      `, [transcript.id]);
    } catch (e) {
      console.error('[SearchService] Error indexing transcript:', e.message);
    }
  } else {
    const database = await transcriptDb.getDb();

    try {
      database.run('DELETE FROM transcripts_fts WHERE id = ?', [transcript.id]);
      database.run(`
        INSERT INTO transcripts_fts(id, call_title, transcript_text, rep_name, participants)
        VALUES (?, ?, ?, ?, ?)
      `, [
        transcript.id,
        transcript.call_title || '',
        transcript.transcript_text || '',
        transcript.rep_name || '',
        typeof transcript.participants === 'string'
          ? transcript.participants
          : JSON.stringify(transcript.participants || [])
      ]);
      transcriptDb.saveDatabase();
    } catch (e) {
      console.error('[SearchService] Error indexing transcript:', e.message);
    }
  }
}

/**
 * Remove a transcript from the search index
 * @param {string} transcriptId - ID of transcript to remove
 */
async function removeFromIndex(transcriptId) {
  if (dbAdapter.isUsingPostgres()) {
    // PostgreSQL: Just clear the search_vector
    try {
      await dbAdapter.execute(`
        UPDATE transcripts SET search_vector = NULL WHERE id = $1
      `, [transcriptId]);
    } catch (e) {
      console.error('[SearchService] Error removing from index:', e.message);
    }
  } else {
    const database = await transcriptDb.getDb();
    try {
      database.run('DELETE FROM transcripts_fts WHERE id = ?', [transcriptId]);
      transcriptDb.saveDatabase();
    } catch (e) {
      console.error('[SearchService] Error removing from index:', e.message);
    }
  }
}

/**
 * Search transcripts using full-text search
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @param {number} options.limit - Maximum results (default 50)
 * @param {number} options.offset - Pagination offset (default 0)
 * @param {string} options.repName - Filter by rep name
 * @param {string} options.dateFrom - Filter by date from (ISO string)
 * @param {string} options.dateTo - Filter by date to (ISO string)
 * @returns {Promise<Object>} - Search results with total count
 */
async function searchTranscripts(query, options = {}) {
  const limit = options.limit || 50;
  const offset = options.offset || 0;

  if (!query || query.trim().length === 0) {
    return { results: [], total: 0 };
  }

  try {
    if (dbAdapter.isUsingPostgres()) {
      return await searchPostgres(query, options, limit, offset);
    } else {
      return await searchSqlite(query, options, limit, offset);
    }
  } catch (e) {
    console.error('[SearchService] Search error:', e.message);
    return { results: [], total: 0, error: e.message };
  }
}

/**
 * PostgreSQL full-text search implementation
 */
async function searchPostgres(query, options, limit, offset) {
  const params = [];
  let paramIndex = 1;

  // Convert query to tsquery format
  const sanitizedQuery = sanitizeFtsQuery(query);
  const tsQuery = sanitizedQuery.split(/\s+/).filter(w => w.length > 0).join(' & ');

  params.push(tsQuery);
  paramIndex++;

  // Build filter conditions
  let filterConditions = ['deleted_at IS NULL'];

  if (options.repName) {
    filterConditions.push(`rep_name = $${paramIndex}`);
    params.push(options.repName);
    paramIndex++;
  }

  if (options.dateFrom) {
    filterConditions.push(`call_datetime >= $${paramIndex}`);
    params.push(options.dateFrom);
    paramIndex++;
  }

  if (options.dateTo) {
    filterConditions.push(`call_datetime <= $${paramIndex}`);
    params.push(options.dateTo);
    paramIndex++;
  }

  const filterClause = filterConditions.length > 0
    ? 'AND ' + filterConditions.join(' AND ')
    : '';

  // Search query with ts_headline for snippets
  const searchSql = `
    SELECT
      id, fireflies_id, call_title, call_datetime, duration_seconds,
      rep_name, rep_email, participants, source_url,
      ts_headline('english', COALESCE(transcript_text, ''), plainto_tsquery('english', $1),
        'StartSel=<mark>, StopSel=</mark>, MaxWords=50, MinWords=25') as snippet,
      ts_rank(search_vector, plainto_tsquery('english', $1)) as rank
    FROM transcripts
    WHERE search_vector @@ plainto_tsquery('english', $1)
    ${filterClause}
    ORDER BY rank DESC, call_datetime DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;
  params.push(limit, offset);

  const countSql = `
    SELECT COUNT(*) as total
    FROM transcripts
    WHERE search_vector @@ plainto_tsquery('english', $1)
    ${filterClause}
  `;

  const searchResult = await dbAdapter.query(searchSql, params);
  const countResult = await dbAdapter.query(countSql, params.slice(0, paramIndex - 1));

  const total = countResult.rows.length > 0 ? parseInt(countResult.rows[0].total, 10) : 0;

  const results = searchResult.rows.map(row => {
    if (row.participants && typeof row.participants === 'string') {
      try {
        row.participants = JSON.parse(row.participants);
      } catch (e) {
        row.participants = [];
      }
    }
    return row;
  });

  return { results, total };
}

/**
 * SQLite FTS4 search implementation
 */
async function searchSqlite(query, options, limit, offset) {
  const database = await transcriptDb.getDb();

  const sanitizedQuery = sanitizeFtsQuery(query);

  let filterClauses = ['t.deleted_at IS NULL'];
  let filterParams = [];

  if (options.repName) {
    filterClauses.push('t.rep_name = ?');
    filterParams.push(options.repName);
  }

  if (options.dateFrom) {
    filterClauses.push('t.call_datetime >= ?');
    filterParams.push(options.dateFrom);
  }

  if (options.dateTo) {
    filterClauses.push('t.call_datetime <= ?');
    filterParams.push(options.dateTo);
  }

  const filterClause = filterClauses.length > 0
    ? 'AND ' + filterClauses.join(' AND ')
    : '';

  const searchSql = `
    SELECT
      t.id, t.fireflies_id, t.call_title, t.call_datetime, t.duration_seconds,
      t.rep_name, t.rep_email, t.participants, t.source_url,
      snippet(transcripts_fts, '<mark>', '</mark>', '...', -1, 50) as snippet
    FROM transcripts_fts fts
    JOIN transcripts t ON fts.id = t.id
    WHERE transcripts_fts MATCH ?
    ${filterClause}
    ORDER BY t.call_datetime DESC
    LIMIT ? OFFSET ?
  `;

  const countSql = `
    SELECT COUNT(*) as total
    FROM transcripts_fts fts
    JOIN transcripts t ON fts.id = t.id
    WHERE transcripts_fts MATCH ?
    ${filterClause}
  `;

  const searchResult = database.exec(searchSql, [sanitizedQuery, ...filterParams, limit, offset]);
  const countResult = database.exec(countSql, [sanitizedQuery, ...filterParams]);

  const total = countResult.length > 0 && countResult[0].values.length > 0
    ? countResult[0].values[0][0]
    : 0;

  if (!searchResult.length || !searchResult[0].values.length) {
    return { results: [], total };
  }

  const columns = searchResult[0].columns;
  const results = searchResult[0].values.map(row => {
    const obj = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });

    if (obj.participants) {
      try {
        obj.participants = JSON.parse(obj.participants);
      } catch (e) {
        obj.participants = [];
      }
    }

    return obj;
  });

  return { results, total };
}

/**
 * Sanitize a query string for FTS
 * @param {string} query - Raw query string
 * @returns {string} - Sanitized query
 */
function sanitizeFtsQuery(query) {
  let sanitized = query.trim().replace(/\s+/g, ' ');

  const isPhrase = sanitized.startsWith('"') && sanitized.endsWith('"');
  if (isPhrase) {
    return sanitized;
  }

  const words = sanitized.split(' ').filter(w => w.length > 0);

  if (words.length === 1) {
    const word = words[0].replace(/[^\w\s*-]/g, '');
    return word.length > 0 ? `${word}*` : '';
  }

  const processed = words.map(word => {
    const clean = word.replace(/[^\w\s*-]/g, '');
    return clean.length > 0 ? `${clean}*` : '';
  }).filter(w => w.length > 0);

  return processed.join(' ');
}

/**
 * Highlight search terms in text
 * @param {string} text - Text to highlight
 * @param {string} query - Search query
 * @param {string} highlightTag - HTML tag for highlighting (default 'mark')
 * @returns {string} - Text with highlighted terms
 */
function highlightMatches(text, query, highlightTag = 'mark') {
  if (!text || !query) {
    return text;
  }

  const terms = query.trim()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(t => t.length > 2);

  if (terms.length === 0) {
    return text;
  }

  const pattern = new RegExp(`(${terms.join('|')})`, 'gi');
  return text.replace(pattern, `<${highlightTag}>$1</${highlightTag}>`);
}

/**
 * Get search suggestions based on partial query
 * @param {string} query - Partial query
 * @param {number} limit - Maximum suggestions
 * @returns {Promise<Array>} - Suggested search terms
 */
async function getSearchSuggestions(query, limit = 5) {
  if (!query || query.length < 2) {
    return [];
  }

  try {
    const result = await dbAdapter.query(`
      SELECT DISTINCT call_title
      FROM transcripts
      WHERE call_title LIKE $1
      AND deleted_at IS NULL
      ORDER BY call_datetime DESC
      LIMIT $2
    `, [`%${query}%`, limit]);

    if (!result.rows || !result.rows.length) {
      return [];
    }

    return result.rows.map(row => row.call_title);
  } catch (e) {
    console.error('[SearchService] Suggestions error:', e.message);
    return [];
  }
}

module.exports = {
  initSearchTable,
  rebuildSearchIndex,
  indexTranscript,
  removeFromIndex,
  searchTranscripts,
  sanitizeFtsQuery,
  highlightMatches,
  getSearchSuggestions
};
