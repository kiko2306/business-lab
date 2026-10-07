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
    detail: string | null;
    failed_phase: string | null;
    apps_failed: string | null;
    started_at: Date;
    finished_at: Date | null;
  }
  const rows: Row[] = [];
  let nextId = 1;
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('CREATE TABLE') || sql.includes('ALTER TABLE')) return { rows: [] };
    if (sql.startsWith('INSERT')) {
      const row: Row = {
        id: nextId++,
        state: params[0] as string,
        from_commit: (params[1] as string | null) ?? null,
        to_commit: null,
        error_message: null,
        detail: null,
        failed_phase: null,
        apps_failed: null,
        started_at: new Date(),
        finished_at: null,
      };
      rows.push(row);
      return { rows: [row] };
    }
    if (sql.startsWith('UPDATE')) {
      const [id, state, toCommit, errorMessage, detailFlag, detailValue, finished, failedPhase, appsFailed, fromCommit] = params as [
        number,
        string | null,
        string | null,
        string | null,
        boolean,
        string | null,
        boolean,
        string | null,
        string | null,
        string | null,
      ];
      const row = rows.find((r) => r.id === id);
      if (row) {
        if (state) row.state = state;
        if (toCommit) row.to_commit = toCommit;
        if (errorMessage) row.error_message = errorMessage;
        if (detailFlag) row.detail = detailValue;
        if (finished) row.finished_at = new Date();
        if (failedPhase) row.failed_phase = failedPhase;
        if (appsFailed) row.apps_failed = appsFailed;
        if (fromCommit) row.from_commit = fromCommit;
      }
      return { rows: [] };
    }
    if (sql.includes('ORDER BY id DESC LIMIT 1')) {
      const row = rows[rows.length - 1];
      return { rows: row ? [row] : [] };
    }
    return { rows: [] };
  });
  return { query, rows, reset: () => { rows.length = 0; nextId = 1; query.mockClear(); } };
});

const spawnMock = vi.hoisted(() => vi.fn((_cmd: string, _args: string[], _opts: unknown) => ({ unref: vi.fn() })));
vi.mock('child_process', () => ({ spawn: spawnMock }));
vi.mock('./backup', () => backup);
vi.mock('../utils/audit', () => audit);
vi.mock('../utils/database', () => ({ query: db.query }));
vi.mock('../utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../version', () => ({ APP_VERSION: '0.24.0', getAppVersion: () => '0.24.0' }));

// executor.ts pulls in the whole compose-execution/registry dependency graph
// (npmClient, exposure, etc.) — irrelevant here and heavy to load for real,
// so only the one function this module calls is mocked.
interface AppUpdateResult {
  serviceName: string;
  ok: boolean;
  message?: string;
  error?: string;
}
const executor = vi.hoisted(() => ({
  updateAllInstalledApps: vi.fn(
    async (
      _userId: number | null,
      _only?: ReadonlySet<string> | null,
      _onProgress?: (label: string) => Promise<void> | void
    ): Promise<AppUpdateResult[]> => []
  ),
}));
vi.mock('./executor', () => executor);

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
// `changedFiles` is what `git diff --name-only` returns for the pull — []
// (the default) means "diff unavailable", which classifyDeploy treats as
// everything-changed, so the existing full-path tests stay full-path.
function mockAnUpdateFrom(
  localCommit: string,
  remoteCommit: string,
  commitsBehind: number,
  changedFiles: string[] = []
) {
  let head = localCommit;
  backup.runCommand.mockImplementation(async (_cmd: string, args: string[]) => {
    if (args.includes('pull')) {
      head = remoteCommit;
      return '';
    }
    if (args.includes('rev-parse') && args.includes('HEAD')) return `${head}\n`;
    if (args.includes('rev-parse') && args.includes('origin/main')) return `${remoteCommit}\n`;
    if (args.includes('rev-list')) return `${commitsBehind}\n`;
    if (args.includes('diff') && args.includes('--name-only')) return changedFiles.join('\n') + '\n';
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
  executor.updateAllInstalledApps.mockReset();
  executor.updateAllInstalledApps.mockResolvedValue([]);
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

  it('runs git under `umask 002` so a deploy cannot leave .git non-group-writable (§351)', async () => {
    await checkForUpdate();
    const fetchCall = backup.runCommand.mock.calls.find(([, args]) => (args as string[]).includes('fetch'));
    expect(fetchCall?.[0]).toBe('sh');
    expect(fetchCall?.[1]).toEqual(['-c', 'umask 002 && exec git "$@"', 'git', '-C', '/repo', 'fetch', 'origin', 'main', '--quiet']);
  });

  it('records lastCheckError when the fetch fails, and clears it on the next success (§351)', async () => {
    backup.runCommand.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('fetch')) throw new Error('insufficient permission for adding an object to .git/objects');
      if (args.includes('rev-parse')) return 'abc123\n';
      if (args.includes('rev-list')) return '0\n';
      return '';
    });
    await expect(checkForUpdate()).rejects.toThrow(/insufficient permission/);
    expect((await getSelfUpdateStatus()).lastCheckError).toMatchObject({
      message: expect.stringContaining('insufficient permission'),
    });

    backup.runCommand.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('rev-parse') && args.includes('HEAD')) return 'abc123\n';
      if (args.includes('rev-parse') && args.includes('origin/main')) return 'abc123\n';
      if (args.includes('rev-list')) return '0\n';
      return '';
    });
    await checkForUpdate();
    expect((await getSelfUpdateStatus()).lastCheckError).toBeNull();
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
      expect.objectContaining({
        action: 'self_update_trigger',
        metadata: expect.objectContaining({ fromCommit: 'old111', toCommit: 'new222' }),
      })
    );
    // The managed-app update batch ran as part of the same sequence (§209).
    // `null` scope = "diff unavailable, recreate everything" (§343 C).
    expect(executor.updateAllInstalledApps).toHaveBeenCalledWith(7, null, expect.any(Function));
    // Never a `down` — every compose call is `up -d`, `build`, or a prune.
    const composeCalls = backup.runCommand.mock.calls.filter(([cmd]) => cmd === 'docker');
    expect(composeCalls.length).toBeGreaterThan(0);
    for (const [, args] of composeCalls) {
      expect((args as string[])).not.toContain('down');
    }
    // The final backend recreate is detached, not awaited by runCommand.
    // --no-deps (never bounce the DB), --force-recreate + --no-build (adopt the
    // image already built in the `building` phase) — §356.
    expect(spawnMock).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['up', '-d', '--no-deps', '--force-recreate', '--no-build', 'backend']),
      expect.objectContaining({ detached: true })
    );
    expect(spawnMock.mock.calls[0][1]).not.toContain('--build');
    expect(spawnMock.mock.calls[0][1]).not.toContain('down');

    // Same on the frontend restart — --no-deps is load-bearing there: frontend
    // depends_on backend, so without it `up -d frontend` recreates backend
    // first and kills this process mid-sequence (§356).
    const frontendUp = backup.runCommand.mock.calls.find(
      ([cmd, a]) => cmd === 'docker' && (a as string[]).includes('up') && (a as string[]).includes('frontend')
    );
    expect(frontendUp?.[1]).toEqual(
      expect.arrayContaining(['up', '-d', '--no-deps', '--force-recreate', '--no-build', 'frontend'])
    );
  });

  it('creates missing core sidecars after the build, and a failure there does not fail the run', async () => {
    mockAnUpdateFrom('old111', 'new222', 1);
    const base = backup.runCommand.getMockImplementation()!;
    backup.runCommand.mockImplementation(async (cmd, args) => {
      if (args.includes('host-timezone-sync')) throw new Error('boom');
      return base(cmd, args);
    });

    await triggerSelfUpdate(7);
    await flush();

    const sidecarUp = backup.runCommand.mock.calls.find(([, a]) => (a as string[]).includes('host-timezone-sync'));
    expect(sidecarUp?.[1]).toEqual(expect.arrayContaining(['up', '-d', '--no-deps', '--no-build']));
    expect((await getSelfUpdateStatus()).latestRun?.state).toBe('restarting_backend');
  });

  it('refreshes status.check to "up to date" right after the pull, not just latestRun (§551)', async () => {
    mockAnUpdateFrom('old111', 'new222', 1);

    await triggerSelfUpdate(7);
    await flush();

    const status = await getSelfUpdateStatus();
    expect(status.check).toMatchObject({ currentCommit: 'new222', remoteCommit: 'new222', commitsBehind: 0 });
  });

  it('writes a durable "classified" breadcrumb with the resolved scope before building (§354)', async () => {
    mockAnUpdateFrom('old111', 'new222', 1, ['backend/src/routes/services.ts']);

    await triggerSelfUpdate(7);
    await flush();

    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'self_update_trigger',
        metadata: expect.objectContaining({
          phase: 'classified',
          fromCommit: 'old111',
          toCommit: 'new222',
          build: ['backend'],
        }),
      })
    );
  });

  it('a version/docs-only diff is pull-only — no build, no app sweep, no restart', async () => {
    mockAnUpdateFrom('old111', 'new222', 1, ['VERSION', 'CHANGELOG.md', 'README.md', 'plan.md']);

    await triggerSelfUpdate(7);
    await flush();

    const status = await getSelfUpdateStatus();
    expect(status.latestRun).toMatchObject({ state: 'done', toCommit: 'new222' });
    expect(executor.updateAllInstalledApps).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
    const docker = backup.runCommand.mock.calls.filter(([cmd]) => cmd === 'docker').map(([, a]) => (a as string[]).join(' '));
    expect(docker.some((k) => k.startsWith('compose -f') && k.includes('build'))).toBe(false);
    expect(docker.some((k) => k.includes('up -d'))).toBe(false);
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ scope: 'pull-only' }) })
    );
  });

  it('a backend-only diff rebuilds + restarts backend, leaves frontend and apps alone', async () => {
    mockAnUpdateFrom('old111', 'new222', 1, ['backend/src/routes/services.ts']);

    await triggerSelfUpdate(7);
    await flush();

    const status = await getSelfUpdateStatus();
    expect(status.latestRun).toMatchObject({ state: 'restarting_backend' });
    expect(executor.updateAllInstalledApps).not.toHaveBeenCalled();
    const built = backup.runCommand.mock.calls.find(([cmd, a]) => cmd === 'docker' && (a as string[]).includes('build'));
    expect(built?.[1]).toEqual(expect.arrayContaining(['build', 'backend']));
    expect(built?.[1]).not.toContain('frontend');
    // frontend was not restarted
    const frontendUp = backup.runCommand.mock.calls.some(
      ([cmd, a]) => cmd === 'docker' && (a as string[]).includes('up') && (a as string[]).includes('frontend')
    );
    expect(frontendUp).toBe(false);
    expect(spawnMock).toHaveBeenCalledWith('docker', expect.arrayContaining(['up', '-d', 'backend']), expect.anything());
  });

  it('an app-only diff recreates just that app and finishes without a restart', async () => {
    mockAnUpdateFrom('old111', 'new222', 1, ['apps/mealie/docker-compose.yml', 'apps/mealie/.env.example']);

    await triggerSelfUpdate(7);
    await flush();

    const status = await getSelfUpdateStatus();
    expect(status.latestRun).toMatchObject({ state: 'done', toCommit: 'new222' });
    expect(executor.updateAllInstalledApps).toHaveBeenCalledWith(7, new Set(['mealie']), expect.any(Function));
    expect(spawnMock).not.toHaveBeenCalled();
    const built = backup.runCommand.mock.calls.some(([cmd, a]) => cmd === 'docker' && (a as string[]).includes('build'));
    expect(built).toBe(false);
  });

  it('a frontend-only diff rebuilds + restarts frontend and finishes without a backend restart', async () => {
    mockAnUpdateFrom('old111', 'new222', 1, ['frontend/src/app/shell.component.ts']);

    await triggerSelfUpdate(7);
    await flush();

    const status = await getSelfUpdateStatus();
    expect(status.latestRun).toMatchObject({ state: 'done' });
    expect(spawnMock).not.toHaveBeenCalled();
    const frontendUp = backup.runCommand.mock.calls.some(
      ([cmd, a]) => cmd === 'docker' && (a as string[]).includes('up') && (a as string[]).includes('frontend')
    );
    expect(frontendUp).toBe(true);
  });

  it.each(['frontend/nginx.conf', 'frontend/public/sw.js', 'frontend/40-real-ip-from-gateway.sh'])(
    'a change to only %s (COPYed into the image) still rebuilds the frontend',
    async (file) => {
      mockAnUpdateFrom('old111', 'new222', 1, [file]);

      await triggerSelfUpdate(7);
      await flush();

      const built = backup.runCommand.mock.calls.some(
        ([cmd, a]) => cmd === 'docker' && (a as string[]).includes('build') && (a as string[]).includes('frontend')
      );
      expect(built).toBe(true);
    }
  );

  it('a change to only backend/docker-entrypoint.sh (COPYed into the image) still rebuilds the backend', async () => {
    mockAnUpdateFrom('old111', 'new222', 1, ['backend/docker-entrypoint.sh']);

    await triggerSelfUpdate(7);
    await flush();

    const built = backup.runCommand.mock.calls.some(
      ([cmd, a]) => cmd === 'docker' && (a as string[]).includes('build') && (a as string[]).includes('backend')
    );
    expect(built).toBe(true);
  });

  it('continues past a failed app update and records the summary in the audit metadata', async () => {
    mockAnUpdateFrom('old111', 'new222', 1);
    executor.updateAllInstalledApps.mockResolvedValue([
      { serviceName: 'nextcloud', ok: true },
      { serviceName: 'guacamole', ok: false, error: 'pull failed' },
    ]);

    await triggerSelfUpdate(7);
    await flush();

    const status = await getSelfUpdateStatus();
    expect(status.latestRun).toMatchObject({ state: 'restarting_backend' });
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'self_update_trigger',
        metadata: expect.objectContaining({ appsUpdated: 1, appsFailed: ['guacamole'] }),
      })
    );
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

  // plan.md §835: the page said "Last update failed: <raw stderr>" and nothing
  // about the box. What the box is left in depends on how far the run got, so
  // the run now records the phase it stopped in.
  describe('what a failed run records (plan.md §835)', () => {
    const failAt = (what: 'fetch' | 'pull' | 'build') =>
      backup.runCommand.mockImplementation(async (_cmd: string, args: string[]) => {
        if (args.includes('rev-parse') && args.includes('HEAD')) return 'old111\n';
        if (args.includes('rev-parse') && args.includes('origin/main')) return 'new222\n';
        if (args.includes('rev-list')) return '1\n';
        if (what === 'fetch' && args.includes('fetch')) throw new Error('fatal: unable to access');
        if (what === 'pull' && args.includes('pull')) throw new Error('would be overwritten by merge');
        if (what === 'build' && args.includes('build')) throw new Error('build failed');
        return '';
      });

    for (const [what, phase] of [['fetch', 'checking'], ['pull', 'pulling'], ['build', 'building']] as const) {
      it(`names ${phase} when the run fails there`, async () => {
        failAt(what);
        await triggerSelfUpdate(7);
        await flush();

        expect((await getSelfUpdateStatus()).latestRun).toMatchObject({ state: 'error', failedPhase: phase });
      });
    }

    it('names no phase for a run that did not fail', async () => {
      mockAnUpdateFrom('old111', 'new222', 1);
      await triggerSelfUpdate(7);
      await flush();

      expect((await getSelfUpdateStatus()).latestRun?.failedPhase).toBeNull();
    });

    it('records the apps that failed to update on the run, which still lands', async () => {
      mockAnUpdateFrom('old111', 'new222', 1, ['apps/guacamole/docker-compose.yml']);
      executor.updateAllInstalledApps.mockResolvedValue([
        { serviceName: 'nextcloud', ok: true },
        { serviceName: 'guacamole', ok: false, error: 'pull failed' },
      ]);
      await triggerSelfUpdate(7);
      await flush();

      expect((await getSelfUpdateStatus()).latestRun).toMatchObject({ state: 'done', appsFailed: ['guacamole'] });
    });

    it('reports no failed apps as an empty list, never null', async () => {
      mockAnUpdateFrom('old111', 'new222', 1);
      await triggerSelfUpdate(7);
      await flush();

      expect((await getSelfUpdateStatus()).latestRun?.appsFailed).toEqual([]);
    });
  });

  // The pull lands before the build, so after a failed build HEAD *is* the
  // remote and the next run found "0 commits behind" and ended `done` without
  // rebuilding anything: the box stayed on the old image while the page read
  // "Up to date" (plan.md §835). A retry has to resume from the failed run.
  describe('retrying after a failure past the pull (plan.md §835)', () => {
    function buildThatFailsOnce(changedFiles: string[]) {
      let head = 'old111';
      let buildFails = true;
      backup.runCommand.mockImplementation(async (_cmd: string, args: string[]) => {
        if (args.includes('pull')) {
          head = 'new222';
          return '';
        }
        if (args.includes('rev-parse') && args.includes('HEAD')) return `${head}\n`;
        if (args.includes('rev-parse') && args.includes('origin/main')) return 'new222\n';
        if (args.includes('rev-list')) return head === 'new222' ? '0\n' : '1\n';
        if (args.includes('diff') && args.includes('--name-only')) return changedFiles.join('\n') + '\n';
        if (args.includes('build') && buildFails) throw new Error('build failed');
        return '';
      });
      return { fixBuild: () => (buildFails = false) };
    }
    const calls = (word: string) => backup.runCommand.mock.calls.filter(([, args]: [string, string[]]) => args.includes(word));

    it('rebuilds from the failed run\'s starting commit instead of reporting up to date', async () => {
      const { fixBuild } = buildThatFailsOnce(['backend/src/index.ts']);
      await triggerSelfUpdate(7);
      await flush();
      expect((await getSelfUpdateStatus()).latestRun).toMatchObject({ state: 'error', failedPhase: 'building' });

      fixBuild();
      backup.runCommand.mockClear();
      await triggerSelfUpdate(7);
      await flush();

      expect(calls('build').length).toBeGreaterThan(0);
      expect(calls('pull')).toHaveLength(0);
      expect(calls('diff')[0][1]).toContain('old111..new222');
      expect((await getSelfUpdateStatus()).latestRun).toMatchObject({ state: 'restarting_backend', fromCommit: 'old111' });
    });

    it('does not resume a run that failed before the pull: nothing was downloaded', async () => {
      backup.runCommand.mockImplementation(async (_cmd: string, args: string[]) => {
        if (args.includes('fetch')) throw new Error('offline');
        if (args.includes('rev-parse') && args.includes('HEAD')) return 'abc123\n';
        return '';
      });
      await triggerSelfUpdate(7);
      await flush();

      mockAnUpdateFrom('abc123', 'abc123', 0);
      backup.runCommand.mockClear();
      await triggerSelfUpdate(7);
      await flush();

      expect(calls('build')).toHaveLength(0);
      expect((await getSelfUpdateStatus()).latestRun).toMatchObject({ state: 'done' });
    });

    it('stops resuming once the retry has succeeded', async () => {
      const { fixBuild } = buildThatFailsOnce(['backend/src/index.ts']);
      await triggerSelfUpdate(7);
      await flush();
      fixBuild();
      await triggerSelfUpdate(7);
      await flush();
      // The backend restart row is finished; a third press is a plain "up to date".
      backup.runCommand.mockClear();
      await triggerSelfUpdate(7);
      await flush();

      expect(calls('build')).toHaveLength(0);
    });
  });

  // A run where some apps failed still lands (`done`, appsFailed set) and HEAD is then the remote, so
  // "Update now" found nothing behind and never retried them (plan.md §835, README item).
  describe('retrying apps that failed to update', () => {
    const calls = (word: string) => backup.runCommand.mock.calls.filter(([, args]: [string, string[]]) => args.includes(word));

    async function landWithFailedApp() {
      let head = 'old111';
      backup.runCommand.mockImplementation(async (_cmd: string, args: string[]) => {
        if (args.includes('pull')) {
          head = 'new222';
          return '';
        }
        if (args.includes('rev-parse') && args.includes('HEAD')) return `${head}\n`;
        if (args.includes('rev-parse') && args.includes('origin/main')) return 'new222\n';
        if (args.includes('rev-list')) return head === 'new222' ? '0\n' : '1\n';
        if (args.includes('diff') && args.includes('--name-only')) return 'apps/mealie/docker-compose.yml\n';
        return '';
      });
      executor.updateAllInstalledApps.mockResolvedValueOnce([{ serviceName: 'mealie', ok: false, error: 'pull failed' }]);
      await triggerSelfUpdate(7);
      await flush();
      expect((await getSelfUpdateStatus()).latestRun).toMatchObject({ state: 'done', appsFailed: ['mealie'] });
    }

    it('re-runs only the failed apps when Update now is pressed with nothing behind', async () => {
      await landWithFailedApp();
      executor.updateAllInstalledApps.mockClear();
      executor.updateAllInstalledApps.mockResolvedValueOnce([{ serviceName: 'mealie', ok: true }]);
      backup.runCommand.mockClear();

      await triggerSelfUpdate(7);
      await flush();

      expect(executor.updateAllInstalledApps).toHaveBeenCalledWith(7, new Set(['mealie']), expect.any(Function));
      expect(calls('build')).toHaveLength(0);
      expect(calls('pull')).toHaveLength(0);
      expect((await getSelfUpdateStatus()).latestRun).toMatchObject({ state: 'done', appsFailed: [] });
    });

    it('keeps the app listed when it fails again, and stops retrying once it works', async () => {
      await landWithFailedApp();
      executor.updateAllInstalledApps.mockClear();
      executor.updateAllInstalledApps.mockResolvedValueOnce([{ serviceName: 'mealie', ok: false, error: 'still broken' }]);
      await triggerSelfUpdate(7);
      await flush();
      expect((await getSelfUpdateStatus()).latestRun).toMatchObject({ state: 'done', appsFailed: ['mealie'] });

      executor.updateAllInstalledApps.mockResolvedValueOnce([{ serviceName: 'mealie', ok: true }]);
      await triggerSelfUpdate(7);
      await flush();
      executor.updateAllInstalledApps.mockClear();
      await triggerSelfUpdate(7);
      await flush();
      expect(executor.updateAllInstalledApps).not.toHaveBeenCalled();
    });
  });

  it('prunes dangling images and build cache after the build and after updating apps', async () => {
    mockAnUpdateFrom('old111', 'new222', 1);

    await triggerSelfUpdate(7);
    await flush();

    const pruneCalls = backup.runCommand.mock.calls.filter(([cmd]) => cmd === 'docker') as [string, string[]][];
    const kinds = pruneCalls.map(([, args]) => args.join(' '));
    expect(kinds).toContain('image prune -f');
    expect(kinds).toContain('builder prune -f');
    // Runs after `build` and again after the app-update batch, both times
    // strictly before the frontend/backend restart that follows.
    const buildIdx = kinds.findIndex((k) => k.startsWith('compose -f') && k.includes('build'));
    const firstPruneIdx = kinds.findIndex((k) => k === 'image prune -f');
    const restartFrontendIdx = kinds.findIndex((k) => k.includes('up -d') && k.includes('frontend'));
    expect(firstPruneIdx).toBeGreaterThan(buildIdx);
    expect(restartFrontendIdx).toBeGreaterThan(firstPruneIdx);
  });

  it('does not let a failed prune block the update sequence', async () => {
    mockAnUpdateFrom('old111', 'new222', 1);
    backup.runCommand.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('pull')) return '';
      if (args.includes('rev-parse') && args.includes('HEAD')) return 'old111\n';
      if (args.includes('rev-parse') && args.includes('origin/main')) return 'new222\n';
      if (args.includes('rev-list')) return '1\n';
      if (args.includes('prune')) throw new Error('docker daemon unreachable');
      return '';
    });

    await triggerSelfUpdate(7);
    await flush();

    const status = await getSelfUpdateStatus();
    expect(status.latestRun).toMatchObject({ state: 'restarting_backend' });
  });

  it('reports which image is building and which app is recreating via `detail`, clearing it after each phase', async () => {
    mockAnUpdateFrom('old111', 'new222', 1);
    executor.updateAllInstalledApps.mockImplementation(async (_userId, _only, onProgress) => {
      await onProgress?.('mealie (1/2)');
      await onProgress?.('paperless (2/2)');
      return [];
    });

    await triggerSelfUpdate(7);
    await flush();

    const detailUpdates = db.query.mock.calls
      .filter(([sql, params]) => (sql as string).startsWith('UPDATE') && (params as unknown[])[4])
      .map(([, params]) => (params as unknown[])[5] as string | null);
    expect(detailUpdates).toEqual(['frontend', 'backend', null, 'mealie (1/2)', 'paperless (2/2)', null]);
  });

  it('creates a `checking` row before any network call, so a slow/unreachable remote is visible instead of stalling the trigger', async () => {
    backup.runCommand.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('fetch')) return new Promise(() => {}); // never resolves
      if (args.includes('rev-parse') && args.includes('HEAD')) return 'abc123\n';
      return '';
    });

    const run = await triggerSelfUpdate(7);

    expect(run).toMatchObject({ state: 'checking', fromCommit: 'abc123' });
    const status = await getSelfUpdateStatus();
    expect(status.latestRun).toMatchObject({ state: 'checking', fromCommit: 'abc123' });
  });

  it('lands a fetch failure inside the sequence as an `error` row, not a thrown rejection', async () => {
    backup.runCommand.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('rev-parse') && args.includes('HEAD')) return 'abc123\n';
      if (args.includes('fetch')) throw new Error('could not resolve host');
      return '';
    });

    await triggerSelfUpdate(7);
    await flush();

    const status = await getSelfUpdateStatus();
    expect(status.latestRun).toMatchObject({ state: 'error' });
    expect(status.latestRun?.errorMessage).toContain('could not resolve host');
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

  it('completes a row dangling in an earlier state (e.g. restarting_frontend) when the running commit already matches', async () => {
    // Reproduces plan.md §295 live: backend's own detached self-replacement
    // was killed by something unrelated before it ever reached
    // restarting_backend, but the target commit was already running by the
    // time this process (or a human) got things going again.
    mockAnUpdateFrom('old111', 'new222', 1);
    await triggerSelfUpdate(7);
    await flush();
    db.rows[db.rows.length - 1].state = 'restarting_frontend';

    await reconcileDanglingSelfUpdateRun();

    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'self_update_complete', metadata: { fromCommit: 'old111', toCommit: 'new222' } })
    );
    const status = await getSelfUpdateStatus();
    expect(status.latestRun?.state).toBe('done');
  });

  it('marks a dangling run as failed rather than leaving it stuck when the running commit never reached the target', async () => {
    mockAnUpdateFrom('old111', 'new222', 1);
    await triggerSelfUpdate(7);
    await flush();
    const row = db.rows[db.rows.length - 1];
    row.state = 'restarting_frontend';
    // Simulate the process that boots afterward never actually landing on
    // the target commit (crashed and came back on the old one, a host
    // reboot, etc.) — HEAD stays at the pre-update commit.
    backup.runCommand.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('rev-parse') && args.includes('HEAD')) return 'old111\n';
      return '';
    });

    await reconcileDanglingSelfUpdateRun();

    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'self_update_reconcile_failed' })
    );
    const status = await getSelfUpdateStatus();
    expect(status.latestRun?.state).toBe('error');
    expect(status.latestRun?.errorMessage).toMatch(/did not complete/);
  });
});
