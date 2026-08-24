'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

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

const allowedOrigins = (process.env.CORS_ORIGIN || process.env.API_URL || 'http://localhost:4200')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Origin not allowed by CORS policy'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
  credentials: false,
};

const mutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method),
  message: { error: 'Too many mutation requests, please try again later' },
});

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors(corsOptions));
app.use(express.json({ limit: process.env.REQUEST_BODY_LIMIT || '32kb' }));
app.use(mutationLimiter);

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
  if (err?.message === 'Origin not allowed by CORS policy') {
    return res.status(403).json({ error: 'CORS origin denied' });
  }
  console.error('Unhandled error:', err.message);
  return res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(`Homelab backend listening on port ${PORT}`);
});

initWebSocket(server);
