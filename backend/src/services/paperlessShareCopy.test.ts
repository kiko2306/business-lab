import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ensurePaperlessShareCopy,
  postConsumeScriptHostPath,
  renderPostConsumeScript,
} from './paperlessShareCopy';

let root: string;
let appDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperless-share-'));
  appDir = path.join(root, 'paperless');
  fs.mkdirSync(appDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('renderPostConsumeScript', () => {
  const script = renderPostConsumeScript();

  it('copies the archive version, falling back to the original, into the share mount', () => {
    expect(script.startsWith('#!/usr/bin/env python3')).toBe(true);
    expect(script).toContain('DOCUMENT_ARCHIVE_PATH');
    expect(script).toContain('DOCUMENT_SOURCE_PATH');
    expect(script).toContain('/usr/src/paperless/share-out');
  });

  it('never fails the consume: a copy error is logged, the exit code stays 0', () => {
    expect(script).toContain('except OSError');
    expect(script.trimEnd().endsWith('sys.exit(0)')).toBe(true);
  });
});

describe('ensurePaperlessShareCopy', () => {
  it('writes an executable script for paperless', () => {
    ensurePaperlessShareCopy('paperless', appDir);
    const file = postConsumeScriptHostPath(appDir);
    expect(fs.readFileSync(file, 'utf8')).toBe(renderPostConsumeScript());
    expect(fs.statSync(file).mode & 0o755).toBe(0o755);
  });

  it('does nothing for other apps', () => {
    ensurePaperlessShareCopy('ntfy', appDir);
    expect(fs.existsSync(postConsumeScriptHostPath(appDir))).toBe(false);
  });
});
