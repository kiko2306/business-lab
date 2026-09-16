import { describe, expect, it } from 'vitest';

import { buildWebdavMountEnv, resolveWebdavNasSettings, WEBDAV_LOCAL_DEVICE } from './webdavMount';

describe('resolveWebdavNasSettings', () => {
  it('trims the server/share and leaves credentials as-is', () => {
    expect(
      resolveWebdavNasSettings({
        WEBDAV_NAS_SERVER: ' 192.168.1.50 ',
        WEBDAV_NAS_SHARE: ' backups/webdav ',
        WEBDAV_NAS_USERNAME: 'nas-user',
        WEBDAV_NAS_PASSWORD: 'nas-pass',
      })
    ).toEqual({ server: '192.168.1.50', share: 'backups/webdav', username: 'nas-user', password: 'nas-pass' });
  });

  it('defaults every field to empty when unset', () => {
    expect(resolveWebdavNasSettings({})).toEqual({ server: '', share: '', username: '', password: '' });
  });
});

describe('buildWebdavMountEnv', () => {
  it('falls back to the local bind mount when no NAS server is set', () => {
    expect(buildWebdavMountEnv({ server: '', share: '', username: '', password: '' })).toEqual({
      WEBDAV_MOUNT_TYPE: 'none',
      WEBDAV_MOUNT_OPTIONS: 'bind',
      WEBDAV_MOUNT_DEVICE: WEBDAV_LOCAL_DEVICE,
    });
  });

  it('builds a CIFS mount from a NAS server/share/credentials', () => {
    const env = buildWebdavMountEnv({
      server: '192.168.1.50',
      share: 'backups/webdav',
      username: 'nas-user',
      password: 'nas-pass',
    });
    expect(env.WEBDAV_MOUNT_TYPE).toBe('cifs');
    expect(env.WEBDAV_MOUNT_DEVICE).toBe('//192.168.1.50/backups/webdav');
    expect(env.WEBDAV_MOUNT_OPTIONS).toContain('username=nas-user');
    expect(env.WEBDAV_MOUNT_OPTIONS).toContain('password=nas-pass');
    expect(env.WEBDAV_MOUNT_OPTIONS).toContain('vers=3.0');
  });
});
