/**
 * Structured logging utility
 * Provides consistent logging across the application.
 */

import fs from 'fs';
import path from 'path';

type LogMetadata = Record<string, unknown>;

/**
 * Where log files land. Overridable so tests can point it at a disposable
 * directory; in the container it is `/app/logs`, which docker-compose.yml
 * mounts as a named volume.
 *
 * That mount is not cosmetic. These files used to live in the container's
 * writable layer, so recreating the backend destroyed them — and on
 * 2026-09-02 that erased the logs for the previous day and stopped two
 * separate investigations dead (plan.md §86.1, §88.4).
 */
const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');

/**
 * Rotate at this size, keeping one previous generation as `<level>.log.1`.
 *
 * Nothing rotated these files before, which was survivable only because they
 * died with the container every few days. Now that they outlive it, an error
 * loop — a crash-looping dependency, a healthcheck failing every 30 seconds —
 * would otherwise grow one file without limit.
 */
const MAX_LOG_BYTES = 5 * 1024 * 1024;

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Bytes written per file, tracked in memory: stat-ing on every line would be
 * a syscall per log entry for a number we already know. Seeded from disk on
 * the first write to each level, so a restart picks up where it left off
 * instead of resetting the count and overshooting the cap.
 */
const writtenBytes = new Map<string, number>();

function fileSize(file: string): number {
  const cached = writtenBytes.get(file);
  if (cached !== undefined) {
    return cached;
  }
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    /* first write to this level — the file does not exist yet */
  }
  writtenBytes.set(file, size);
  return size;
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

  const logFile = path.join(LOG_DIR, `${level}.log`);
  const line = `${logEntry}\n`;

  // Rotate *before* the append that would cross the cap, so the cap is a real
  // ceiling rather than a line the file sits above until something else is
  // logged.
  if (fileSize(logFile) + line.length > MAX_LOG_BYTES) {
    try {
      fs.renameSync(logFile, `${logFile}.1`);
      writtenBytes.set(logFile, 0);
    } catch {
      /* a rotation that cannot happen must not take logging with it */
    }
  }

  try {
    fs.appendFileSync(logFile, line);
    writtenBytes.set(logFile, fileSize(logFile) + line.length);
  } catch {
    // A full or read-only disk must not crash the process over a log line:
    // the console.log above is still going to Docker's log driver.
  }
}

export const logger = {
  debug: (message: string, metadata?: LogMetadata) => writeLog('debug', message, metadata),
  info: (message: string, metadata?: LogMetadata) => writeLog('info', message, metadata),
  warn: (message: string, metadata?: LogMetadata) => writeLog('warn', message, metadata),
  error: (message: string, metadata?: LogMetadata) => writeLog('error', message, metadata),
};

export default logger;
