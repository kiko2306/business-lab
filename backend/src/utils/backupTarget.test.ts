import { describe, expect, it } from 'vitest';
import { BackupTarget, toKopiaRepositoryMount, toMountSpec, validateTarget } from './backupTarget';

const base: BackupTarget = {
  kind: 'disk', path: '', server: '', share: '', username: '', password: '',
  options: '',
};

describe('toMountSpec', () => {
  it('builds a bind mount for a local disk', () => {
    expect(toMountSpec({ ...base, kind: 'disk', path: '/mnt/backups' }))
      .toEqual({ type: 'none', o: 'bind', device: '/mnt/backups' });
  });

  it('builds an NFS mount and adds the leading colon the driver expects', () => {
    expect(toMountSpec({ ...base, kind: 'nfs', server: '10.0.0.5', share: '/volume1/backup' }))
      .toEqual({ type: 'nfs', o: 'addr=10.0.0.5,rw', device: ':/volume1/backup' });
  });

  it('builds an SMB mount with SMB3 and a writable uid by default', () => {
    const spec = toMountSpec({ ...base, kind: 'smb', server: '10.0.0.5', share: 'backup', username: 'nas', password: 'pw' });
    expect(spec.type).toBe('cifs');
    expect(spec.device).toBe('//10.0.0.5/backup');
    // Omitting vers makes the kernel negotiate down and usually fail with a
    // bare "permission denied" that reads like wrong credentials.
    expect(spec.o).toContain('vers=3.0');
    expect(spec.o).toContain('uid=1000');
  });

  it('does not duplicate an option the user supplied themselves', () => {
    const spec = toMountSpec({ ...base, kind: 'smb', server: 'h', share: 's', username: 'u', options: 'vers=2.1' });
    expect(spec.o.match(/vers=/g)).toHaveLength(1);
  });
});

describe('toKopiaRepositoryMount', () => {
  it('translates a destination the same way toMountSpec does — Kopia sees a plain directory', () => {
    expect(toKopiaRepositoryMount({ ...base, kind: 'disk', path: '/mnt/backups' }))
      .toEqual({ type: 'none', o: 'bind', device: '/mnt/backups' });
    expect(toKopiaRepositoryMount({ ...base, kind: 'nfs', server: '10.0.0.5', share: '/v1/b' }))
      .toEqual({ type: 'nfs', o: 'addr=10.0.0.5,rw', device: ':/v1/b' });
  });
});

describe('validateTarget', () => {
  it('rejects a comma in credentials, which would corrupt the mount options', () => {
    // Mount options are comma-separated, so this would silently mangle the
    // mount rather than fail cleanly.
    expect(validateTarget({ ...base, kind: 'smb', server: 'h', share: 's', username: 'a,b' })).toMatch(/comma/);
  });

  it('rejects a backup path on the system disk', () => {
    // The entire point is surviving the loss of this machine's disk.
    expect(validateTarget({ ...base, kind: 'disk', path: '/home/mat/backups' })).toMatch(/system disk/);
    expect(validateTarget({ ...base, kind: 'disk', path: '/mnt/backups' })).toBeNull();
  });

  it('requires the pieces each kind actually needs', () => {
    expect(validateTarget({ ...base, kind: 'nfs', server: '' })).toMatch(/hostname or IP/);
    expect(validateTarget({ ...base, kind: 'smb', server: 'h', share: 's', username: '' })).toMatch(/username/);
    expect(validateTarget({ ...base, kind: 'smb', server: 'h', share: 's', username: 'u' })).toBeNull();
  });
});
