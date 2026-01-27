const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
require('dotenv').config();

const { initDatabase } = require('./services/database');
const { initTranscriptsTable, saveDatabase, seedInternalUsers } = require('./services/transcriptDb');
const { initSecrets } = require('./services/secretManager');
const { initSearchTable } = require('./services/searchService');
const transcriptsRouter = require('./routes/transcripts');
const analysisRouter = require('./routes/analysis');
const syncRouter = require('./routes/sync');
const adminRouter = require('./routes/admin');
const callAnalysisRouter = require('./routes/callAnalysis');
const dashboardRouter = require('./routes/dashboard');
const dfyRouter = require('./routes/dfy');
const stripeEnrichmentRouter = require('./routes/stripeEnrichment');
const settingsRouter = require('./routes/settings');
const authRouter = require('./routes/auth');
const searchRouter = require('./routes/search');
const snapshotRouter = require('./routes/snapshot');
const founderRouter = require('./routes/founder');
const bulkActionsRouter = require('./routes/bulkActions');
const closingRateAdjustmentsRouter = require('./routes/closingRateAdjustments');
const enrichmentRouter = require('./routes/enrichment');
const changelogRouter = require('./routes/changelog');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Serve static files for admin page
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));

// API Routes
app.use('/api/transcripts', transcriptsRouter);
app.use('/api', analysisRouter);
app.use('/api/sync', syncRouter);
app.use('/api/admin', adminRouter);
app.use('/api/analysis', callAnalysisRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/dfy', dfyRouter);
app.use('/api/stripe', stripeEnrichmentRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/auth', authRouter);
app.use('/api/search', searchRouter);
app.use('/api/insights/snapshot', snapshotRouter);
app.use('/api/founder', founderRouter);
app.use('/api/bulk', bulkActionsRouter);
app.use('/api/closing-rate', closingRateAdjustmentsRouter);
app.use('/api/enrichment', enrichmentRouter);
app.use('/api/changelog', changelogRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Database debug endpoint
app.get('/api/debug/db', async (req, res) => {
  try {
    const dbAdapter = require('./services/dbAdapter');
    const transcriptDb = require('./services/transcriptDb');
    const count = await transcriptDb.getTranscriptCount();
    res.json({
      databaseType: dbAdapter.isUsingPostgres() ? 'PostgreSQL' : 'SQLite',
      hasDbUrl: !!process.env.DATABASE_URL,
      transcriptCount: count,
      nodeEnv: process.env.NODE_ENV
    });
  } catch (error) {
    res.json({ error: error.message, stack: error.stack });
  }
});

// Admin page redirect
app.get('/', (req, res) => {
  res.redirect('/admin');
});

// Initialize and start server
async function start() {
  try {
    console.log('Starting server initialization...');
    console.log('PORT:', PORT);

    // Initialize secrets manager
    console.log('Initializing secrets...');
    initSecrets();

    // Initialize databases
    console.log('Initializing main database...');
    await initDatabase();
    console.log('Main database initialized');

    console.log('Initializing transcripts table...');
    await initTranscriptsTable();
    console.log('Transcripts table initialized');

    console.log('Initializing search table...');
    await initSearchTable();
    console.log('Search index initialized');

    // Seed internal users
    console.log('Seeding internal users...');
    await seedInternalUsers();
    console.log('Internal users seeded');

    // Start server - bind to 0.0.0.0 for Railway
    console.log('Starting HTTP server...');
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Admin page: http://localhost:${PORT}/admin`);
      console.log(`Settings page: http://localhost:${PORT}/admin/settings.html`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    console.error('Error stack:', error.stack);
    process.exit(1);
  }
}

// Graceful shutdown handler - save database before exit
function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Saving database...`);
  try {
    saveDatabase();
    console.log('Database saved successfully.');
  } catch (error) {
    console.error('Error saving database:', error);
  }
  process.exit(0);
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Export for testing
module.exports = { app };

// Start if not in test mode
if (process.env.NODE_ENV !== 'test') {
  start();
}
