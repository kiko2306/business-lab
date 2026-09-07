import { describe, expect, it } from 'vitest';
import {
  BackupTarget,
  isMountedKind,
  toKopiaRepositoryMount,
  toMountSpec,
  toRcloneFtpConfig,
  toS3ConnectArgs,
  validateTarget,
} from './backupTarget';

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

  it('refuses the non-mounted kinds — there is no mount for them', () => {
    expect(() => toMountSpec({ ...base, kind: 's3', share: 'bucket', username: 'ak', password: 'sk' })).toThrow();
    expect(() => toMountSpec({ ...base, kind: 'ftp', server: 'h' })).toThrow(/not a Docker mount/);
    expect(() => toMountSpec({ ...base, kind: 'ftps', server: 'h' })).toThrow();
  });
});

describe('isMountedKind', () => {
  it('is true only for the kernel-mount kinds', () => {
    expect(['disk', 'smb', 'nfs'].every(isMountedKind as (k: string) => boolean)).toBe(true);
    expect(['s3', 'ftp', 'ftps'].some(isMountedKind as (k: string) => boolean)).toBe(false);
  });
});

describe('toRcloneFtpConfig', () => {
  it('maps the shared form fields onto an rclone ftp remote, defaulting path to /', () => {
    expect(toRcloneFtpConfig({
      ...base, kind: 'ftp', server: '192.168.1.50', username: 'frias', password: 'pw', share: '',
    })).toEqual({
      host: '192.168.1.50', port: '', user: 'frias', pass: 'pw',
      remotePath: '/', explicitTls: false, extraArgs: '',
    });
  });

  it('splits host:port and marks ftps as explicit TLS', () => {
    const c = toRcloneFtpConfig({
      ...base, kind: 'ftps', server: 'nas.lan:2121', username: 'u', password: 'p',
      share: '/backup', options: '--ftp-disable-epsv',
    });
    expect(c).toMatchObject({ host: 'nas.lan', port: '2121', remotePath: '/backup', explicitTls: true, extraArgs: '--ftp-disable-epsv' });
  });
});

describe('toS3ConnectArgs', () => {
  it('maps the shared form fields onto their s3 meaning', () => {
    expect(toS3ConnectArgs({
      ...base, kind: 's3', share: 'my-bucket', server: 'minio.lan:9000',
      username: 'accesskey', password: 'secretkey', options: '--region=us-east-1 --disable-tls',
    })).toEqual({
      bucket: 'my-bucket',
      endpoint: 'minio.lan:9000',
      accessKeyId: 'accesskey',
      secretAccessKey: 'secretkey',
      extraArgs: '--region=us-east-1 --disable-tls',
    });
  });

  it('leaves endpoint blank to mean AWS S3 itself', () => {
    expect(toS3ConnectArgs({ ...base, kind: 's3', share: 'b', username: 'a', password: 'p' }).endpoint).toBe('');
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

  it('requires a bucket and an access key for s3, but not an endpoint (blank = AWS)', () => {
    expect(validateTarget({ ...base, kind: 's3', share: '' })).toMatch(/bucket/);
    expect(validateTarget({ ...base, kind: 's3', share: 'b', username: '' })).toMatch(/access key/);
    expect(validateTarget({ ...base, kind: 's3', share: 'b', username: 'ak' })).toBeNull();
  });

  it('does not reject a comma in an s3 secret key — no comma-joined mount options to corrupt', () => {
    expect(validateTarget({ ...base, kind: 's3', share: 'b', username: 'ak', password: 'has,a,comma' })).toBeNull();
  });

  it('requires a bare host and a username for ftp/ftps, but not a directory', () => {
    expect(validateTarget({ ...base, kind: 'ftp', server: '' })).toMatch(/FTP server/);
    expect(validateTarget({ ...base, kind: 'ftp', server: 'ftp://h/x', username: 'u' })).toMatch(/bare host/);
    expect(validateTarget({ ...base, kind: 'ftp', server: 'h', username: '' })).toMatch(/FTP username/);
    expect(validateTarget({ ...base, kind: 'ftp', server: 'h', username: 'u' })).toBeNull();
    expect(validateTarget({ ...base, kind: 'ftps', server: 'h:2121', username: 'u', password: 'has,comma' })).toBeNull();
  });
});
