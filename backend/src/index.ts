import './loadEnv';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import authRouter from './routes/auth';
import servicesRouter from './routes/services';
import settingsRouter from './routes/settings';
import auditRouter from './routes/audit';
import backupRouter from './routes/backup';
import healthRouter from './routes/health';
import recoveryRouter from './routes/recovery';
import usersRouter from './routes/users';
import networkRouter from './routes/network';
import { dropLegacyRoleColumn, ensureServiceExposureTable, ensureServiceExposureAutheliaColumn } from './utils/database';
import authMiddleware from './middleware/auth';
import setupModeMiddleware from './middleware/setupMode';
import { initWebSocket, sseHandler } from './services/realtime';
import { startupLogsHandler } from './services/serviceLogs';
import { startBackupScheduler } from './services/backupScheduler';
import { reconcileRemovedServices } from './services/exposure';
import { regenerateHomepageServices } from './services/homepageConfig';
import { startImageUpdateSweeper } from './services/imageUpdates';

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
app.set(
  'trust proxy',
  trustProxySetting !== undefined && trustProxySetting !== '' && !Number.isNaN(Number(trustProxySetting))
    ? Number(trustProxySetting)
    : trustProxySetting || 1
);

const allowedOrigins = (process.env.CORS_ORIGIN || process.env.API_URL || 'http://localhost:4200')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions: cors.CorsOptions = {
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

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(cors(corsOptions));
app.use(express.json({ limit: process.env.REQUEST_BODY_LIMIT || '32kb' }));
app.use(mutationLimiter);

// Health check — always available
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Ping check — always available, unauthenticated
app.get('/ping', (_req: Request, res: Response) => {
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
  // Same deal — the per-service startup log stream is ticket-authenticated.
  app.get(`${prefix}/services/:name/startup-logs`, streamLimiter, startupLogsHandler);

  // API root
  app.get(prefix || '/', ...protectedGate(), (_req: Request, res: Response) => {
    res.json({ message: 'Homelab API v1' });
  });

  // Remaining routes require setup to be complete and a valid JWT
  app.use(`${prefix}/services`, ...protectedGate(), servicesRouter);
  app.use(`${prefix}/settings`, ...protectedGate(), settingsRouter);
  app.use(`${prefix}/audit-logs`, ...protectedGate(), auditRouter);
  app.use(`${prefix}/backups`, ...protectedGate(), backupRouter);
  app.use(`${prefix}/users`, ...protectedGate(), usersRouter);
  app.use(`${prefix}/network`, ...protectedGate(), networkRouter);
  // Mounted after the public liveness probe above, so GET /health stays public
  // while GET /health/system and /health/thresholds remain protected.
  app.use(`${prefix}/health`, ...protectedGate(), healthRouter);
}

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err?.message === 'Origin not allowed by CORS policy') {
    return res.status(403).json({ error: 'CORS origin denied' });
  }
  console.error('Unhandled error:', err.message);
  return res.status(500).json({ error: 'Internal server error' });
});

dropLegacyRoleColumn().catch((err: Error) => {
  console.error('Unable to drop legacy users.role column:', err.message);
});
ensureServiceExposureTable().catch((err: Error) => {
  console.error('Unable to ensure service_exposure table:', err.message);
});
ensureServiceExposureAutheliaColumn().catch((err: Error) => {
  console.error('Unable to ensure service_exposure.authelia_protected column:', err.message);
});
startBackupScheduler();
// An app dropped from the registry keeps its NPM proxy host and Cloudflare
// hostname otherwise, with no page left in the dashboard to switch them off.
reconcileRemovedServices().catch((err: Error) => {
  console.error('Unable to reconcile exposure for removed services:', err.message);
});
// The Home Page's services.yaml is otherwise only rewritten on a start/stop or
// an exposure toggle — so a backend restart after app state changed (or a
// fresh deploy) would leave it stale. Reconcile it once on boot. Best-effort
// inside the helper (§114).
regenerateHomepageServices();
startImageUpdateSweeper();

const server = app.listen(PORT, () => {
  console.log(`Homelab backend listening on port ${PORT}`);
});

initWebSocket(server);
