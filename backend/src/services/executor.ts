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
import { isValidServiceName, resolveComposeFile } from '../config/services';
import { HttpError } from '../types';

interface CommandResult {
  stdout: string;
  stderr: string;
}

/**
 * Execute a shell command with timeout and error handling
 */
function executeCommand(command: string, timeout = 30000): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    exec(command, { timeout }, (error, stdout, stderr) => {
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
  const matches = composeContent.match(/\$\{([A-Z0-9_]+)\}/g) || [];
  return [...new Set(matches.map((token) => token.slice(2, -1)))];
}

function parseEnvFile(envFilePath: string): Record<string, string> {
  const envContent = fs.readFileSync(envFilePath, 'utf8');
  const lines = envContent.split(/\r?\n/);
  const values: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    values[key] = value;
  }

  return values;
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
    logger.info(`Starting service: ${serviceName}`, { userId, service: serviceName });

    // Execute docker compose up -d
    const command = `docker compose -p ${projectName} -f ${composeFile} up -d`;
    const result = await executeCommand(command, 60000); // 60s timeout for startup

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
