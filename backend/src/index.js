'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');

const authRouter = require('./routes/auth');
const servicesRouter = require('./routes/services');
const settingsRouter = require('./routes/settings');
const auditRouter = require('./routes/audit');
const backupRouter = require('./routes/backup');
const healthRouter = require('./routes/health');
const recoveryRouter = require('./routes/recovery');
const authMiddleware = require('./middleware/auth');
const setupModeMiddleware = require('./middleware/setupMode');
const rateLimit = require('express-rate-limit');
const { initWebSocket, sseHandler } = require('./services/realtime');

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
const streamLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many stream requests, please try again later' },
});

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
app.use('/api/recovery', recoveryRouter);
app.get('/api/services/stream', streamLimiter, sseHandler);

// All remaining /api routes require setup to be complete and a valid JWT
app.use('/api', apiLimiter, setupModeMiddleware(false), authMiddleware);

// API root
app.get('/api', (_req, res) => {
  res.json({ message: 'Homelab API v1' });
});

// Services routes
app.use('/api/services', servicesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/audit-logs', auditRouter);
app.use('/api/backups', backupRouter);
app.use('/api/health', healthRouter);

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(`Homelab backend listening on port ${PORT}`);
});

initWebSocket(server);
