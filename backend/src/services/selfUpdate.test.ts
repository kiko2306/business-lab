import { beforeEach, describe, expect, it, vi } from 'vitest';

const backup = vi.hoisted(() => ({
  runCommand: vi.fn(async (_cmd: string, args: string[]): Promise<string> => {
    // Default fixture: HEAD and origin/main match, nothing to do.
    if (args.includes('rev-parse') && args.includes('HEAD')) return 'abc123\n';
    if (args.includes('rev-parse') && args.includes('origin/main')) return 'abc123\n';
    if (args.includes('rev-list')) return '0\n';
    return '';
  }),
}));
const audit = vi.hoisted(() => ({ writeAuditLog: vi.fn(async () => {}) }));

// A tiny in-memory stand-in for the one table this service touches, so the
// state-machine tests exercise real INSERT/UPDATE/SELECT semantics instead
// of a hand-rolled mock per test.
const db = vi.hoisted(() => {
  interface Row {
    id: number;
    state: string;
    from_commit: string | null;
    to_commit: string | null;
    error_message: string | null;
    started_at: Date;
    finished_at: Date | null;
  }
  const rows: Row[] = [];
  let nextId = 1;
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('CREATE TABLE')) return { rows: [] };
    if (sql.startsWith('INSERT')) {
      const row: Row = {
        id: nextId++,
        state: params[0] as string,
        from_commit: (params[1] as string | null) ?? null,
        to_commit: null,
        error_message: null,
        started_at: new Date(),
        finished_at: null,
      };
      rows.push(row);
      return { rows: [row] };
    }
    if (sql.startsWith('UPDATE')) {
      const [id, state, toCommit, errorMessage, finished] = params as [number, string | null, string | null, string | null, boolean];
      const row = rows.find((r) => r.id === id);
      if (row) {
        if (state) row.state = state;
        if (toCommit) row.to_commit = toCommit;
        if (errorMessage) row.error_message = errorMessage;
        if (finished) row.finished_at = new Date();
      }
      return { rows: [] };
    }
    if (sql.includes('ORDER BY id DESC LIMIT 1')) {
      const row = rows[rows.length - 1];
      return { rows: row ? [row] : [] };
    }
    return { rows: [] };
  });
  return { query, rows, reset: () => { rows.length = 0; nextId = 1; } };
});

const spawnMock = vi.hoisted(() => vi.fn((_cmd: string, _args: string[], _opts: unknown) => ({ unref: vi.fn() })));
vi.mock('child_process', () => ({ spawn: spawnMock }));
vi.mock('./backup', () => backup);
vi.mock('../utils/audit', () => audit);
vi.mock('../utils/database', () => ({ query: db.query }));
vi.mock('../utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../version', () => ({ APP_VERSION: '0.24.0' }));

import {
  checkForUpdate,
  getSelfUpdateStatus,
  reconcileDanglingSelfUpdateRun,
  triggerSelfUpdate,
} from './selfUpdate';

// Give runSelfUpdateSequence's fire-and-forget promise a tick to settle.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// A stateful runCommand fixture: HEAD only moves to `remoteCommit` once
// `git pull` actually "runs", the same as the real repo would behave.
function mockAnUpdateFrom(localCommit: string, remoteCommit: string, commitsBehind: number) {
  let head = localCommit;
  backup.runCommand.mockImplementation(async (_cmd: string, args: string[]) => {
    if (args.includes('pull')) {
      head = remoteCommit;
      return '';
    }
    if (args.includes('rev-parse') && args.includes('HEAD')) return `${head}\n`;
    if (args.includes('rev-parse') && args.includes('origin/main')) return `${remoteCommit}\n`;
    if (args.includes('rev-list')) return `${commitsBehind}\n`;
    return '';
  });
}

beforeEach(() => {
  db.reset();
  backup.runCommand.mockReset();
  backup.runCommand.mockImplementation(async (_cmd: string, args: string[]): Promise<string> => {
    if (args.includes('rev-parse') && args.includes('HEAD')) return 'abc123\n';
    if (args.includes('rev-parse') && args.includes('origin/main')) return 'abc123\n';
    if (args.includes('rev-list')) return '0\n';
    return '';
  });
  audit.writeAuditLog.mockClear();
  spawnMock.mockClear();
  process.env.REPO_ROOT = '/repo';
});

describe('checkForUpdate', () => {
  it('reports zero commits behind when HEAD matches origin/main', async () => {
    const check = await checkForUpdate();
    expect(check).toMatchObject({ currentCommit: 'abc123', remoteCommit: 'abc123', commitsBehind: 0 });
  });

  it('reports how many commits behind when they differ', async () => {
    backup.runCommand.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('rev-parse') && args.includes('HEAD')) return 'old111\n';
      if (args.includes('rev-parse') && args.includes('origin/main')) return 'new222\n';
      if (args.includes('rev-list')) return '3\n';
      return '';
    });
    const check = await checkForUpdate();
    expect(check).toMatchObject({ currentCommit: 'old111', remoteCommit: 'new222', commitsBehind: 3 });
  });
});

describe('triggerSelfUpdate', () => {
  it('is a no-op that finishes immediately when already up to date', async () => {
    const run = await triggerSelfUpdate(7);
    await flush();
    const status = await getSelfUpdateStatus();
    expect(status.latestRun).toMatchObject({ id: run.id, state: 'done', toCommit: 'abc123' });
  });

  it('walks pull -> build -> restart-frontend -> restarting_backend on a real update', async () => {
    mockAnUpdateFrom('old111', 'new222', 1);

    await triggerSelfUpdate(7);
    await flush();

    const status = await getSelfUpdateStatus();
    expect(status.latestRun).toMatchObject({ state: 'restarting_backend', fromCommit: 'old111', toCommit: 'new222' });
    expect(status.latestRun?.finishedAt).not.toBeNull();
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'self_update_trigger', metadata: { fromCommit: 'old111', toCommit: 'new222' } })
    );
    // Never a `down` — every compose call is `up -d --build` or `build`.
    const composeCalls = backup.runCommand.mock.calls.filter(([cmd]) => cmd === 'docker');
    expect(composeCalls.length).toBeGreaterThan(0);
    for (const [, args] of composeCalls) {
      expect((args as string[])).not.toContain('down');
    }
    // The final backend recreate is detached, not awaited by runCommand.
    expect(spawnMock).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['up', '-d', '--build', 'backend']),
      expect.objectContaining({ detached: true })
    );
    expect(spawnMock.mock.calls[0][1]).not.toContain('down');
  });

  it('stops with state=error and leaves nothing recreated when the build fails', async () => {
    backup.runCommand.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('rev-parse') && args.includes('HEAD')) return 'old111\n';
      if (args.includes('rev-parse') && args.includes('origin/main')) return 'new222\n';
      if (args.includes('rev-list')) return '1\n';
      if (args.includes('build')) throw new Error('build failed: Dockerfile syntax error');
      return '';
    });

    await triggerSelfUpdate(7);
    await flush();

    const status = await getSelfUpdateStatus();
    expect(status.latestRun).toMatchObject({ state: 'error' });
    expect(status.latestRun?.errorMessage).toContain('build failed');
    const restartCalls = backup.runCommand.mock.calls.filter(
      ([cmd, args]: [string, string[]]) => cmd === 'docker' && args.includes('up')
    );
    expect(restartCalls).toHaveLength(0);
  });

  it('refuses to start a second run while one is still in progress', async () => {
    backup.runCommand.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('rev-parse') && args.includes('HEAD')) return 'old111\n';
      if (args.includes('rev-parse') && args.includes('origin/main')) return 'new222\n';
      if (args.includes('rev-list')) return '1\n';
      if (args.includes('build')) return new Promise(() => {}); // never resolves - still "in progress"
      return '';
    });

    await triggerSelfUpdate(7);
    await expect(triggerSelfUpdate(7)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('reconcileDanglingSelfUpdateRun', () => {
  it('does nothing when there is no run', async () => {
    await expect(reconcileDanglingSelfUpdateRun()).resolves.toBeUndefined();
    expect(audit.writeAuditLog).not.toHaveBeenCalled();
  });

  it('logs completion for a row left in restarting_backend, proving the new process booted', async () => {
    mockAnUpdateFrom('old111', 'new222', 1);
    await triggerSelfUpdate(7);
    await flush();

    await reconcileDanglingSelfUpdateRun();

    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'self_update_complete', metadata: { fromCommit: 'old111', toCommit: 'new222' } })
    );
    const status = await getSelfUpdateStatus();
    expect(status.latestRun?.state).toBe('done');
  });
});
