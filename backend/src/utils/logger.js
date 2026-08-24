/**
 * Structured logging utility
 * Provides consistent logging across the application.
 */

const fs = require('fs');
const path = require('path');

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_DIR = path.join(process.cwd(), 'logs');

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getTimestamp() {
  return new Date().toISOString();
}

function formatLog(level, message, metadata = {}) {
  return JSON.stringify({
    timestamp: getTimestamp(),
    level,
    message,
    ...metadata,
  });
}

function writeLog(level, message, metadata) {
  const logEntry = formatLog(level, message, metadata);
  console.log(logEntry);

  // Write to file
  const logFile = path.join(LOG_DIR, `${level}.log`);
  fs.appendFileSync(logFile, logEntry + '\n');
}

module.exports = {
  debug: (message, metadata) => writeLog('debug', message, metadata),
  info: (message, metadata) => writeLog('info', message, metadata),
  warn: (message, metadata) => writeLog('warn', message, metadata),
  error: (message, metadata) => writeLog('error', message, metadata),
};
