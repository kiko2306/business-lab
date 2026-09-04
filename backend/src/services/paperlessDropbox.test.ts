import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ensurePaperlessDropbox } from './paperlessDropbox';

let root: string;
let appDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperless-dropbox-'));
  appDir = path.join(root, 'paperless');
  fs.mkdirSync(appDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('ensurePaperlessDropbox', () => {
  it('creates the shared-tree drop box under the sibling file-browser app, world-writable', () => {
    ensurePaperlessDropbox(appDir);

    const dropbox = path.join(root, 'file-browser', 'data', 'files', 'to-paperless');
    const stat = fs.statSync(dropbox);
    expect(stat.isDirectory()).toBe(true);
    expect(stat.mode & 0o777).toBe(0o777);
  });

  it('is idempotent when the drop box already exists', () => {
    ensurePaperlessDropbox(appDir);
    expect(() => ensurePaperlessDropbox(appDir)).not.toThrow();
  });
});
