'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');

const authRouter = require('./routes/auth');
const authMiddleware = require('./middleware/auth');
const setupModeMiddleware = require('./middleware/setupMode');

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigin = process.env.CORS_ORIGIN || process.env.API_URL || 'http://localhost:4200';
app.use(cors({ origin: allowedOrigin }));
app.use(express.json());

// Health check — always available
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth routes (setup/login are partially gated inside the router)
app.use('/api/auth', authRouter);

// All remaining /api routes require setup to be complete and a valid JWT
app.use('/api', setupModeMiddleware(false), authMiddleware);

// API root
app.get('/api', (_req, res) => {
  res.json({ message: 'Homelab API v1' });
});

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Homelab backend listening on port ${PORT}`);
});
