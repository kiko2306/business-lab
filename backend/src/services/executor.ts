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
import { provisionServiceIfEnabled, getServiceExposureRow } from './exposure';
import { getExposureConfig } from '../utils/exposureSettings';
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

/**
 * Execute a shell command with timeout and error handling. Extra env vars
 * are merged over process.env — Docker Compose prefers the shell environment
 * over the .env file for `${VAR}` substitution, so this can override
 * per-start computed values (e.g. a service's public hostname) without
 * having to persist them to that service's .env file.
 */
function executeCommand(command: string, timeout = 30000, extraEnv: Record<string, string> = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    exec(command, { timeout, env: { ...process.env, ...extraEnv } }, (error, stdout, stderr) => {
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

/**
 * Compute PAPERLESS_URL/PAPERLESS_ALLOWED_HOSTS-style env overrides (per
 * ServiceDefinition.exposureEnvKeys) so a service's own Host-header/CSRF
 * checks stay in sync with its exposed public hostname automatically,
 * without writing to the app's .env file.
 */
async function buildExposureEnvOverrides(serviceName: string, appDir: string): Promise<Record<string, string>> {
  const exposureEnvKeys = getService(serviceName)?.exposureEnvKeys;
  if (!exposureEnvKeys) {
    return {};
  }

  const exposureRow = await getServiceExposureRow(serviceName);
  if (!exposureRow?.enabled) {
    return {};
  }

  const globalConfig = await getExposureConfig();
  if (!globalConfig) {
    return {};
  }

  const hostname = `${serviceName}.${globalConfig.baseDomain}`;
  const envFilePath = path.join(appDir, '.env');
  const existingValues = fs.existsSync(envFilePath) ? parseEnvFile(envFilePath) : {};

  const overrides: Record<string, string> = {};

  for (const key of exposureEnvKeys.url ?? []) {
    overrides[key] = `https://${hostname}`;
  }

  for (const key of exposureEnvKeys.allowedHosts ?? []) {
    const hosts = (existingValues[key] ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean);
    if (!hosts.includes(hostname)) {
      hosts.push(hostname);
    }
    overrides[key] = hosts.join(',');
  }

  return overrides;
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
  const { projectName, appDir, composeFile } = resolved ?? { projectName: null, appDir: '', composeFile: null };

  if (!composeFile) {
    throw {
      statusCode: 404,
      message: `Service ${serviceName} is not installed: no compose file found in ${appDir}`,
    } as HttpError;
  }

  ensureServiceSecrets(serviceName, appDir, composeFile);
  await assertDependenciesRunning(serviceName);

  try {
    const startTime = new Date();
    logger.info(`Starting service: ${serviceName}`, { userId, service: serviceName });

    // Execute docker compose up -d
    const envOverrides = await buildExposureEnvOverrides(serviceName, appDir);
    const command = `docker compose -p ${projectName} -f ${composeFile} up -d`;
    const result = await executeCommand(command, 60000, envOverrides); // 60s timeout for startup

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
export async function stopService(serviceName: string, userId: number): Promise<ServiceActionResult> {
  if (!isValidServiceName(serviceName)) {
    throw {
      statusCode: 400,
      message: `Invalid service name: ${serviceName}`,
    } as HttpError;
  }

  const resolved = resolveComposeFile(serviceName);
  const { projectName, appDir, composeFile } = resolved ?? { projectName: null, appDir: '', composeFile: null };

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
    const command = `docker compose -p ${projectName} -f ${composeFile} down`;
    const result = await executeCommand(command, 60000); // 60s timeout for shutdown

    // Log the successful operation
    await logAuditEvent(userId, 'SERVICE_STOP', serviceName, 'success', {
      stdout: result.stdout,
      stderr: result.stderr,
      duration: new Date().getTime() - startTime.getTime(),
    });

    logger.info(`Service stopped successfully: ${serviceName}`, { userId });

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
 * Restart a service so it re-reads its config/bind-mounted files (e.g.
 * Authelia's users_database.yml, only read at startup). A no-op — reported
 * as success — when the service isn't currently running, since there's
 * nothing to restart and the new config will simply apply on next start.
 */
export async function restartService(serviceName: string, userId: number): Promise<ServiceActionResult> {
  if (!isValidServiceName(serviceName)) {
    throw {
      statusCode: 400,
      message: `Invalid service name: ${serviceName}`,
    } as HttpError;
  }

  const resolved = resolveComposeFile(serviceName);
  const { projectName, appDir, composeFile } = resolved ?? { projectName: null, appDir: '', composeFile: null };

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

  try {
    logger.info(`Restarting service: ${serviceName}`, { userId, service: serviceName });

    const command = `docker compose -p ${projectName} -f ${composeFile} restart`;
    const result = await executeCommand(command, 60000);

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
