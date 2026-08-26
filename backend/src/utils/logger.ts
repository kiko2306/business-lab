/**
 * Structured logging utility
 * Provides consistent logging across the application.
 */

import fs from 'fs';
import path from 'path';

type LogMetadata = Record<string, unknown>;

const LOG_DIR = path.join(process.cwd(), 'logs');

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getTimestamp(): string {
  return new Date().toISOString();
}

function formatLog(level: string, message: string, metadata: LogMetadata = {}): string {
  return JSON.stringify({
    timestamp: getTimestamp(),
    level,
    message,
    ...metadata,
  });
}

function writeLog(level: string, message: string, metadata?: LogMetadata): void {
  const logEntry = formatLog(level, message, metadata);
  console.log(logEntry);

  // Write to file
  const logFile = path.join(LOG_DIR, `${level}.log`);
  fs.appendFileSync(logFile, logEntry + '\n');
}

export const logger = {
  debug: (message: string, metadata?: LogMetadata) => writeLog('debug', message, metadata),
  info: (message: string, metadata?: LogMetadata) => writeLog('info', message, metadata),
  warn: (message: string, metadata?: LogMetadata) => writeLog('warn', message, metadata),
  error: (message: string, metadata?: LogMetadata) => writeLog('error', message, metadata),
};

export default logger;
