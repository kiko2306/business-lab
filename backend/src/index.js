'use strict';

try {
  require('dotenv').config();
} catch {
  // dotenv is optional in containerized runtime where env vars are injected directly.
}

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
const usersRouter = require('./routes/users');
const { dropLegacyRoleColumn, ensureServiceExposureTable } = require('./utils/database');
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

// Behind Cloudflare Tunnel / Nginx Proxy Manager there is exactly one reverse
// proxy hop in front of this container, so express-rate-limit and req.ip can
// trust the single nearest X-Forwarded-For entry. Override via TRUST_PROXY if
// the deployment adds more hops (e.g. an additional load balancer). Numeric
// values must be passed as an actual Number — express-rate-limit treats a
// numeric *string* as a trusted IP/subnet rather than a hop count.
const trustProxySetting = process.env.TRUST_PROXY;
app.set('trust proxy', trustProxySetting !== undefined && trustProxySetting !== '' && !Number.isNaN(Number(trustProxySetting))
  ? Number(trustProxySetting)
  : trustProxySetting || 1);

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

// Ping check — always available, unauthenticated
app.get('/ping', (_req, res) => {
  res.status(200).json({ statusCode: 200, message: 'Pong' });
});

// Every router is served both at the root (e.g. /auth/login) and under the
// legacy /api prefix (e.g. /api/auth/login) so that deployments pointing a
// dedicated API hostname at this server do not need the redundant /api segment.
const ROUTE_PREFIXES = ['', '/api'];

const protectedGate = () => [apiLimiter, setupModeMiddleware(false), authMiddleware];

for (const prefix of ROUTE_PREFIXES) {
  // Auth routes (setup/login are partially gated inside the router)
  app.use(`${prefix}/auth`, authRouter);
  app.use(`${prefix}/recovery`, recoveryRouter);
  // The SSE stream authenticates via a short-lived ticket, so it must be
  // registered before the JWT gate below.
  app.get(`${prefix}/services/stream`, streamLimiter, sseHandler);

  // API root
  app.get(prefix || '/', ...protectedGate(), (_req, res) => {
    res.json({ message: 'Homelab API v1' });
  });

  // Remaining routes require setup to be complete and a valid JWT
  app.use(`${prefix}/services`, ...protectedGate(), servicesRouter);
  app.use(`${prefix}/settings`, ...protectedGate(), settingsRouter);
  app.use(`${prefix}/audit-logs`, ...protectedGate(), auditRouter);
  app.use(`${prefix}/backups`, ...protectedGate(), backupRouter);
  app.use(`${prefix}/users`, ...protectedGate(), usersRouter);
  // Mounted after the public liveness probe above, so GET /health stays public
  // while GET /health/system and /health/thresholds remain protected.
  app.use(`${prefix}/health`, ...protectedGate(), healthRouter);
}

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err?.message === 'Origin not allowed by CORS policy') {
    return res.status(403).json({ error: 'CORS origin denied' });
  }
  console.error('Unhandled error:', err.message);
  return res.status(500).json({ error: 'Internal server error' });
});

dropLegacyRoleColumn().catch((err) => {
  console.error('Unable to drop legacy users.role column:', err.message);
});
ensureServiceExposureTable().catch((err) => {
  console.error('Unable to ensure service_exposure table:', err.message);
});

const server = app.listen(PORT, () => {
  console.log(`Homelab backend listening on port ${PORT}`);
});

initWebSocket(server);
