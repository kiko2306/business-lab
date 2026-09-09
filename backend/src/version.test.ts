import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_VERSION, getAppVersion } from './version';

describe('APP_VERSION', () => {
  it('matches the repo-root VERSION file', () => {
    // src/ is one dir under backend/, so ../../VERSION is the repo root file.
    const version = readFileSync(join(__dirname, '..', '..', 'VERSION'), 'utf8').trim();
    expect(APP_VERSION).toBe(version);
  });

  it('is a plain semver string', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('getAppVersion', () => {
  const originalRepoRoot = process.env.REPO_ROOT;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'version-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalRepoRoot === undefined) delete process.env.REPO_ROOT;
    else process.env.REPO_ROOT = originalRepoRoot;
  });

  it('reads $REPO_ROOT/VERSION live', () => {
    writeFileSync(join(dir, 'VERSION'), '1.2.3\n');
    process.env.REPO_ROOT = dir;
    expect(getAppVersion()).toBe('1.2.3');
    // A pull that changes the file is picked up without a restart.
    writeFileSync(join(dir, 'VERSION'), '1.2.4\n');
    expect(getAppVersion()).toBe('1.2.4');
  });

  it('ignores a malformed VERSION file and falls back', () => {
    writeFileSync(join(dir, 'VERSION'), 'not-a-version\n');
    process.env.REPO_ROOT = dir;
    // Falls through to the checked-in repo VERSION (via __dirname).
    expect(getAppVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
