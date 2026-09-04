/**
 * Service executor
 * Handles asynchronous Docker Compose operations for service start/stop.
 * Uses child_process to execute shell commands safely.
 */

import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';
import { writeAuditLog } from '../utils/audit';
import { provisionServiceIfEnabled } from './exposure';
import { buildExposureEnvOverrides } from './exposureEnv';
import { buildMailEnvOverrides } from './mailEnv';
import { ensureGeneratedSecrets } from './appEnv';
import { getAppTimezone } from '../utils/generalSettings';
import { applyExposureConfigFiles } from './exposureConfigFiles';
import { applyKitchenConfig } from './kitchenConfig';
import { applySambaConfig } from './sambaConfig';
import { checkServiceImages, recordImageCheck, pickLocalDigest, parseImageRef } from './imageUpdates';
import { clearImagePins, writeImagePins } from './composeOverride';
import { withMaintenanceLock } from './maintenanceLock';
import { ensureHomeAssistantHacs } from './homeAssistantHacs';
import { reconcileNextcloudOnlyOffice } from './nextcloudOnlyOffice';
import { reconcileNextcloudClamav } from './nextcloudClamav';
import { applyCrowdsecConfigFiles } from './crowdsecConfig';
import { applyHomepageConfig, regenerateHomepageServices } from './homepageConfig';
import { applyN8nWorkflows } from './n8nWorkflows';
import { extractComposeEnvVars, getService, isValidServiceName, resolveComposeFile } from '../config/services';
import { parseEnvFile } from '../utils/envFile';
import { getServiceStatus } from './status';
import { HttpError } from '../types';

/**
 * Refuse to start a service whose declared dependsOn services aren't already
 * running — e.g. an app that authenticates against Authelia's OIDC provider
 * would otherwise start into a broken/crash-looping state.
 */
async function assertDependenciesRunning(serviceName: string): Promise<void> {
  const dependsOn = getService(serviceName)?.dependsOn ?? [];
  if (!dependsOn.length) {
    return;
  }

  const statuses = await Promise.all(dependsOn.map((dep) => getServiceStatus(dep)));
  const notRunning = statuses.filter((s) => s.state !== 'running').map((s) => s.label ?? s.name);

  if (notRunning.length) {
    throw {
      statusCode: 409,
      message: `Cannot start ${getService(serviceName)?.label ?? serviceName}: dependency not running — ${notRunning.join(', ')}.`,
    } as HttpError;
  }
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

// `docker compose up` has to cover a first-run image pull, which for a large
// multi-image app (Immich, Jellyfin, …) is minutes, not seconds. `compose
// down` / `restart` don't pull, so they keep the short default.
const COMPOSE_UP_TIMEOUT_MS = 15 * 60_000;
// A full pull streams a lot of progress text to stdout; the default 1MB
// exec buffer overflows and kills the command mid-pull.
const COMMAND_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * Execute a shell command with timeout and error handling. Extra env vars
 * are merged over process.env — Docker Compose prefers the shell environment
 * over the .env file for `${VAR}` substitution, so this can override
 * per-start computed values (e.g. a service's public hostname) without
 * having to persist them to that service's .env file.
 */
function executeCommand(command: string, timeout = 30000, extraEnv: Record<string, string> = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    exec(command, { timeout, maxBuffer: COMMAND_MAX_BUFFER, env: { ...process.env, ...extraEnv } }, (error, stdout, stderr) => {
      if (error) {
        reject({
          code: error.code,
          signal: error.signal,
          message: error.message,
          stderr: stderr || '',
          stdout: stdout || '',
        } as HttpError);
      } else {
        resolve({
          stdout: stdout || '',
          stderr: stderr || '',
        });
      }
    });
  });
}

/**
 * The global timezone as a `TZ` env override for `docker compose up`. A per-app
 * `TZ` in the app's own .env wins — but only when it differs from the global
 * value, so the config panel prefilling `TZ` with the global (and the user
 * saving it) doesn't sever the "follows Settings" link. Apps that don't read
 * ${TZ} just get a harmless unused var.
 */
async function resolveTimezoneOverride(appDir: string): Promise<Record<string, string>> {
  const globalTimezone = await getAppTimezone();
  const envFilePath = path.join(appDir, '.env');
  const pinned = fs.existsSync(envFilePath) ? parseEnvFile(envFilePath).TZ?.trim() : '';
  if (pinned && pinned !== globalTimezone) {
    return {};
  }
  return { TZ: globalTimezone };
}

/**
 * Create any docker network this service's compose file declares as
 * `external: true`, if it isn't there yet.
 *
 * Compose refuses to start a project whose external network is missing
 * ("network X declared as external, but could not be found"), and the entire
 * point of an external network here is that two compose projects share one —
 * so neither project can be the one that creates it. That leaves the backend,
 * which is also the only place it can happen without a console step (§0.2).
 * Names come from the registry, never from a request.
 *
 * Best-effort: if creation fails, compose's own error is the clearer one to
 * surface, so this logs and lets the start proceed to it.
 */
async function ensureExternalNetworks(serviceName: string): Promise<void> {
  for (const network of getService(serviceName)?.externalNetworks ?? []) {
    try {
      const { stdout } = await executeCommand(
        `docker network ls --filter name=^${network}$ --format "{{.Name}}"`
      );
      if (stdout.split('\n').some((line) => line.trim() === network)) {
        continue;
      }
      await executeCommand(`docker network create ${network}`);
      logger.info(`Created external docker network ${network} for ${serviceName}`, { service: serviceName });
    } catch (error) {
      logger.warn(`Could not ensure external docker network ${network} for ${serviceName}`, {
        service: serviceName,
        error: (error as Error).message,
      });
    }
  }
}

/**
 * `docker compose up -d` for a service with every piece of managed config
 * re-applied first: generatable secrets, the exposure env overrides + config
 * files (Host/CSRF/URL knobs derived from the public hostname), CrowdSec's
 * rendered config, and the global timezone. Shared by start and restart so a
 * "restart to apply" after toggling exposure actually recreates the container
 * with the new values (a plain `docker compose restart` never re-substitutes
 * `${VAR}`, which is why it didn't).
 */
async function composeUpWithManagedConfig(
  serviceName: string,
  projectName: string | null,
  appDir: string,
  // The `-f` flags (base compose + managed override), not just the base file,
  // so a recreate honours the image pins the Update button wrote.
  composeArgs: string,
  { forceRecreate }: { forceRecreate: boolean }
): Promise<CommandResult> {
  // Before anything else: a missing external network fails `compose up`
  // outright, so there is no point rendering config for a start that can't
  // happen.
  await ensureExternalNetworks(serviceName);

  const envOverrides = await buildExposureEnvOverrides(serviceName, appDir);
  // Mail settings are global and injected the same way — one mailbox
  // configured once, inherited by every app that declares mailEnvKeys.
  const mailOverrides = await buildMailEnvOverrides(serviceName);
  await applyExposureConfigFiles(serviceName, appDir);
  await applyCrowdsecConfigFiles(serviceName, appDir);
  // The Kitchen switcher embeds its siblings, so it needs their URLs — which
  // only the dashboard knows (exposure state + allocated ports).
  await applyKitchenConfig(serviceName, appDir);
  // Samba: render the share's smb.conf before the app comes up. Unlike the
  // Kitchen config this is load-bearing — a missing data/smb.conf makes
  // Docker create the bind source as a directory and the entrypoint aborts.
  await applySambaConfig(serviceName, appDir);
  // HACS: the appliance integrations this house needs (HomeWhiz, Ariston) only
  // exist as HACS repositories, and apps/*/data/ is gitignored, so a fresh
  // clone has to be able to get there without a console step (§0.2).
  await ensureHomeAssistantHacs(serviceName);
  // The Home Page's own start: disable label auto-discovery and clear the
  // stock demo bookmarks before it comes up (§114). services.yaml is filled
  // in by regenerateHomepageServices once the start completes.
  await applyHomepageConfig(serviceName, appDir);
  // n8n: render the dashboard-managed workflow files before the app comes up,
  // so the n8n-workflows-init container imports the current version (§118.3).
  await applyN8nWorkflows(serviceName, appDir);

  const recreate = forceRecreate ? ' --force-recreate' : '';
  const command = `docker compose -p ${projectName} ${composeArgs} up -d${recreate}`;
  const result = await executeCommand(command, COMPOSE_UP_TIMEOUT_MS, {
    ...(await resolveTimezoneOverride(appDir)),
    ...mailOverrides,
    // Exposure last: if a service somehow named the same var in both, the
    // hostname-derived value is the more specific one.
    ...envOverrides,
  });

  // Nextcloud roster wiring via `occ`. After `up`, not before — unlike HACS
  // these need the app's own database, which is only up once the container is
  // (§81.4/§81.7). Both no-op for every other service.
  await reconcileNextcloudOnlyOffice(serviceName);
  await reconcileNextcloudClamav(serviceName);

  return result;
}

function requiredSecretsFromCompose(composeFilePath: string): string[] {
  const composeContent = fs.readFileSync(composeFilePath, 'utf8');
  return extractComposeEnvVars(composeContent)
    .filter((envVar) => envVar.required)
    .map((envVar) => envVar.key);
}

function ensureServiceSecrets(serviceName: string, appDir: string, composeFile: string): void {
  const envFilePath = path.join(appDir, '.env');
  const requiredSecrets = requiredSecretsFromCompose(composeFile).filter((name) => !name.includes(':-'));

  if (!requiredSecrets.length) {
    return;
  }

  if (!fs.existsSync(envFilePath)) {
    throw {
      statusCode: 400,
      message: `Service ${serviceName} is missing ${envFilePath}. Copy .env.example to .env and set required values.`,
      details: `Missing .env for ${serviceName}`,
    } as HttpError;
  }

  const envValues = parseEnvFile(envFilePath);
  const missing = requiredSecrets.filter((key) => {
    const value = envValues[key];
    return value === undefined || value === '';
  });

  if (missing.length) {
    throw {
      statusCode: 400,
      message: `Service ${serviceName} has missing required secrets in .env`,
      details: `Unset keys: ${missing.join(', ')}`,
    } as HttpError;
  }
}

interface ServiceActionResult {
  success: boolean;
  service: string;
  message: string;
  timestamp: Date;
  exposure?: unknown;
}

/**
 * Start a service using docker compose up
 */
export async function startService(serviceName: string, userId: number): Promise<ServiceActionResult> {
  if (!isValidServiceName(serviceName)) {
    throw {
      statusCode: 400,
      message: `Invalid service name: ${serviceName}`,
    } as HttpError;
  }

  const resolved = resolveComposeFile(serviceName);
  const { projectName, appDir, composeFile, composeArgs } = resolved ?? {
    projectName: null,
    appDir: '',
    composeFile: null,
    composeArgs: '',
  };

  if (!composeFile) {
    throw {
      statusCode: 404,
      message: `Service ${serviceName} is not installed: no compose file found in ${appDir}`,
    } as HttpError;
  }

  // Generate any declared secret that's still a placeholder before validating,
  // so an app whose only outstanding config is generatable secrets starts with
  // no dashboard step (project principle §0.3).
  await ensureGeneratedSecrets(serviceName);
  ensureServiceSecrets(serviceName, appDir, composeFile);
  await assertDependenciesRunning(serviceName);

  try {
    const startTime = new Date();
    logger.info(`Starting service: ${serviceName}`, { userId, service: serviceName });

    // Keep the app's own reverse-proxy config in step with its exposed
    // hostname before it (re)starts: env overrides for most apps, a config
    // file for the few that need it (Home Assistant).
    const result = await composeUpWithManagedConfig(serviceName, projectName, appDir, composeArgs, {
      forceRecreate: false,
    });

    // Log the successful operation
    await logAuditEvent(userId, 'SERVICE_START', serviceName, 'success', {
      stdout: result.stdout,
      stderr: result.stderr,
      duration: new Date().getTime() - startTime.getTime(),
    });

    logger.info(`Service started successfully: ${serviceName}`, { userId });

    const exposure = await provisionServiceIfEnabled(serviceName, userId).catch((error: Error) => {
      logger.error(`Unexpected exposure provisioning error for ${serviceName}`, { error: error.message });
      return { attempted: true, success: false, warning: 'Exposure provisioning failed unexpectedly.' };
    });

    // A newly-started (and exposed) app gets a Home Page tile; a newly-exposed
    // one changes its link. Regenerate after provisioning so the tile reflects
    // the just-settled state. Best-effort inside the helper.
    await regenerateHomepageServices();

    return {
      success: true,
      service: serviceName,
      message: `Service ${serviceName} started successfully`,
      timestamp: new Date(),
      ...(exposure.attempted ? { exposure } : {}),
    };
  } catch (error) {
    const httpError = error as HttpError;
    logger.error(`Failed to start service: ${serviceName}`, {
      userId,
      error: httpError.message,
      stderr: httpError.stderr,
    });

    // Log the failed operation
    await logAuditEvent(userId, 'SERVICE_START', serviceName, 'failure', {
      error: httpError.message,
      stderr: httpError.stderr,
      code: httpError.code,
    }).catch((err: Error) => logger.error('Failed to log audit event', { error: err.message }));

    throw {
      statusCode: 500,
      message: `Failed to start service ${serviceName}: ${httpError.message}`,
      details: httpError.stderr,
    } as HttpError;
  }
}

/**
 * Stop a service using docker compose down
 */
/**
 * Pull newer images for a service and recreate it on them.
 *
 * This is what replaced Watchtower (§81.3). Watchtower did the same thing
 * unattended, to every container that had not opted out — which is why the
 * management stack carries four `com.centurylinklabs.watchtower.enable=false`
 * labels. Recreating an app while someone is using it, on an image whose
 * changes nobody has read, is a decision rather than a background chore; it
 * belongs on a button.
 *
 * Image IDs before and after say whether anything actually changed.
 * Recreation goes through composeUpWithManagedConfig like every other start,
 * so the exposure env overrides and managed config files are re-applied to the
 * new container.
 *
 * Two things happen around the pull:
 *  - It runs under the shared maintenance lock (maintenanceLock.ts) so a
 *    recreate can't land mid-backup-dump (§103, extended to updates).
 *  - Afterwards the digest of each image it pulled is pinned into the
 *    dashboard-managed `docker-compose.override.yml` (composeOverride.ts), so a
 *    fresh clone recreates the same containers instead of whatever the tags
 *    point at that day. The pins are cleared first, so the pull always fetches
 *    the tags in the base compose file rather than re-fetching a pinned digest.
 */
export async function updateService(serviceName: string, userId: number): Promise<ServiceActionResult> {
  if (!isValidServiceName(serviceName)) {
    throw { statusCode: 400, message: `Invalid service name: ${serviceName}` } as HttpError;
  }

  const resolved = resolveComposeFile(serviceName);
  const { projectName, appDir, composeFile, composeArgs } = resolved ?? {
    projectName: null,
    appDir: '',
    composeFile: null,
    composeArgs: '',
  };

  if (!composeFile) {
    throw {
      statusCode: 404,
      message: `Service ${serviceName} is not installed: no compose file found in ${appDir}`,
    } as HttpError;
  }

  await ensureGeneratedSecrets(serviceName);
  ensureServiceSecrets(serviceName, appDir, composeFile);

  // The pull recreates against the base compose tags, not the current pins.
  const baseArgs = `-f ${composeFile}`;
  const startTime = new Date();
  try {
    const updated = await withMaintenanceLock(`update:${serviceName}`, async () => {
      logger.info(`Updating service: ${serviceName}`, { userId, service: serviceName });

      const before = await getServiceImageIds(projectName, composeArgs);
      clearImagePins(appDir);
      await executeCommand(`docker compose -p ${projectName} ${baseArgs} pull`, COMPOSE_UP_TIMEOUT_MS);

      // forceRecreate: `up -d` alone leaves a running container on its old image
      // when the compose config has not changed, so the pull would look like it
      // did nothing.
      await composeUpWithManagedConfig(serviceName, projectName, appDir, baseArgs, {
        forceRecreate: true,
      });
      const after = await getServiceImageIds(projectName, baseArgs);

      // Pin whatever was just pulled so it survives a fresh clone.
      await pinPulledImages(serviceName, projectName, appDir, composeFile);

      // Compared by container, since a multi-container app can move one image
      // and not the others. Either side missing means "cannot tell".
      return before && after
        ? [
            ...new Set(
              [...after.entries()]
                .filter(([container, image]) => before.get(container)?.id !== image.id)
                .map(([, image]) => image.name)
            ),
          ]
        : null;
    });

    // The cached "out of date" answer is stale the moment this succeeds, and
    // leaving the button red after a successful update reads as a failure.
    await checkServiceImages(serviceName)
      .then((check) => recordImageCheck(serviceName, check))
      .catch((error: Error) => logger.warn('Could not refresh the update check', { serviceName, error: error.message }));

    await logAuditEvent(userId, 'SERVICE_UPDATE', serviceName, 'success', {
      updated: updated ?? 'unknown',
      duration: new Date().getTime() - startTime.getTime(),
    });
    logger.info(`Service updated: ${serviceName}`, { userId, updated });

    const exposure = await provisionServiceIfEnabled(serviceName, userId).catch((error: Error) => {
      logger.error(`Unexpected exposure provisioning error for ${serviceName}`, { error: error.message });
      return { attempted: true, success: false, warning: 'Exposure provisioning failed unexpectedly.' };
    });

    return {
      success: true,
      service: serviceName,
      message: describeUpdate(updated),
      timestamp: new Date(),
      ...(exposure.attempted ? { exposure } : {}),
    };
  } catch (error) {
    const httpError = error as HttpError;
    logger.error(`Failed to update service: ${serviceName}`, { userId, error: httpError.message });
    await logAuditEvent(userId, 'SERVICE_UPDATE', serviceName, 'failure', {
      error: httpError.message,
      stderr: httpError.stderr,
    }).catch((err: Error) => logger.error('Failed to log audit event', { error: err.message }));

    throw {
      statusCode: 500,
      message: `Failed to update service ${serviceName}: ${httpError.message}`,
      details: httpError.stderr,
    } as HttpError;
  }
}

export function describeUpdate(updated: string[] | null): string {
  // null, not empty: the image IDs could not be read, so "nothing changed" is
  // not a claim this can make. Saying it anyway is the one outcome that would
  // quietly turn a failed update into a success message.
  if (updated === null) {
    return 'Pulled and recreated. Could not tell which images changed.';
  }
  if (!updated.length) {
    return 'Already on the latest images.';
  }
  return `Updated ${updated.length} image${updated.length === 1 ? '' : 's'}: ${updated.join(', ')}`;
}

/**
 * Parse `docker compose images --format json` into image -> image ID.
 *
 * Not `docker ps --format {{.ImageID}}`: that field does not exist on
 * `docker ps` (it is a `docker images` field), so the template fails, the
 * command errors, and every update reports "already on the latest images"
 * however much it just pulled. Found live — the first update this ran said
 * nothing had changed while recreating the container.
 */
export interface ComposeImage {
  // Image ID, which is what actually changes when a pull brings something new.
  id: string;
  // repository:tag, which is what a person recognises in the result message.
  name: string;
}

export function parseComposeImages(stdout: string): Map<string, ComposeImage> | null {
  try {
    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed)) {
      return null;
    }
    // Keyed by container: a multi-container app can move one image and not the
    // others, and two of its containers can share one image.
    const entries = parsed
      .filter((row) => row && typeof row.ContainerName === 'string' && typeof row.ID === 'string')
      .map((row): [string, ComposeImage] => [
        row.ContainerName,
        { id: row.ID, name: row.Tag ? `${row.Repository}:${row.Tag}` : String(row.Repository ?? row.ContainerName) },
      ]);
    return entries.length ? new Map(entries) : null;
  } catch {
    return null;
  }
}

/**
 * container -> image ID for a project, so an update can say what actually
 * changed rather than reporting success for a no-op pull. Returns null when
 * that cannot be established, which describeUpdate reports honestly instead of
 * turning into "nothing changed".
 */
async function getServiceImageIds(
  projectName: string | null,
  composeArgs: string
): Promise<Map<string, ComposeImage> | null> {
  if (!projectName) {
    return null;
  }
  try {
    const { stdout } = await executeCommand(
      `docker compose -p ${projectName} ${composeArgs} images --format json`,
      30_000
    );
    return parseComposeImages(stdout);
  } catch {
    return null;
  }
}

/**
 * After a pull + recreate, record the exact digest of each image compose now
 * resolves for the service into the managed override file, so the next fresh
 * clone lands on the same images. Best-effort: a service whose digest can't be
 * read is left unpinned (it just floats on its tag, as before this existed).
 * Images built locally (`build:`) and refs already pinned to a digest in the
 * base compose file are skipped.
 */
async function pinPulledImages(
  serviceName: string,
  projectName: string | null,
  appDir: string,
  composeFile: string
): Promise<void> {
  if (!projectName) {
    return;
  }
  let config: { services?: Record<string, { image?: unknown; build?: unknown }> };
  try {
    const { stdout } = await executeCommand(
      `docker compose -p ${projectName} -f ${composeFile} config --format json`,
      30_000
    );
    config = JSON.parse(stdout);
  } catch (error) {
    logger.warn('Could not read compose config to pin images', { serviceName, error: (error as Error).message });
    return;
  }

  const pins = new Map<string, string | null>();
  for (const [composeService, def] of Object.entries(config.services ?? {})) {
    if (!def || typeof def.image !== 'string' || def.build) {
      continue;
    }
    const ref = parseImageRef(def.image);
    if (!ref || ref.pinned) {
      continue;
    }
    let repoDigests: string[] = [];
    try {
      const { stdout } = await executeCommand(
        `docker image inspect ${def.image} --format '{{json .RepoDigests}}'`,
        15_000
      );
      repoDigests = JSON.parse(stdout);
    } catch {
      continue;
    }
    const digest = pickLocalDigest(repoDigests, ref.repository);
    if (digest) {
      pins.set(composeService, `${def.image}@${digest}`);
    }
  }

  if (pins.size) {
    writeImagePins(appDir, pins);
  }
}

export async function stopService(serviceName: string, userId: number): Promise<ServiceActionResult> {
  if (!isValidServiceName(serviceName)) {
    throw {
      statusCode: 400,
      message: `Invalid service name: ${serviceName}`,
    } as HttpError;
  }

  const resolved = resolveComposeFile(serviceName);
  const { projectName, appDir, composeFile, composeArgs } = resolved ?? {
    projectName: null,
    appDir: '',
    composeFile: null,
    composeArgs: '',
  };

  if (!composeFile) {
    throw {
      statusCode: 404,
      message: `Service ${serviceName} is not installed: no compose file found in ${appDir}`,
    } as HttpError;
  }

  ensureServiceSecrets(serviceName, appDir, composeFile);

  try {
    const startTime = new Date();
    logger.info(`Stopping service: ${serviceName}`, { userId, service: serviceName });

    // Execute docker compose down
    const command = `docker compose -p ${projectName} ${composeArgs} down`;
    const result = await executeCommand(command, 60000); // 60s timeout for shutdown

    // Log the successful operation
    await logAuditEvent(userId, 'SERVICE_STOP', serviceName, 'success', {
      stdout: result.stdout,
      stderr: result.stderr,
      duration: new Date().getTime() - startTime.getTime(),
    });

    logger.info(`Service stopped successfully: ${serviceName}`, { userId });

    // A stopped app drops off the Home Page (a tile is only written for a
    // running, exposed one). Best-effort inside the helper.
    await regenerateHomepageServices();

    return {
      success: true,
      service: serviceName,
      message: `Service ${serviceName} stopped successfully`,
      timestamp: new Date(),
    };
  } catch (error) {
    const httpError = error as HttpError;
    logger.error(`Failed to stop service: ${serviceName}`, {
      userId,
      error: httpError.message,
      stderr: httpError.stderr,
    });

    // Log the failed operation
    await logAuditEvent(userId, 'SERVICE_STOP', serviceName, 'failure', {
      error: httpError.message,
      stderr: httpError.stderr,
      code: httpError.code,
    }).catch((err: Error) => logger.error('Failed to log audit event', { error: err.message }));

    throw {
      statusCode: 500,
      message: `Failed to stop service ${serviceName}: ${httpError.message}`,
      details: httpError.stderr,
    } as HttpError;
  }
}

/**
 * Restart a service so it picks up config changes — bind-mounted files (e.g.
 * Authelia's users_database.yml), the exposure-derived env vars (Vaultwarden's
 * DOMAIN, n8n's N8N_HOST, …), and the global timezone. Recreates the container
 * (`up -d --force-recreate`) rather than `docker compose restart`, because a
 * bare restart never re-substitutes `${VAR}`, so a "restart to apply" after
 * enabling exposure would otherwise keep the old localhost values. A no-op —
 * reported as success — when the service isn't currently running.
 */
export async function restartService(serviceName: string, userId: number): Promise<ServiceActionResult> {
  if (!isValidServiceName(serviceName)) {
    throw {
      statusCode: 400,
      message: `Invalid service name: ${serviceName}`,
    } as HttpError;
  }

  const resolved = resolveComposeFile(serviceName);
  const { projectName, appDir, composeFile, composeArgs } = resolved ?? {
    projectName: null,
    appDir: '',
    composeFile: null,
    composeArgs: '',
  };

  if (!composeFile) {
    throw {
      statusCode: 404,
      message: `Service ${serviceName} is not installed: no compose file found in ${appDir}`,
    } as HttpError;
  }

  const currentStatus = await getServiceStatus(serviceName);
  if (currentStatus.state !== 'running') {
    return {
      success: true,
      service: serviceName,
      message: `Service ${serviceName} is not currently running — the change will apply on next start.`,
      timestamp: new Date(),
    };
  }

  // Same as start: a secret this service has only just declared — because the
  // registry gained one, as CrowdSec did with the NPM bouncer key (§119) —
  // has to materialise here too. A restart is exactly what an operator does
  // after changing something in the dashboard, and without this the app comes
  // back up with the new variable substituted to an empty string.
  await ensureGeneratedSecrets(serviceName);

  try {
    logger.info(`Restarting service: ${serviceName}`, { userId, service: serviceName });

    const result = await composeUpWithManagedConfig(serviceName, projectName, appDir, composeArgs, {
      forceRecreate: true,
    });

    await logAuditEvent(userId, 'SERVICE_RESTART', serviceName, 'success', {
      stdout: result.stdout,
      stderr: result.stderr,
    });

    logger.info(`Service restarted successfully: ${serviceName}`, { userId });

    return {
      success: true,
      service: serviceName,
      message: `Service ${serviceName} restarted to apply the change.`,
      timestamp: new Date(),
    };
  } catch (error) {
    const httpError = error as HttpError;
    logger.error(`Failed to restart service: ${serviceName}`, {
      userId,
      error: httpError.message,
      stderr: httpError.stderr,
    });

    await logAuditEvent(userId, 'SERVICE_RESTART', serviceName, 'failure', {
      error: httpError.message,
      stderr: httpError.stderr,
      code: httpError.code,
    }).catch((err: Error) => logger.error('Failed to log audit event', { error: err.message }));

    throw {
      statusCode: 500,
      message: `Failed to restart service ${serviceName}: ${httpError.message}`,
      details: httpError.stderr,
    } as HttpError;
  }
}

/**
 * Log an audit event to the database
 */
export async function logAuditEvent(
  userId: number,
  action: string,
  resource: string,
  result: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    await writeAuditLog({
      userId,
      action,
      resource,
      result,
      metadata,
    });
  } catch (error) {
    // Don't throw; audit logging is non-critical
    logger.error('Failed to write audit log', {
      error: (error as Error).message,
      userId,
      action,
      resource,
    });
  }
}
