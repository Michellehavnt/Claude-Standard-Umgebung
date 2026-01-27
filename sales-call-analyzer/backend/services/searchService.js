/**
 * Search Service
 * Full-text search functionality for transcripts using SQLite FTS4
 */

const transcriptDb = require('./transcriptDb');

/**
 * Initialize the FTS4 virtual table for full-text search
 * Should be called after transcripts table is initialized
 */
async function initSearchTable() {
  const database = await transcriptDb.getDb();

  // Create FTS4 virtual table for full-text search
  // We index: call_title, transcript_text, rep_name, participants
  // Using standalone FTS table (not content table) for simpler sync
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
    // Table may already exist
    if (!e.message.includes('already exists')) {
      console.error('[SearchService] Error creating FTS table:', e.message);
    }
  }

  // Rebuild the FTS index from existing data
  await rebuildSearchIndex();

  transcriptDb.saveDatabase();
  console.log('[SearchService] FTS table initialized');
}

/**
 * Rebuild the entire FTS index from the transcripts table
 * This should be called on initialization and when data is out of sync
 */
async function rebuildSearchIndex() {
  const database = await transcriptDb.getDb();

  try {
    // Clear existing FTS data
    database.run('DELETE FROM transcripts_fts');

    // Populate FTS table from transcripts
    database.run(`
      INSERT INTO transcripts_fts(id, call_title, transcript_text, rep_name, participants)
      SELECT id, call_title, transcript_text, rep_name, participants
      FROM transcripts
      WHERE transcript_text IS NOT NULL AND transcript_text != ''
    `);

    transcriptDb.saveDatabase();
    console.log('[SearchService] FTS index rebuilt');
  } catch (e) {
    console.error('[SearchService] Error rebuilding FTS index:', e.message);
  }
}

/**
 * Index a single transcript (call after saving a new transcript)
 * @param {Object} transcript - Transcript to index
 */
async function indexTranscript(transcript) {
  const database = await transcriptDb.getDb();

  if (!transcript.transcript_text) {
    return; // Nothing to index
  }

  try {
    // Remove existing entry if any
    database.run('DELETE FROM transcripts_fts WHERE id = ?', [transcript.id]);

    // Add to FTS index
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

/**
 * Remove a transcript from the search index
 * @param {string} transcriptId - ID of transcript to remove
 */
async function removeFromIndex(transcriptId) {
  const database = await transcriptDb.getDb();

  try {
    database.run('DELETE FROM transcripts_fts WHERE id = ?', [transcriptId]);
    transcriptDb.saveDatabase();
  } catch (e) {
    console.error('[SearchService] Error removing from index:', e.message);
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
  const database = await transcriptDb.getDb();

  const limit = options.limit || 50;
  const offset = options.offset || 0;

  if (!query || query.trim().length === 0) {
    return { results: [], total: 0 };
  }

  // Sanitize query for FTS4 - escape special characters
  const sanitizedQuery = sanitizeFtsQuery(query);

  try {
    // Build the WHERE clause for additional filters
    let filterClauses = [];
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

    // Search using FTS4 MATCH
    const searchSql = `
      SELECT
        t.id,
        t.fireflies_id,
        t.call_title,
        t.call_datetime,
        t.duration_seconds,
        t.rep_name,
        t.rep_email,
        t.participants,
        t.source_url,
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

    // Execute search query
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

      // Parse participants JSON
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
  } catch (e) {
    console.error('[SearchService] Search error:', e.message);
    return { results: [], total: 0, error: e.message };
  }
}

/**
 * Sanitize a query string for FTS4
 * Escapes special characters and handles phrase queries
 * @param {string} query - Raw query string
 * @returns {string} - Sanitized query
 */
function sanitizeFtsQuery(query) {
  // Trim and normalize whitespace
  let sanitized = query.trim().replace(/\s+/g, ' ');

  // Check if it's a phrase query (quoted)
  const isPhrase = sanitized.startsWith('"') && sanitized.endsWith('"');

  if (isPhrase) {
    // Keep the phrase as-is, just clean it
    return sanitized;
  }

  // For non-phrase queries:
  // - Split into words
  // - Filter out empty strings
  // - Handle special FTS operators (AND, OR, NOT, NEAR)
  const words = sanitized.split(' ').filter(w => w.length > 0);

  // If single word, add wildcard for prefix matching
  if (words.length === 1) {
    // Escape special characters
    const word = words[0].replace(/[^\w\s*-]/g, '');
    return word.length > 0 ? `${word}*` : '';
  }

  // For multiple words, treat as AND query (implicit in FTS4)
  // Add wildcards for partial matching
  const processed = words.map(word => {
    // Remove special characters except wildcard
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

  // Get search terms
  const terms = query.trim()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(t => t.length > 2); // Ignore very short terms

  if (terms.length === 0) {
    return text;
  }

  // Create regex pattern for all terms
  const pattern = new RegExp(`(${terms.join('|')})`, 'gi');

  // Replace with highlighted version
  return text.replace(pattern, `<${highlightTag}>$1</${highlightTag}>`);
}

/**
 * Get search suggestions based on partial query
 * Returns recent/popular search terms that match
 * @param {string} query - Partial query
 * @param {number} limit - Maximum suggestions
 * @returns {Promise<Array>} - Suggested search terms
 */
async function getSearchSuggestions(query, limit = 5) {
  const database = await transcriptDb.getDb();

  if (!query || query.length < 2) {
    return [];
  }

  try {
    // Search for matching call titles
    const result = database.exec(`
      SELECT DISTINCT call_title
      FROM transcripts
      WHERE call_title LIKE ?
      ORDER BY call_datetime DESC
      LIMIT ?
    `, [`%${query}%`, limit]);

    if (!result.length || !result[0].values.length) {
      return [];
    }

    return result[0].values.map(row => row[0]);
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
