import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ensureTwentyStorage } from './twentyStorage';

let root: string;
let appDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'twenty-storage-'));
  appDir = path.join(root, 'twenty');
  fs.mkdirSync(appDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('ensureTwentyStorage', () => {
  it('creates data/storage world-writable', () => {
    ensureTwentyStorage(appDir);
    const dir = path.join(appDir, 'data', 'storage');
    const stat = fs.statSync(dir);
    expect(stat.isDirectory()).toBe(true);
    expect(stat.mode & 0o777).toBe(0o777);
  });

  it('is idempotent', () => {
    ensureTwentyStorage(appDir);
    expect(() => ensureTwentyStorage(appDir)).not.toThrow();
  });

  it('tolerates a chmod EPERM when the dir is already world-writable', () => {
    ensureTwentyStorage(appDir);
    const realChmod = fs.chmodSync;
    (fs as unknown as { chmodSync: unknown }).chmodSync = () => {
      const e = new Error('EPERM') as NodeJS.ErrnoException;
      e.code = 'EPERM';
      throw e;
    };
    try {
      expect(() => ensureTwentyStorage(appDir)).not.toThrow();
    } finally {
      (fs as unknown as { chmodSync: unknown }).chmodSync = realChmod;
    }
    expect(fs.statSync(path.join(appDir, 'data', 'storage')).mode & 0o007).toBe(0o007);
  });
});
