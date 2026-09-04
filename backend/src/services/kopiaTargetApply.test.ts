import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { ensureKopiaRepoDir } from './kopiaTargetApply';

// Only ensureKopiaRepoDir takes an explicit appDir and touches nothing else,
// so it is the one piece worth a unit test — applyKopiaTarget / readApplied*
// are a thin shell over `docker` + the real registry, proven against the live
// stack (plan.md §194), the same way backupTargetApply.ts is left untested.
describe('ensureKopiaRepoDir', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kopia-erd-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const writeEnv = (contents: string) => fs.writeFileSync(path.join(dir, '.env'), contents);

  it('creates a relative local bind device under the app dir', () => {
    writeEnv('BACKUP_MOUNT_TYPE=none\nBACKUP_MOUNT_OPTIONS=bind\nBACKUP_MOUNT_DEVICE=./data/repository\n');
    ensureKopiaRepoDir(dir);
    expect(fs.existsSync(path.join(dir, 'data', 'repository'))).toBe(true);
  });

  it('creates an absolute local bind device as given', () => {
    const abs = path.join(dir, 'elsewhere', 'repo');
    writeEnv(`BACKUP_MOUNT_TYPE=none\nBACKUP_MOUNT_DEVICE=${abs}\n`);
    ensureKopiaRepoDir(dir);
    expect(fs.existsSync(abs)).toBe(true);
  });

  it('does nothing for an nfs/cifs mount — the export lives on the server', () => {
    writeEnv('BACKUP_MOUNT_TYPE=nfs\nBACKUP_MOUNT_DEVICE=:/volume1/backup\n');
    ensureKopiaRepoDir(dir);
    expect(fs.readdirSync(dir)).toEqual(['.env']);
  });

  it('falls back to the default device when the .env is absent', () => {
    ensureKopiaRepoDir(dir);
    expect(fs.existsSync(path.join(dir, 'data', 'repository'))).toBe(true);
  });
});
