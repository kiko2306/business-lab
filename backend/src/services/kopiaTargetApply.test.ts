import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { BackupTarget } from '../utils/backupTarget';
import { buildEnvValues, ensureKopiaRepoDir } from './kopiaTargetApply';

const base: BackupTarget = {
  kind: 'disk', path: '', server: '', share: '', username: '', password: '', options: '',
};

// buildEnvValues is pure and worth locking in — in particular that switching
// kind never leaves the other kind's env vars stale (a secret access key
// lingering in .env after moving off s3 would be a real leak, not just mess).
describe('buildEnvValues', () => {
  it('writes the s3 vars and a harmless filesystem fallback for an s3 target', () => {
    const values = buildEnvValues({
      ...base, kind: 's3', share: 'bucket', server: 'minio.lan:9000',
      username: 'ak', password: 'sk', options: '--disable-tls',
    });
    expect(values.BACKUP_REPO_KIND).toBe('s3');
    expect(values.BACKUP_S3_BUCKET).toBe('bucket');
    expect(values.BACKUP_S3_ENDPOINT).toBe('minio.lan:9000');
    expect(values.BACKUP_S3_ACCESS_KEY_ID).toBe('ak');
    expect(values.BACKUP_S3_SECRET_ACCESS_KEY).toBe('sk');
    expect(values.BACKUP_S3_EXTRA_ARGS).toBe('--disable-tls');
    // The compose file's backup-target volume always exists — s3 just never uses it.
    expect(values.BACKUP_MOUNT_TYPE).toBe('none');
  });

  it('blanks every s3 var for a mount-based target — nothing stale left in .env', () => {
    const values = buildEnvValues({ ...base, kind: 'disk', path: '/mnt/backups' });
    expect(values.BACKUP_REPO_KIND).toBe('filesystem');
    expect(values.BACKUP_S3_BUCKET).toBe('');
    expect(values.BACKUP_S3_ACCESS_KEY_ID).toBe('');
    expect(values.BACKUP_S3_SECRET_ACCESS_KEY).toBe('');
    expect(values.BACKUP_MOUNT_DEVICE).toBe('/mnt/backups');
  });
});

// Only ensureKopiaRepoDir takes an explicit appDir and touches nothing else,
// so it is the one piece worth a unit test beyond buildEnvValues —
// applyKopiaTarget / readApplied* are a thin shell over `docker` + the real
// registry, proven against the live stack instead (plan.md §194, §221).
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
