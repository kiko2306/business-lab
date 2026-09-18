import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// Only the registry keys matter for discovery; importing the real SERVICES
// would drag in compose-file resolution.
vi.mock('../config/services', () => ({
  SERVICES: { alpha: {}, beta: {} },
  getAppsDir: vi.fn(),
}));

import { dumpToFile, findSqliteFiles } from './appDumps';

const SQLITE_HEADER = Buffer.from('SQLite format 3 ');

describe('findSqliteFiles', () => {
  let root: string;

  const write = (rel: string, contents: Buffer) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
    return full;
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dumps-test-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('finds SQLite files by header, whatever they are named', () => {
    write('alpha/data/kuma.db', SQLITE_HEADER);
    write('alpha/data/nested/deep/store.sqlite3', SQLITE_HEADER);
    const found = findSqliteFiles(root).map((f) => path.basename(f.file)).sort();
    expect(found).toEqual(['kuma.db', 'store.sqlite3']);
  });

  it('rejects a .db file that is NOT SQLite', () => {
    // portainer uses BoltDB, stirling-pdf uses H2 — both with a .db
    // extension. Snapshotting those with sqlite3 would produce garbage
    // that still looks like a successful backup.
    write('alpha/data/portainer.db', Buffer.from('    bolt-ish content'));
    write('beta/data/stirling.mv.db', Buffer.from('H:2,block:4,blockSize:10'));
    expect(findSqliteFiles(root)).toEqual([]);
  });

  it('never re-snapshots its own output', () => {
    // Without skipping the dump directory, every run would snapshot the
    // previous run's snapshot.
    write('alpha/data/_dump/already.sqlite', SQLITE_HEADER);
    write('alpha/data/live.db', SQLITE_HEADER);
    const found = findSqliteFiles(root);
    expect(found).toHaveLength(1);
    expect(path.basename(found[0].file)).toBe('live.db');
  });

  it('ignores directories that are not registered apps', () => {
    write('gamma/data/rogue.db', SQLITE_HEADER);
    expect(findSqliteFiles(root)).toEqual([]);
  });

  it('survives an unreadable directory instead of aborting the whole scan', () => {
    // Several app data directories are root-owned; one of them must not stop
    // every other app being backed up.
    write('alpha/data/ok.db', SQLITE_HEADER);
    const locked = path.join(root, 'alpha/data/locked');
    fs.mkdirSync(locked, { recursive: true });
    fs.chmodSync(locked, 0o000);
    try {
      expect(findSqliteFiles(root).map((f) => path.basename(f.file))).toEqual(['ok.db']);
    } finally {
      fs.chmodSync(locked, 0o755);
    }
  });
});

describe('dumpToFile', () => {
  let dir: string;
  let out: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dumptofile-'));
    out = path.join(dir, 'app.sql');
    fs.writeFileSync(out, 'previous good dump');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('streams a successful dump into place, larger than any one chunk', async () => {
    // ~2 MB: many pipe chunks, so this exercises the stream, not one buffer.
    const result = await dumpToFile(out, 'sh', ['-c', 'head -c 2000000 /dev/zero']);
    expect(result.ok).toBe(true);
    expect(result.bytes).toBe(2_000_000);
    expect(fs.statSync(out).size).toBe(2_000_000);
    expect(fs.existsSync(`${out}.part`)).toBe(false);
  });

  it('keeps the previous dump when the command fails partway', async () => {
    const result = await dumpToFile(out, 'sh', ['-c', 'printf partial; echo boom >&2; exit 3']);
    expect(result).toMatchObject({ ok: false, stderr: 'boom\n' });
    expect(fs.readFileSync(out, 'utf8')).toBe('previous good dump');
    expect(fs.existsSync(`${out}.part`)).toBe(false);
  });

  it('treats empty output as a failure', async () => {
    const result = await dumpToFile(out, 'sh', ['-c', 'exit 0']);
    expect(result.ok).toBe(false);
    expect(fs.readFileSync(out, 'utf8')).toBe('previous good dump');
  });
});
