const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { initDatabase } = require('./services/database');
const { initSlack } = require('./services/slack');
const transcriptsRouter = require('./routes/transcripts');
const analysisRouter = require('./routes/analysis');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/transcripts', transcriptsRouter);
app.use('/api', analysisRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize and start server
async function start() {
  try {
    // Initialize database
    await initDatabase();
    console.log('Database initialized');

    // Initialize Slack (optional - won't fail if not configured)
    if (process.env.SLACK_BOT_TOKEN) {
      const slackInitialized = await initSlack();
      if (slackInitialized) {
        console.log('Slack integration initialized');
      }
    } else {
      console.log('Slack integration disabled (no SLACK_BOT_TOKEN)');
    }

    // Start server
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
