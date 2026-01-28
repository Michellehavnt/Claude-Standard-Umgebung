/**
 * Add changelog entry for soft delete feature
 * Run with: node scripts/add-changelog-soft-delete.js
 */

const transcriptDb = require('../services/transcriptDb');
const dbAdapter = require('../services/dbAdapter');

async function addChangelogEntry() {
  try {
    console.log('Initializing database...');
    await dbAdapter.initDb();
    
    const entry = {
      title: 'Persistent Deleted Calls + Restore',
      summary: `- Delete calls and they stay deleted across refreshes, restarts, and re-syncs
- Auto-delete rules: Weekly calls, "AF ads jour fixe" calls, and calls titled exactly "dev" are auto-deleted on sync
- View deleted calls with new "Deleted Calls" view toggle
- Restore deleted calls anytime with the Restore button
- Deleted calls are excluded from analysis pipeline`,
      details: `This feature adds soft delete functionality to preserve deleted call state:

**Auto-Delete Rules:**
- Titles containing "weekly" → auto-deleted
- Titles containing "af ads jour fixe" → auto-deleted
- Titles exactly "dev" (case-insensitive) → auto-deleted

**UI Changes:**
- View dropdown to switch between "Active Calls" and "Deleted Calls"
- Deleted view shows call title, when deleted, and deletion reason
- Reason badges: Manual, Weekly Filter, Jour Fixe Filter, Dev Filter
- Restore functionality for single calls or bulk restore`,
      tag: 'new',
      is_published: true,
      show_as_new_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 7 days
      created_by: 'system'
    };
    
    console.log('Creating changelog entry...');
    const result = await transcriptDb.createChangelogEntry(entry);
    
    console.log('✅ Changelog entry created successfully!');
    console.log('   ID:', result.id);
    console.log('   Title:', result.title);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating changelog entry:', error);
    process.exit(1);
  }
}

addChangelogEntry();
