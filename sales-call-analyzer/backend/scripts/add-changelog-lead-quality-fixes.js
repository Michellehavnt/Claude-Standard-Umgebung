/**
 * Add changelog entry for Lead Quality fixes and improvements
 * Run with: node scripts/add-changelog-lead-quality-fixes.js
 */

const transcriptDb = require('../services/transcriptDb');
const dbAdapter = require('../services/dbAdapter');

async function addChangelogEntry() {
  try {
    console.log('Initializing database...');
    await dbAdapter.initDb();

    const entry = {
      title: 'Lead Quality Tab Improvements',
      summary: `- Fixed transcript analysis: "Transcript content not available" error now resolved
- Added delete button: Remove leads from the Lead Quality tab with confirmation
- Fixed Calendly sync: Now fetches ALL events using proper pagination (not just first page)
- Improved action buttons: Perplexity and OpenAI icons now display correctly
- Default tracked rep: phil@affiliatefinder.ai is now pre-configured`,
      details: `**Bug Fixes:**
- Fixed transcript field name mismatch (transcript_text vs transcript)
- Fixed Calendly pagination using next_page URL instead of page_token parameter
- Ensured tracked reps field is never empty by defaulting to phil@affiliatefinder.ai

**UI Improvements:**
- Action buttons now show proper brand icons for Perplexity and OpenAI
- Added delete button with trash icon and danger hover state
- Improved button sizing (32x32px buttons, 18x18px images)

**API Updates:**
- Added DELETE /api/lead-quality/leads/:id endpoint for lead removal`,
      tag: 'fix',
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
