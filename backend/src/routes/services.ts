/**
 * Services API routes
 * Handles service start, stop, and status endpoints.
 */

import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import auth from '../middleware/auth';
import { requireCapability } from '../middleware/requireCapability';
import * as executor from '../services/executor';
import * as status from '../services/status';
import { createStreamTicket } from '../services/realtime';
import { getPublishedUpstreamPort, getService, isValidServiceName } from '../config/services';
import { schemas, validateParams, validateBody } from '../middleware/validation';
import { deprovisionServiceExposure, getServiceExposureRow, upsertServiceExposureConfig, provisionServiceIfEnabled } from '../services/exposure';
import { regenerateHomepageServices } from '../services/homepageConfig';
import { getServiceEnvStatus, saveServiceEnv } from '../services/appEnv';
import { getAutheliaAdminUser, updateAutheliaAdminUser } from '../services/autheliaUsers';
import { writeAuditLog } from '../utils/audit';
import logger from '../utils/logger';
import { HttpError } from '../types';

const router = Router();

const serviceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many service requests, please try again later.' },
});

function validateServiceAllowlist(req: Request, res: Response, next: NextFunction) {
  if (!isValidServiceName(req.params.name)) {
    return res.status(400).json({ error: 'Invalid service name' });
  }
  return next();
}

function requireAdminUserSupport(req: Request, res: Response, next: NextFunction) {
  if (!getService(req.params.name)?.supportsAdminUserManagement) {
    return res.status(404).json({ error: 'This service does not support admin account management.' });
  }
  return next();
}

/**
 * GET /api/services/status
 * Get status of all services
 */
router.get('/status', serviceLimiter, auth, async (req: Request, res: Response) => {
  try {
    const serviceStatus = await status.getAllServiceStatus();
    res.json(serviceStatus);
  } catch (error) {
    logger.error('Failed to get service status', {
      error: (error as Error).message,
      userId: req.user?.id,
    });
    res.status(500).json({
      error: 'Failed to retrieve service status',
      message: (error as Error).message,
    });
  }
});

router.post('/stream-ticket', serviceLimiter, auth, (req: Request, res: Response) => {
  const ticket = createStreamTicket(req.user!.id);
  res.json({ ticket, expiresInSeconds: 60 });
});

/**
 * POST /api/services/:name/start
 * Start a service
 */
router.post(
  '/:name/start',
  serviceLimiter,
  auth,
  requireCapability('apps:control'),
  validateParams(schemas.serviceNameParam),
  validateServiceAllowlist,
  async (req: Request, res: Response) => {
    const serviceName = req.params.name;
    const userId = req.user!.id;

    try {
      logger.info(`Service start request: ${serviceName}`, { userId, service: serviceName });

      const result = await executor.startService(serviceName, userId);
      res.json(result);
    } catch (error) {
      const httpError = error as HttpError;
      logger.error(`Service start failed: ${serviceName}`, {
        userId,
        error: httpError.message,
      });

      const statusCode = httpError.statusCode || 500;
      res.status(statusCode).json({
        error: 'Failed to start service',
        service: serviceName,
        message: httpError.message,
        details: httpError.details,
      });
    }
  }
);

/**
 * POST /api/services/:name/stop
 * Stop a service
 */
router.post(
  '/:name/stop',
  serviceLimiter,
  auth,
  requireCapability('apps:control'),
  validateParams(schemas.serviceNameParam),
  validateServiceAllowlist,
  async (req: Request, res: Response) => {
    const serviceName = req.params.name;
    const userId = req.user!.id;

    try {
      logger.info(`Service stop request: ${serviceName}`, { userId, service: serviceName });

      const result = await executor.stopService(serviceName, userId);
      res.json(result);
    } catch (error) {
      const httpError = error as HttpError;
      logger.error(`Service stop failed: ${serviceName}`, {
        userId,
        error: httpError.message,
      });

      const statusCode = httpError.statusCode || 500;
      res.status(statusCode).json({
        error: 'Failed to stop service',
        service: serviceName,
        message: httpError.message,
        details: httpError.details,
      });
    }
  }
);

/**
 * POST /api/services/:name/update
 * Pull newer images for a service and recreate it on them. Replaces
 * Watchtower's unattended updates with a deliberate, per-app action (§81.3).
 */
router.post(
  '/:name/update',
  serviceLimiter,
  auth,
  requireCapability('apps:control'),
  validateParams(schemas.serviceNameParam),
  validateServiceAllowlist,
  async (req: Request, res: Response) => {
    const serviceName = req.params.name;
    const userId = req.user!.id;

    try {
      logger.info(`Service update request: ${serviceName}`, { userId, service: serviceName });

      const result = await executor.updateService(serviceName, userId);
      res.json(result);
    } catch (error) {
      const httpError = error as HttpError;
      logger.error(`Service update failed: ${serviceName}`, { userId, error: httpError.message });

      const statusCode = httpError.statusCode || 500;
      res.status(statusCode).json({
        error: 'Failed to update service',
        service: serviceName,
        message: httpError.message,
        details: httpError.details,
      });
    }
  }
);

/**
 * GET /api/services/:name/exposure
 * Read public exposure provisioning config and status for a service
 */
router.get(
  '/:name/exposure',
  auth,
  validateParams(schemas.serviceNameParam),
  validateServiceAllowlist,
  async (req: Request, res: Response) => {
    try {
      // Services with no published port (e.g. tailscale — a VPN client
      // sidecar, no web UI) have nothing a reverse proxy could ever
      // forward to. Report that up front, and don't surface a stale
      // hostname/error from a stored row for a service that was briefly
      // (mis)configured before this check existed — see
      // upsertServiceExposureConfig in exposure.ts for the write-side guard.
      const exposable = getPublishedUpstreamPort(req.params.name) !== null;

      const row = await getServiceExposureRow(req.params.name);
      if (!row) {
        return res.json({
          enabled: false,
          exposable,
          hostname: null,
          upstreamScheme: 'http',
          upstreamHost: null,
          upstreamPort: null,
          websocket: false,
          autheliaProtected: false,
          status: 'not_provisioned',
          lastError: null,
        });
      }

      return res.json({
        enabled: row.enabled,
        exposable,
        hostname: exposable ? row.hostname : null,
        upstreamScheme: row.upstream_scheme,
        upstreamHost: row.upstream_host,
        upstreamPort: row.upstream_port,
        websocket: row.websocket,
        autheliaProtected: row.authelia_protected,
        status: row.status,
        lastError: exposable ? row.last_error : null,
      });
    } catch (error) {
      logger.error(`Failed to load exposure config: ${req.params.name}`, { error: (error as Error).message });
      return res.status(500).json({ error: 'Unable to load exposure configuration.' });
    }
  }
);

/**
 * PUT /api/services/:name/exposure
 * Configure public exposure provisioning for a service. Opt-in per service;
 * provisioning itself happens on the next successful service start.
 */
router.put(
  '/:name/exposure',
  auth,
  requireCapability('apps:expose'),
  validateParams(schemas.serviceNameParam),
  validateServiceAllowlist,
  validateBody(schemas.serviceExposureUpdate),
  async (req: Request, res: Response) => {
    try {
      const previous = await getServiceExposureRow(req.params.name);
      const row = await upsertServiceExposureConfig(req.params.name, req.body);

      // Turning exposure off has to actually take the service off the
      // internet. Before this, the row flipped to disabled while the NPM
      // host, tunnel ingress rule and DNS record all stayed live and kept
      // serving traffic — the setting looked applied and wasn't.
      const turnedOff = Boolean(previous?.enabled) && !row.enabled;
      if (turnedOff) {
        await deprovisionServiceExposure(req.params.name, req.user!.id);
      }

      // A Home Page tile is only written for a running, exposed app — so
      // disabling exposure has to drop the tile, and (re)enabling it changes
      // the link. The other side, provisioning, happens on the next start,
      // which regenerates too.
      await regenerateHomepageServices();

      return res.json({
        message: turnedOff
          ? 'Exposure disabled and public hostnames removed.'
          : 'Exposure configuration saved. Restart the service to apply it.',
        enabled: row.enabled,
        hostname: row.hostname,
      });
    } catch (error) {
      const httpError = error as HttpError;
      logger.error(`Failed to save exposure config: ${req.params.name}`, { error: httpError.message });
      return res.status(httpError.statusCode || 500).json({ error: httpError.statusCode ? httpError.message : 'Unable to save exposure configuration.' });
    }
  }
);

/**
 * POST /api/services/:name/exposure/verify
 * Re-verify (and reconcile, since ensureProxyHost/ensureIngressRoute are
 * idempotent) a service's exposure against the live NPM/Cloudflare state —
 * catches drift if either was hand-edited outside this app, without
 * requiring a full service restart.
 */
router.post(
  '/:name/exposure/verify',
  serviceLimiter,
  auth,
  requireCapability('apps:expose'),
  validateParams(schemas.serviceNameParam),
  validateServiceAllowlist,
  async (req: Request, res: Response) => {
    const serviceName = req.params.name;

    try {
      const row = await getServiceExposureRow(serviceName);
      if (!row || !row.enabled) {
        return res.status(400).json({ error: 'Exposure is not enabled for this service.' });
      }

      const result = await provisionServiceIfEnabled(serviceName, req.user!.id);
      const updated = await getServiceExposureRow(serviceName);

      // Re-provisioning can move a hostname from failed to provisioned, which
      // is the point at which the tile becomes linkable.
      await regenerateHomepageServices();

      return res.json({
        ...result,
        status: updated?.status ?? null,
        lastError: updated?.last_error ?? null,
      });
    } catch (error) {
      logger.error(`Failed to verify exposure: ${serviceName}`, { error: (error as Error).message });
      return res.status(500).json({ error: 'Unable to verify exposure configuration.' });
    }
  }
);

/**
 * GET /api/services/:name/env
 * Read a service's required/optional compose env vars and whether each is
 * currently set. Secret-looking values (password/secret/token/key) are
 * never returned, only whether they're set.
 */
router.get(
  '/:name/env',
  auth,
  requireCapability('apps:config'),
  validateParams(schemas.serviceNameParam),
  validateServiceAllowlist,
  async (req: Request, res: Response) => {
    const envStatus = await getServiceEnvStatus(req.params.name);
    if (!envStatus) {
      return res.status(404).json({ error: `Service ${req.params.name} is not installed.` });
    }
    return res.json(envStatus);
  }
);

/**
 * PUT /api/services/:name/env
 * Save a service's .env values from the dashboard, creating the file from
 * .env.example if it doesn't exist yet. Blank values are treated as "leave
 * unchanged" so masked secret fields can be submitted without clearing them.
 */
router.put(
  '/:name/env',
  auth,
  requireCapability('apps:config'),
  validateParams(schemas.serviceNameParam),
  validateServiceAllowlist,
  validateBody(schemas.serviceEnvUpdate),
  async (req: Request, res: Response) => {
    try {
      const { status: envStatus, changedKeys } = await saveServiceEnv(req.params.name, req.body.values);
      await writeAuditLog({
        userId: req.user!.id,
        action: 'SERVICE_ENV_UPDATE',
        resource: req.params.name,
        result: 'success',
        // Key names only — never the values.
        metadata: { changedKeys },
      }).catch(() => {});
      return res.json({ message: 'Configuration saved.', ...envStatus });
    } catch (error) {
      const httpError = error as HttpError;
      logger.error(`Failed to save env config: ${req.params.name}`, { error: httpError.message });
      const statusCode = httpError.statusCode || 500;
      return res.status(statusCode).json({ error: httpError.message || 'Unable to save configuration.' });
    }
  }
);

/**
 * GET /api/services/:name/admin-user
 * Read the manageable admin account for services that support it (currently
 * only Authelia's file-based user database — see services/autheliaUsers.ts).
 */
router.get(
  '/:name/admin-user',
  auth,
  requireCapability('apps:config'),
  validateParams(schemas.serviceNameParam),
  validateServiceAllowlist,
  requireAdminUserSupport,
  (req: Request, res: Response) => {
    const user = getAutheliaAdminUser();
    if (!user) {
      return res.status(404).json({ error: 'No admin account found.' });
    }
    return res.json(user);
  }
);

/**
 * PUT /api/services/:name/admin-user
 * Update the account's username/display name/email and, optionally, its
 * password (bcrypt-hashed the same way Authelia's own `authelia crypto hash
 * generate bcrypt` does). Restarts the service if it's currently running so
 * the change takes effect immediately, since the file backend only reads
 * users_database.yml at startup.
 */
router.put(
  '/:name/admin-user',
  auth,
  requireCapability('apps:config'),
  validateParams(schemas.serviceNameParam),
  validateServiceAllowlist,
  requireAdminUserSupport,
  validateBody(schemas.autheliaAdminUserUpdate),
  async (req: Request, res: Response) => {
    try {
      const user = await updateAutheliaAdminUser(req.body);
      const restart = await executor.restartService(req.params.name, req.user!.id);

      await writeAuditLog({
        userId: req.user!.id,
        action: 'SERVICE_ADMIN_USER_UPDATE',
        resource: req.params.name,
        result: 'success',
        // Never the password — key names/flags only.
        metadata: { username: user.username, passwordChanged: Boolean(req.body.password) },
      }).catch(() => {});

      return res.json({ message: restart.message, user });
    } catch (error) {
      const httpError = error as HttpError;
      logger.error(`Failed to update admin account: ${req.params.name}`, { error: httpError.message });
      const statusCode = httpError.statusCode || 500;
      return res.status(statusCode).json({ error: httpError.message || 'Unable to update admin account.' });
    }
  }
);

export default router;
