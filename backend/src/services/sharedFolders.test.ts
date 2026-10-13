import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runCommand = vi.hoisted(() => vi.fn());
vi.mock('./backup', () => ({ runCommand }));
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

  it('creates the app folder under nextcloud/data/shared, world-writable', async () => {
    await ensureSharedFolders('jellyfin', appDir);

    const stat = fs.statSync(path.join(root, 'nextcloud', 'data', 'shared', 'media'));
    expect(stat.isDirectory()).toBe(true);
    expect(stat.mode & 0o777).toBe(0o777);
  });

  it('does nothing for an app with no shared folder', async () => {
    await ensureSharedFolders('ntfy', appDir);
    expect(fs.existsSync(path.join(root, 'nextcloud'))).toBe(false);
  });

  function refuseChmod(): () => void {
    const realChmod = fs.chmodSync;
    (fs as unknown as { chmodSync: unknown }).chmodSync = () => {
      const e = new Error('EPERM') as NodeJS.ErrnoException;
      e.code = 'EPERM';
      throw e;
    };
    return () => {
      (fs as unknown as { chmodSync: unknown }).chmodSync = realChmod;
    };
  }

  it('is idempotent and tolerates chmod EPERM on an already-open dir', async () => {
    await ensureSharedFolders('jellyfin', appDir);
    runCommand.mockClear();
    const restore = refuseChmod();
    try {
      await expect(ensureSharedFolders('jellyfin', appDir)).resolves.toBeUndefined();
    } finally {
      restore();
    }
    expect(runCommand).not.toHaveBeenCalled();
  });

  // Found live (plan.md §917): `music/` was root:root 0755 — made by Docker as a
  // bind source before §870 — so the backend's chmod got EPERM and Navidrome
  // could not start at all until a Samba restart chowned the tree.
  it('opens a closed folder it does not own with a root one-off container instead of failing the start', async () => {
    const dir = path.join(root, 'nextcloud', 'data', 'shared', 'media');
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o755);
    runCommand.mockResolvedValue({ stdout: '', stderr: '' });
    const restore = refuseChmod();
    try {
      await expect(ensureSharedFolders('jellyfin', appDir)).resolves.toBeUndefined();
    } finally {
      restore();
    }
    expect(runCommand).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['run', '--rm', '-v', `${dir}:/d`, 'chmod', '0777', '/d'])
    );
  });

  it('still fails the start when the one-off container cannot open it either', async () => {
    const dir = path.join(root, 'nextcloud', 'data', 'shared', 'media');
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o755);
    runCommand.mockRejectedValue(new Error('no docker'));
    const restore = refuseChmod();
    try {
      await expect(ensureSharedFolders('jellyfin', appDir)).rejects.toThrow('EPERM');
    } finally {
      restore();
    }
  });
});
