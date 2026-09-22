import { describe, expect, it, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseEnvFile, writeEnvValues } from './envFile';

const created: string[] = [];

function tmpEnv(content?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'envfile-'));
  created.push(dir);
  const file = path.join(dir, '.env');
  if (content !== undefined) fs.writeFileSync(file, content);
  return file;
}

afterEach(() => {
  while (created.length) fs.rmSync(created.pop()!, { recursive: true, force: true });
});

describe('writeEnvValues', () => {
  // The bug this helper exists to kill: the old regex version passed the new
  // line as a String.replace *replacement string*, so these expanded.
  it.each(['a$&b', "p$'x", 'p$`x', 'secret$1more', 'plain$dollar'])(
    'writes %s literally',
    (password) => {
      const file = tmpEnv('BACKUP_WEBDAV_PASSWORD=old\n');
      writeEnvValues(file, { BACKUP_WEBDAV_PASSWORD: password });
      expect(parseEnvFile(file).BACKUP_WEBDAV_PASSWORD).toBe(password);
    },
  );

  it('replaces in place and appends what is missing, leaving other keys alone', () => {
    const file = tmpEnv('KEEP=1\nA=old\n');
    writeEnvValues(file, { A: 'new', B: '2' });
    expect(fs.readFileSync(file, 'utf8')).toBe('KEEP=1\nA=new\nB=2\n');
  });

  it('creates the file when it is absent', () => {
    const file = tmpEnv();
    writeEnvValues(file, { A: '1' });
    expect(fs.readFileSync(file, 'utf8')).toBe('A=1\n');
  });

  it('does not rewrite the file when nothing changed', () => {
    const file = tmpEnv('A=1\n');
    const before = fs.statSync(file).mtimeMs;
    writeEnvValues(file, { A: '1' });
    expect(fs.statSync(file).mtimeMs).toBe(before);
  });
});
