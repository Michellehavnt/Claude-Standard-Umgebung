import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import vendorsRouter from './routes/vendors';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));

app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    hubspotConfigured: !!process.env.HUBSPOT_API_KEY,
  });
});

// API Routes
app.use('/api/vendors', vendorsRouter);

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Dashboard API available at http://localhost:${PORT}/api/vendors/dashboard`);

  if (!process.env.HUBSPOT_API_KEY) {
    console.warn('⚠️  Warning: HUBSPOT_API_KEY is not configured. API calls will fail.');
  }
});

export default app;
