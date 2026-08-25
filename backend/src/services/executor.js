/**
 * Service executor
 * Handles asynchronous Docker Compose operations for service start/stop.
 * Uses child_process to execute shell commands safely.
 */

const { exec } = require('child_process');
const logger = require('../utils/logger');
const { writeAuditLog } = require('../utils/audit');

/**
 * Execute a shell command with timeout and error handling
 */
function executeCommand(command, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const process = exec(command, { timeout }, (error, stdout, stderr) => {
      if (error) {
        reject({
          code: error.code,
          signal: error.signal,
          message: error.message,
          stderr: stderr || '',
          stdout: stdout || '',
        });
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
 * Start a service using docker compose up
 */
async function startService(serviceName, userId) {
  const { isValidServiceName, resolveComposeFile } = require('../config/services');

  if (!isValidServiceName(serviceName)) {
    throw {
      statusCode: 400,
      message: `Invalid service name: ${serviceName}`,
    };
  }

  const { projectName, appDir, composeFile } = resolveComposeFile(serviceName);

  if (!composeFile) {
    throw {
      statusCode: 404,
      message: `Service ${serviceName} is not installed: no compose file found in ${appDir}`,
    };
  }

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
      duration: new Date() - startTime,
    });

    logger.info(`Service started successfully: ${serviceName}`, { userId });

    return {
      success: true,
      service: serviceName,
      message: `Service ${serviceName} started successfully`,
      timestamp: new Date(),
    };
  } catch (error) {
    logger.error(`Failed to start service: ${serviceName}`, {
      userId,
      error: error.message,
      stderr: error.stderr,
    });

    // Log the failed operation
    await logAuditEvent(userId, 'SERVICE_START', serviceName, 'failure', {
      error: error.message,
      stderr: error.stderr,
      code: error.code,
    }).catch(err => logger.error('Failed to log audit event', { error: err }));

    throw {
      statusCode: 500,
      message: `Failed to start service ${serviceName}: ${error.message}`,
      details: error.stderr,
    };
  }
}

/**
 * Stop a service using docker compose down
 */
async function stopService(serviceName, userId) {
  const { isValidServiceName, resolveComposeFile } = require('../config/services');

  if (!isValidServiceName(serviceName)) {
    throw {
      statusCode: 400,
      message: `Invalid service name: ${serviceName}`,
    };
  }

  const { projectName, appDir, composeFile } = resolveComposeFile(serviceName);

  if (!composeFile) {
    throw {
      statusCode: 404,
      message: `Service ${serviceName} is not installed: no compose file found in ${appDir}`,
    };
  }

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
      duration: new Date() - startTime,
    });

    logger.info(`Service stopped successfully: ${serviceName}`, { userId });

    return {
      success: true,
      service: serviceName,
      message: `Service ${serviceName} stopped successfully`,
      timestamp: new Date(),
    };
  } catch (error) {
    logger.error(`Failed to stop service: ${serviceName}`, {
      userId,
      error: error.message,
      stderr: error.stderr,
    });

    // Log the failed operation
    await logAuditEvent(userId, 'SERVICE_STOP', serviceName, 'failure', {
      error: error.message,
      stderr: error.stderr,
      code: error.code,
    }).catch(err => logger.error('Failed to log audit event', { error: err }));

    throw {
      statusCode: 500,
      message: `Failed to stop service ${serviceName}: ${error.message}`,
      details: error.stderr,
    };
  }
}

/**
 * Log an audit event to the database
 */
async function logAuditEvent(userId, action, resource, result, metadata = {}) {
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
      error: error.message,
      userId,
      action,
      resource,
    });
  }
}

module.exports = {
  startService,
  stopService,
  executeCommand,
  logAuditEvent,
};
