const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { initDatabase } = require('./services/database');
const transcriptsRouter = require('./routes/transcripts');
const analysisRouter = require('./routes/analysis');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database
initDatabase();

// Routes
app.use('/api/transcripts', transcriptsRouter);
app.use('/api', analysisRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
