import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ensureStirlingPipelines, renderCompressPipeline } from './stirlingPipelines';

let root: string;
let appDir: string;
let shared: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'stirling-pipe-'));
  appDir = path.join(root, 'stirling-pdf');
  shared = path.join(root, 'nextcloud', 'data', 'shared');
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(path.join(shared, 'to-stirling-compress'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('renderCompressPipeline', () => {
  it('is valid JSON naming the compress operation', () => {
    const cfg = JSON.parse(renderCompressPipeline());
    expect(cfg.name).toBe('compress');
    expect(cfg.pipeline[0].operation).toBe('/api/v1/misc/compress-pdf');
  });
});

describe('ensureStirlingPipelines', () => {
  const cfgPath = () => path.join(shared, 'to-stirling-compress', 'compress.json');

  it('writes the compress config into the watched folder, world-readable', () => {
    ensureStirlingPipelines('stirling-pdf', appDir);
    expect(fs.readFileSync(cfgPath(), 'utf8')).toBe(renderCompressPipeline());
    expect(fs.statSync(cfgPath()).mode & 0o044).toBe(0o044);
  });

  it('leaves an existing config alone so edits survive a restart', () => {
    ensureStirlingPipelines('stirling-pdf', appDir);
    fs.writeFileSync(cfgPath(), '{"edited":true}');
    ensureStirlingPipelines('stirling-pdf', appDir);
    expect(fs.readFileSync(cfgPath(), 'utf8')).toBe('{"edited":true}');
  });

  it('does nothing for other apps', () => {
    ensureStirlingPipelines('ntfy', appDir);
    expect(fs.existsSync(cfgPath())).toBe(false);
  });
});
