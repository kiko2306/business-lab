import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractComposeEnvVars, getPublishedUpstreamPort } from './services';

describe('extractComposeEnvVars', () => {
  it('treats a bare ${VAR} as required', () => {
    const vars = extractComposeEnvVars('PASSWORD: ${PAPERLESS_DB_PASSWORD}');
    expect(vars).toEqual([{ key: 'PAPERLESS_DB_PASSWORD', required: true, defaultValue: null }]);
  });

  it('treats ${VAR:-default} as optional with the given default', () => {
    const vars = extractComposeEnvVars('PORT: ${PAPERLESS_PORT:-8000}');
    expect(vars).toEqual([{ key: 'PAPERLESS_PORT', required: false, defaultValue: '8000' }]);
  });

  it('dedupes repeated keys and stays required if any occurrence lacks a default', () => {
    const content = `
      DBNAME: \${PAPERLESS_DB_NAME:-paperless}
      POSTGRES_DB: \${PAPERLESS_DB_NAME}
    `;
    const vars = extractComposeEnvVars(content);
    expect(vars).toHaveLength(1);
    expect(vars[0]).toEqual({ key: 'PAPERLESS_DB_NAME', required: true, defaultValue: 'paperless' });
  });

  it('allows an empty default', () => {
    const vars = extractComposeEnvVars('FOO: ${FOO:-}');
    expect(vars).toEqual([{ key: 'FOO', required: false, defaultValue: '' }]);
  });

  it('returns nothing for compose content with no variable references', () => {
    expect(extractComposeEnvVars('image: postgres:16-alpine')).toEqual([]);
  });
});

describe('getPublishedUpstreamPort', () => {
  // 'paperless' is a real registry entry whose app directory (basename of
  // its configured composePath) is 'paperless'; pointing APPS_DIR at a temp
  // root and writing a compose file under <tmp>/paperless/ lets
  // resolveComposeFile() find it without touching the checked-in fixtures
  // under apps/, which this test doesn't want to depend on staying in sync.
  let tmpDir: string;
  let originalAppsDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'services-test-'));
    fs.mkdirSync(path.join(tmpDir, 'paperless'));
    originalAppsDir = process.env.APPS_DIR;
    process.env.APPS_DIR = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalAppsDir === undefined) {
      delete process.env.APPS_DIR;
    } else {
      process.env.APPS_DIR = originalAppsDir;
    }
  });

  function writeCompose(content: string) {
    fs.writeFileSync(path.join(tmpDir, 'paperless', 'compose.yaml'), content);
  }

  it('reads a literal host port', () => {
    writeCompose('services:\n  app:\n    ports:\n      - "8000:8000"\n');
    expect(getPublishedUpstreamPort('paperless')).toBe(8000);
  });

  it('falls back to the ${VAR:-default} value when no .env overrides it', () => {
    writeCompose('services:\n  app:\n    ports:\n      - "${PAPERLESS_PORT:-8000}:8000"\n');
    expect(getPublishedUpstreamPort('paperless')).toBe(8000);
  });

  it('prefers the app .env value over the compose default', () => {
    writeCompose('services:\n  app:\n    ports:\n      - "${PAPERLESS_PORT:-8000}:8000"\n');
    fs.writeFileSync(path.join(tmpDir, 'paperless', '.env'), 'PAPERLESS_PORT=9001\n');
    expect(getPublishedUpstreamPort('paperless')).toBe(9001);
  });

  it('returns null when the compose file has no ports mapping', () => {
    writeCompose('services:\n  app:\n    image: paperless\n');
    expect(getPublishedUpstreamPort('paperless')).toBeNull();
  });

  it('returns null for a service with no installed compose file', () => {
    fs.rmSync(path.join(tmpDir, 'paperless'), { recursive: true, force: true });
    expect(getPublishedUpstreamPort('paperless')).toBeNull();
  });

  it('returns null for a name not in the registry', () => {
    expect(getPublishedUpstreamPort('not-a-real-service')).toBeNull();
  });
});
