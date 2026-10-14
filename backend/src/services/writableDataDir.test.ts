import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ensureWritableDataDir } from './writableDataDir';

let root: string;
const appDir = (name: string) => path.join(root, name);

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'writable-data-'));
  for (const name of ['twenty', 'mealie', 'it-tools']) fs.mkdirSync(appDir(name), { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('ensureWritableDataDir', () => {
  it('creates Twenty\'s data/storage world-writable (§371)', () => {
    ensureWritableDataDir('twenty', appDir('twenty'));
    const stat = fs.statSync(path.join(appDir('twenty'), 'data', 'storage'));
    expect(stat.isDirectory()).toBe(true);
    expect(stat.mode & 0o777).toBe(0o777);
  });

  // §937: data/ already existed as the backend's 0775 dir, so Mealie (uid 911)
  // could read mealie.db but not create its journal beside it.
  it('opens an existing 0775 Mealie data/ to every uid', () => {
    const dir = path.join(appDir('mealie'), 'data');
    fs.mkdirSync(dir, { mode: 0o775 });
    fs.chmodSync(dir, 0o775);
    ensureWritableDataDir('mealie', appDir('mealie'));
    expect(fs.statSync(dir).mode & 0o777).toBe(0o777);
  });

  it('leaves every other app alone', () => {
    ensureWritableDataDir('it-tools', appDir('it-tools'));
    expect(fs.existsSync(path.join(appDir('it-tools'), 'data'))).toBe(false);
  });

  it('is idempotent', () => {
    ensureWritableDataDir('twenty', appDir('twenty'));
    expect(() => ensureWritableDataDir('twenty', appDir('twenty'))).not.toThrow();
  });

  it('tolerates a chmod EPERM when the dir is already world-writable', () => {
    ensureWritableDataDir('twenty', appDir('twenty'));
    const realChmod = fs.chmodSync;
    (fs as unknown as { chmodSync: unknown }).chmodSync = () => {
      const e = new Error('EPERM') as NodeJS.ErrnoException;
      e.code = 'EPERM';
      throw e;
    };
    try {
      expect(() => ensureWritableDataDir('twenty', appDir('twenty'))).not.toThrow();
    } finally {
      (fs as unknown as { chmodSync: unknown }).chmodSync = realChmod;
    }
  });
});
