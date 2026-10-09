import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ensureSharedFolders, SHARED_FOLDERS_BY_APP } from './sharedFolders';

let root: string;
let appDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-folders-'));
  appDir = path.join(root, 'jellyfin');
  fs.mkdirSync(appDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('ensureSharedFolders', () => {
  it('maps each media app to its folder in the shared tree', () => {
    expect(SHARED_FOLDERS_BY_APP).toEqual({
      jellyfin: ['media'],
      navidrome: ['music'],
      immich: ['photos'],
      docuseal: ['signed'],
      paperless: ['paperless-archive'],
      'stirling-pdf': ['to-stirling-compress', 'from-stirling'],
    });
  });

  it('creates the app folder under nextcloud/data/shared, world-writable', () => {
    ensureSharedFolders('jellyfin', appDir);

    const stat = fs.statSync(path.join(root, 'nextcloud', 'data', 'shared', 'media'));
    expect(stat.isDirectory()).toBe(true);
    expect(stat.mode & 0o777).toBe(0o777);
  });

  it('does nothing for an app with no shared folder', () => {
    ensureSharedFolders('ntfy', appDir);
    expect(fs.existsSync(path.join(root, 'nextcloud'))).toBe(false);
  });

  it('is idempotent and tolerates chmod EPERM on an already-open dir', () => {
    ensureSharedFolders('jellyfin', appDir);
    const realChmod = fs.chmodSync;
    (fs as unknown as { chmodSync: unknown }).chmodSync = () => {
      const e = new Error('EPERM') as NodeJS.ErrnoException;
      e.code = 'EPERM';
      throw e;
    };
    try {
      expect(() => ensureSharedFolders('jellyfin', appDir)).not.toThrow();
    } finally {
      (fs as unknown as { chmodSync: unknown }).chmodSync = realChmod;
    }
  });
});
