import { describe, expect, it } from 'vitest';
import { BackupTarget, DEFAULT_BACKUP_FOLDER, DUPLICATI_OAUTH_LOGIN_URL, DUPLICATI_OAUTH_REFRESH_URL, isMountedKind, toDuplicatiUrl, toMountSpec, validateTarget } from './backupTarget';

const base: BackupTarget = {
  kind: 'disk', path: '', server: '', share: '', username: '', password: '',
  options: '', authId: '', folder: '',
};

describe('backup destination families', () => {
  it('separates mountable destinations from Duplicati backends', () => {
    expect(isMountedKind('disk')).toBe(true);
    expect(isMountedKind('smb')).toBe(true);
    expect(isMountedKind('nfs')).toBe(true);
    // No kernel filesystem is mounted for these; Duplicati speaks the protocol
    // itself, so treating them as mountable would produce a volume that only
    // fails when a backup runs.
    expect(isMountedKind('googledrive')).toBe(false);
    expect(isMountedKind('ftp')).toBe(false);
    expect(isMountedKind('ftps')).toBe(false);
  });

  it('refuses to build a mount spec for a backend destination', () => {
    expect(() => toMountSpec({ ...base, kind: 'googledrive', authId: 'x' })).toThrow(/not a mounted destination/);
    expect(() => toMountSpec({ ...base, kind: 'ftp', server: 'h' })).toThrow(/not a mounted destination/);
  });
});

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

describe('toDuplicatiUrl', () => {
  it('builds a googledrive target URL', () => {
    expect(toDuplicatiUrl({ ...base, kind: 'googledrive', authId: 'abc123', folder: 'homelab' }))
      .toBe('googledrive://homelab?authid=abc123');
  });

  it('keeps the AuthID raw — a colon must NOT become %3A', () => {
    // Regression: percent-encoding the colon made Duplicati look up a key that
    // does not exist and fail with "No such key" plus a 404, which reads like
    // an expired token and sends you off to regenerate a working one.
    const url = toDuplicatiUrl({ ...base, kind: 'googledrive', authId: '1ffa:BcD-eF_gH.F', folder: 'x' });
    expect(url).toBe('googledrive://x?authid=1ffa:BcD-eF_gH.F');
    expect(url).not.toContain('%3A');
  });

  it('defaults the folder and strips stray slashes', () => {
    expect(toDuplicatiUrl({ ...base, kind: 'googledrive', authId: 'a' })).toBe('googledrive://homelab-backups?authid=a');
    expect(toDuplicatiUrl({ ...base, kind: 'googledrive', authId: 'a', folder: '/x/' })).toBe('googledrive://x?authid=a');
  });

  it('falls back to exactly DEFAULT_BACKUP_FOLDER when the folder is blank', () => {
    // The dashboard shows DEFAULT_BACKUP_FOLDER for an unset folder; this ties
    // that display to the folder the URL builder actually uses, so the two
    // cannot drift apart.
    expect(toDuplicatiUrl({ ...base, kind: 'googledrive', authId: 'a' }))
      .toBe(`googledrive://${DEFAULT_BACKUP_FOLDER}?authid=a`);
  });

  it('returns null for mounted kinds, which have no target URL', () => {
    expect(toDuplicatiUrl({ ...base, kind: 'disk', path: '/mnt/b' })).toBeNull();
  });

  it('builds an aftp:// URL for FTP, credentials as percent-encoded params', () => {
    const url = toDuplicatiUrl({ ...base, kind: 'ftp', server: 'nas:2121', share: '/backups/', username: 'bkp', password: 'p@ss word' });
    expect(url).toBe('aftp://nas:2121/backups?auth-username=bkp&auth-password=p%40ss%20word');
    // A space becomes %20, never + — Duplicati's parser takes + literally.
    expect(url).not.toContain('+');
  });

  it('adds explicit TLS for ftps and nothing for plain ftp', () => {
    expect(toDuplicatiUrl({ ...base, kind: 'ftps', server: 'h', share: 'b', username: 'u', password: 'p' }))
      .toContain('aftp-encryption-mode=Explicit');
    expect(toDuplicatiUrl({ ...base, kind: 'ftp', server: 'h', share: 'b', username: 'u', password: 'p' }))
      .not.toContain('aftp-encryption-mode');
  });

  it('omits the query entirely for an anonymous FTP destination', () => {
    expect(toDuplicatiUrl({ ...base, kind: 'ftp', server: 'h', share: 'b' })).toBe('aftp://h/b');
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
    expect(validateTarget({ ...base, kind: 'googledrive' })).toMatch(/AuthID/);
    expect(validateTarget({ ...base, kind: 'googledrive', authId: 'tok' })).toBeNull();
    // A colon is normal in an AuthID and must be accepted.
    expect(validateTarget({ ...base, kind: 'googledrive', authId: 'a:b' })).toBeNull();
    // These would split or truncate the query string.
    expect(validateTarget({ ...base, kind: 'googledrive', authId: 'a&b' })).toMatch(/cannot appear/);
    expect(validateTarget({ ...base, kind: 'googledrive', authId: 'a b' })).toMatch(/cannot appear/);
  });

  it('requires a server for FTP and rejects one carrying a path or credentials', () => {
    expect(validateTarget({ ...base, kind: 'ftp', server: '' })).toMatch(/FTP server/);
    expect(validateTarget({ ...base, kind: 'ftps', server: 'nas:2121', share: 'b', username: 'u', password: 'p' })).toBeNull();
    // host:port only — a slash, space or user@ would break the aftp:// URL.
    expect(validateTarget({ ...base, kind: 'ftp', server: 'nas/backups' })).toMatch(/bare host/);
    expect(validateTarget({ ...base, kind: 'ftp', server: 'user@nas' })).toMatch(/bare host/);
    // A comma in an FTP password is fine — it goes into a URL, not mount options.
    expect(validateTarget({ ...base, kind: 'ftp', server: 'nas', password: 'a,b' })).toBeNull();
  });
});

describe('OAuth handler endpoints', () => {
  // Regression: these two were once a single constant, and the job's
  // `oauth-url` was built as `${LOGIN}/refresh`. Because the login URL ends in
  // a query string, that produced
  //   https://duplicati-oauth-handler.appspot.com/?type=googledrive/refresh
  // whose path is "/" — an address that answers 405 Method Not Allowed. Every
  // token refresh during a backup failed, surfacing as 403s and a
  // TimeoutException in GetFolderIdAsync: symptoms that point at credentials
  // or the network, and are caused by neither.
  it('refresh endpoint is a bare path with no query string', () => {
    const url = new URL(DUPLICATI_OAUTH_REFRESH_URL);
    expect(url.pathname).toBe('/refresh');
    expect(url.search).toBe('');
  });

  it('login page carries the type query and is not the refresh endpoint', () => {
    const url = new URL(DUPLICATI_OAUTH_LOGIN_URL);
    expect(url.searchParams.get('type')).toBe('googledrive');
    expect(DUPLICATI_OAUTH_LOGIN_URL).not.toBe(DUPLICATI_OAUTH_REFRESH_URL);
  });

  it('neither URL can be derived from the other by appending a path', () => {
    // The exact operation that caused the outage.
    expect(`${DUPLICATI_OAUTH_LOGIN_URL.replace(/\/+$/, '')}/refresh`).not.toBe(
      DUPLICATI_OAUTH_REFRESH_URL,
    );
  });
});
