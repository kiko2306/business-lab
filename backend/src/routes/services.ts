/**
 * Services API routes
 * Handles service start, stop, and status endpoints.
 */

import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import rateLimit from 'express-rate-limit';
import auth from '../middleware/auth';
import { requireCapability } from '../middleware/requireCapability';
import * as executor from '../services/executor';
import * as status from '../services/status';
import { createStreamTicket } from '../services/realtime';
import { getPublishedUpstreamPort, getService, isValidServiceName, resolveComposeFile } from '../config/services';
import { clearImagePins, pinnedImages } from '../services/composeOverride';
import { schemas, validateParams, validateBody } from '../middleware/validation';
import { deprovisionServiceExposure, getServiceExposureRow, upsertServiceExposureConfig, provisionServiceIfEnabled } from '../services/exposure';
import { syncAutheliaAccessControlSafe } from '../services/autheliaAccessControl';
import { regenerateHomepageServices } from '../services/homepageConfig';
import { getServiceEnvStatus, saveServiceEnv } from '../services/appEnv';
import { getAutheliaAdminUser, updateAutheliaAdminUser } from '../services/autheliaUsers';
import { writeAuditLog } from '../utils/audit';
import * as appBackup from '../services/appBackup';
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
 * POST /api/services/:name/update/unpin
 * Drop the managed docker-compose.override.yml image pins the Update button
 * wrote, so the app floats back to the tags in its base compose file. Recreates
 * the container when it is running so the change takes effect now.
 */
router.post(
  '/:name/update/unpin',
  serviceLimiter,
  auth,
  requireCapability('apps:control'),
  validateParams(schemas.serviceNameParam),
  validateServiceAllowlist,
  async (req: Request, res: Response) => {
    const serviceName = req.params.name;
    const userId = req.user!.id;

    try {
      const resolved = resolveComposeFile(serviceName);
      if (!resolved?.appDir || !resolved.composeFile) {
        return res.status(404).json({ error: 'Service is not installed', service: serviceName });
      }

      const had = pinnedImages(resolved.appDir).size;
      clearImagePins(resolved.appDir);
      await writeAuditLog({
        userId,
        action: 'service_update_unpin',
        resource: serviceName,
        result: 'success',
        metadata: { hadPins: had },
      }).catch(() => {});

      let recreated = false;
      if (had) {
        const state = (await status.getServiceStatus(serviceName)).state;
        if (state === 'running') {
          await executor.restartService(serviceName, userId);
          recreated = true;
        }
      }

      return res.json({
        success: true,
        service: serviceName,
        message: had
          ? `Cleared ${had} image pin${had === 1 ? '' : 's'}${recreated ? ' and recreated the container' : ''}.`
          : 'No image pins to clear.',
        recreated,
      });
    } catch (error) {
      const httpError = error as HttpError;
      logger.error(`Unpin failed: ${serviceName}`, { userId, error: httpError.message });
      return res.status(httpError.statusCode || 500).json({
        error: 'Failed to unpin service images',
        service: serviceName,
        message: httpError.message,
      });
    }
  }
);

// ---------------------------------------------------------------------------
// Per-application backup (plan.md §185). A self-contained local .tar.gz per
// app — a quick rollback point before reconfiguring it — separate from the
// offsite Kopia job. `backups:manage` gates all four, the same
// capability the global /api/backups routes use.
// ---------------------------------------------------------------------------

/**
 * POST /api/services/:name/backup
 * Dump this app's database(s) and archive its data/ now.
 */
router.post(
  '/:name/backup',
  serviceLimiter,
  auth,
  requireCapability('backups:manage'),
  validateParams(schemas.serviceNameParam),
  validateServiceAllowlist,
  async (req: Request, res: Response) => {
    const serviceName = req.params.name;
    const userId = req.user!.id;
    try {
      const result = await appBackup.backupOneApp(serviceName);
      await writeAuditLog({
        userId,
        action: 'backup_create',
        resource: serviceName,
        result: result.dumpFailures.length ? 'failure' : 'success',
        metadata: {
          trigger: 'per-app',
          file: result.file,
          dumped: result.manifest.dumps.length,
          dumpFailed: result.dumpFailures.length,
        },
      }).catch(() => {});
      return res.status(201).json({
        success: true,
        service: serviceName,
        file: result.file,
        manifest: result.manifest,
        dumpFailures: result.dumpFailures,
        message: result.dumpFailures.length
          ? `Backed up ${serviceName}, but ${result.dumpFailures.length} database dump${
              result.dumpFailures.length === 1 ? '' : 's'
            } failed — the archive still holds the last good copy.`
          : `Backed up ${serviceName}.`,
      });
    } catch (error) {
      const httpError = error as HttpError;
      logger.error(`Per-app backup failed: ${serviceName}`, { userId, error: httpError.message });
      await writeAuditLog({
        userId,
        action: 'backup_create',
        resource: serviceName,
        result: 'failure',
        metadata: { trigger: 'per-app', error: httpError.message },
      }).catch(() => {});
      return res.status(httpError.statusCode || 500).json({
        error: 'Failed to back up the app',
        service: serviceName,
        message: httpError.message,
      });
    }
  }
);

/**
 * POST /api/services/:name/backup/restore
 * Restore this app from one of its archives: stop it, put data/ back, replay
 * the DB dump, start it. Destructive — the UI confirms before calling.
 */
router.post(
  '/:name/backup/restore',
  serviceLimiter,
  auth,
  requireCapability('backups:manage'),
  validateParams(schemas.serviceNameParam),
  validateBody(schemas.serviceBackupRestore),
  validateServiceAllowlist,
  async (req: Request, res: Response) => {
    const serviceName = req.params.name;
    const userId = req.user!.id;
    const file = req.body.file as string;
    try {
      const result = await appBackup.restoreOneApp(serviceName, file, userId);
      await writeAuditLog({
        userId,
        action: 'backup_restore',
        resource: serviceName,
        result: result.warnings.length ? 'failure' : 'success',
        metadata: { file, warnings: result.warnings },
      }).catch(() => {});
      return res.json({
        success: true,
        ...result,
        message: result.warnings.length
          ? `Restored ${serviceName} with warnings — see the details.`
          : `Restored ${serviceName} from ${file}.`,
      });
    } catch (error) {
      const httpError = error as HttpError;
      logger.error(`Per-app restore failed: ${serviceName}`, { userId, error: httpError.message });
      await writeAuditLog({
        userId,
        action: 'backup_restore',
        resource: serviceName,
        result: 'failure',
        metadata: { file, error: httpError.message },
      }).catch(() => {});
      return res.status(httpError.statusCode || 500).json({
        error: 'Failed to restore the app',
        service: serviceName,
        message: httpError.message,
      });
    }
  }
);

/**
 * GET /api/services/:name/backups
 * List this app's local backup archives, newest first.
 */
router.get(
  '/:name/backups',
  serviceLimiter,
  auth,
  requireCapability('backups:manage'),
  validateParams(schemas.serviceNameParam),
  validateServiceAllowlist,
  async (req: Request, res: Response) => {
    try {
      return res.json({ items: await appBackup.listAppBackups(req.params.name) });
    } catch (error) {
      logger.error(`Listing per-app backups failed: ${req.params.name}`, { error: (error as Error).message });
      return res.status(500).json({ error: 'Unable to list backups for this app.' });
    }
  }
);

/**
 * GET /api/services/:name/backups/:file
 * Download one archive.
 */
router.get(
  '/:name/backups/:file',
  serviceLimiter,
  auth,
  requireCapability('backups:manage'),
  validateParams(schemas.serviceBackupFileParams),
  validateServiceAllowlist,
  async (req: Request, res: Response) => {
    const { name, file } = req.params;
    let archivePath: string;
    try {
      archivePath = appBackup.resolveAppBackupPath(name, file);
    } catch {
      return res.status(400).json({ error: 'Invalid backup name.' });
    }
    try {
      await fs.access(archivePath);
    } catch {
      return res.status(404).json({ error: 'Backup file not found.' });
    }
    return res.download(archivePath, file);
  }
);

/**
 * DELETE /api/services/:name/backups/:file
 * Delete one archive and its manifest sidecar.
 */
router.delete(
  '/:name/backups/:file',
  serviceLimiter,
  auth,
  requireCapability('backups:manage'),
  validateParams(schemas.serviceBackupFileParams),
  validateServiceAllowlist,
  async (req: Request, res: Response) => {
    const { name, file } = req.params;
    const userId = req.user!.id;
    try {
      await appBackup.deleteAppBackup(name, file);
      await writeAuditLog({
        userId,
        action: 'backup_delete',
        resource: name,
        result: 'success',
        metadata: { file },
      }).catch(() => {});
      return res.json({ success: true, service: name, file, message: 'Backup deleted.' });
    } catch (error) {
      const message = (error as Error).message;
      if (/Invalid backup/.test(message)) {
        return res.status(400).json({ error: 'Invalid backup name.' });
      }
      logger.error(`Deleting a per-app backup failed: ${name}`, { userId, error: message });
      return res.status(500).json({ error: 'Unable to delete the backup.' });
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
      // A `lanOnly` app (Samba) publishes a port but serves a non-HTTP
      // protocol the tunnel/NPM path can't carry — never exposable, whatever
      // the compose file publishes.
      const exposable =
        !getService(req.params.name)?.lanOnly && getPublishedUpstreamPort(req.params.name) !== null;

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

      // The set of Authelia-gated apps may have changed (enabled/disabled, or
      // the authelia flag toggled) — regenerate its access-control rules and
      // restart it if they moved (plan.md §151 slice 2d).
      const autheliaWarning = await syncAutheliaAccessControlSafe('exposure_change', req.user!.id);

      return res.json({
        message: turnedOff
          ? 'Exposure disabled and public hostnames removed.'
          : 'Exposure configuration saved. Restart the service to apply it.',
        enabled: row.enabled,
        hostname: row.hostname,
        ...(autheliaWarning ? { warning: autheliaWarning } : {}),
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
