import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * The log directory is resolved once, at module load, so each test gets a
 * fresh module pointed at its own temporary directory.
 */
async function freshLogger(dir: string) {
  process.env.LOG_DIR = dir;
  vi.resetModules();
  return (await import('./logger')).default;
}

describe('logger', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-test-'));
    // Every entry also goes to stdout; keep the test output readable.
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOG_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes each level to its own file', async () => {
    const logger = await freshLogger(dir);

    logger.info('started');
    logger.error('exploded', { code: 500 });

    const info = JSON.parse(fs.readFileSync(path.join(dir, 'info.log'), 'utf8').trim());
    const error = JSON.parse(fs.readFileSync(path.join(dir, 'error.log'), 'utf8').trim());
    expect(info).toMatchObject({ level: 'info', message: 'started' });
    expect(error).toMatchObject({ level: 'error', message: 'exploded', code: 500 });
  });

  it('appends rather than replacing', async () => {
    const logger = await freshLogger(dir);

    logger.info('first');
    logger.info('second');

    const lines = fs.readFileSync(path.join(dir, 'info.log'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('rotates at the size cap, keeping one previous generation', async () => {
    const logger = await freshLogger(dir);
    const logFile = path.join(dir, 'warn.log');
    // Three megabytes a line, so the second entry crosses the five megabyte
    // cap. The alternative — writing five megabytes of ordinary lines — tests
    // the same branch and takes a hundred times longer.
    const bulk = 'x'.repeat(3 * 1024 * 1024);

    logger.warn('first', { bulk });
    const afterFirst = fs.statSync(logFile).size;
    logger.warn('second', { bulk });

    expect(fs.existsSync(`${logFile}.1`)).toBe(true);
    expect(fs.statSync(`${logFile}.1`).size).toBe(afterFirst);
    // The live file holds only the entry that triggered the rotation, so the
    // cap is a ceiling rather than a threshold the file sits above.
    expect(fs.statSync(logFile).size).toBeLessThan(5 * 1024 * 1024);
    expect(fs.readFileSync(logFile, 'utf8')).toContain('"message":"second"');
  });

  it('picks up an existing file size instead of restarting the count', async () => {
    // A restart must not reset the tally and let the file grow past the cap.
    fs.writeFileSync(path.join(dir, 'info.log'), 'y'.repeat(5 * 1024 * 1024 - 10));
    const logger = await freshLogger(dir);

    logger.info('the entry that tips it over');

    expect(fs.existsSync(path.join(dir, 'info.log.1'))).toBe(true);
  });
});
