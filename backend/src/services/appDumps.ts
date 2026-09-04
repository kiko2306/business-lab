/**
 * Makes app data safe to back up, by dumping every database to a file first.
 *
 * A file-level backup of `apps/` taken while things are running is not a
 * backup of the databases in it. Postgres and MariaDB write continuously, and
 * SQLite keeps a separate write-ahead log — copying those files mid-write can
 * restore to a torn or unreadable state, and nothing reports it until the day
 * you try to use the backup.
 *
 * So each database is dumped into `apps/<app>/data/_dump/` first, and the file
 * backup then picks up a consistent snapshot alongside the live files.
 *
 * Two deliberate choices:
 *
 *   - **Credentials are read from the running container**, not declared here.
 *     `docker inspect` already knows POSTGRES_USER and friends, so a password
 *     rotated in the dashboard cannot leave a stale copy in this file.
 *   - **SQLite is discovered, not declared.** Fourteen apps embed one, several
 *     in paths nobody would think to list. Scanning for the file header finds
 *     them all — including any app added later.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { SERVICES, getAppsDir } from '../config/services';
import logger from '../utils/logger';

/** Where dumps land, inside each app's own data directory. */
const DUMP_DIR = '_dump';

const DUMP_TIMEOUT_MS = 10 * 60 * 1000;

export interface DumpOutcome {
  app: string;
  kind: 'postgres' | 'mariadb' | 'mysql' | 'sqlite';
  target: string;
  ok: boolean;
  detail: string;
  bytes?: number;
}

function run(command: string, args: string[], timeoutMs = DUMP_TIMEOUT_MS): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args);
    const chunks: Buffer[] = [];
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: Buffer.concat(chunks), stderr: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout: Buffer.concat(chunks), stderr });
    });
  });
}

/** Find a running container by its compose project and service labels. */
async function findContainer(project: string, service: string): Promise<string | null> {
  const result = await run('docker', [
    'ps', '-q',
    '-f', `label=com.docker.compose.project=${project}`,
    '-f', `label=com.docker.compose.service=${service}`,
  ], 15_000);
  const id = result.stdout.toString().trim().split('\n')[0];
  return id || null;
}

/**
 * The container's environment, image and network.
 *
 * All three come from the container itself rather than from declarations here:
 * the credentials so a rotated password cannot go stale, and the image so the
 * dump runs the *same* client version as the server — pg_dump refuses to dump
 * a newer server, and this stack runs Postgres 14, 15 and 16 side by side.
 */
async function inspectDb(containerId: string): Promise<{ env: Record<string, string>; image: string; network: string }> {
  const result = await run(
    'docker',
    ['inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}IMAGE={{.Config.Image}}\nNETWORK={{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}', containerId],
    15_000
  );
  const env: Record<string, string> = {};
  let image = '';
  let network = '';
  for (const line of result.stdout.toString().split('\n')) {
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx);
    const value = line.slice(idx + 1);
    if (key === 'IMAGE') image = value.trim();
    else if (key === 'NETWORK') network = value.trim().split(/\s+/)[0] ?? '';
    else env[key] = value;
  }
  return { env, image, network };
}

function ensureDumpDir(appDir: string): string {
  const dir = path.join(appDir, 'data', DUMP_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Write a dump, but only replace the previous one once the new one succeeded.
 *
 * Writing straight to the final path would destroy the last good dump the
 * moment a dump starts failing — so a broken database would quietly take the
 * backup with it.
 */
function commitDump(finalPath: string, data: Buffer): number {
  const tmp = `${finalPath}.part`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, finalPath);
  return data.length;
}

async function dumpServerDatabase(
  app: string,
  service: string,
  engine: 'postgres' | 'mariadb' | 'mysql',
  appDir: string
): Promise<DumpOutcome> {
  const base: DumpOutcome = { app, kind: engine, target: '', ok: false, detail: '' };

  const container = await findContainer(app, service);
  if (!container) {
    // Not an error: an app that is stopped has nothing to dump, and failing
    // here would make every backup "fail" because one app is off.
    return { ...base, ok: true, detail: 'not running — skipped' };
  }

  const { env, image, network } = await inspectDb(container);
  const dumpPath = path.join(ensureDumpDir(appDir), `${app}.sql`);
  base.target = dumpPath;

  if (!network) {
    return { ...base, ok: false, detail: 'the database container is not on a reachable network' };
  }

  // `docker exec` is deliberately NOT used: the backend reaches Docker through
  // docker-socket-proxy, whose allowlist omits EXEC because it is effectively
  // arbitrary code execution in another container. Creating a throwaway
  // container is permitted (CONTAINERS/POST/ALLOW_START), does the same job,
  // and keeps that restriction intact — weakening the proxy for convenience
  // would be trading a real security boundary for a shortcut.
  //
  // The dump runs from the SAME image as the server, so client and server
  // versions always match.
  let args: string[];
  if (engine === 'postgres') {
    const user = env.POSTGRES_USER || 'postgres';
    const db = env.POSTGRES_DB || user;
    args = ['run', '--rm', '--network', network, '-e', `PGPASSWORD=${env.POSTGRES_PASSWORD ?? ''}`,
            // --entrypoint, not just a command: several images here wrap their
            // entrypoint in an init system (LSIO's /init under s6) that starts
            // services and never runs the argument, so the dump hangs forever
            // instead of failing. Overriding the entrypoint runs the binary
            // directly whatever the image does.
            '--entrypoint', 'pg_dump', image,
            // --clean --if-exists so the dump replays over an existing database
            // during a restore instead of erroring on every object.
            '--no-owner', '--no-privileges', '--clean', '--if-exists',
            '-h', service, '-U', user, db];
  } else {
    const user = env.MARIADB_USER || env.MYSQL_USER || 'root';
    const password = env.MARIADB_PASSWORD || env.MYSQL_PASSWORD || env.MARIADB_ROOT_PASSWORD || env.MYSQL_ROOT_PASSWORD || '';
    const db = env.MARIADB_DATABASE || env.MYSQL_DATABASE || '';
    if (!db) {
      return { ...base, ok: false, detail: 'could not determine the database name from the container' };
    }
    args = ['run', '--rm', '--network', network, '-e', `MYSQL_PWD=${password}`,
            '--entrypoint', 'mysqldump', image,
            // --single-transaction takes a consistent snapshot without locking
            // the app out for the duration.
            '--single-transaction', '--quick', '--no-tablespaces',
            '-h', service, '-u', user, db];
  }

  const result = await run('docker', args);
  if (result.code !== 0 || result.stdout.length === 0) {
    return { ...base, ok: false, detail: (result.stderr || 'dump produced no output').trim().slice(0, 300) };
  }

  const bytes = commitDump(dumpPath, result.stdout);
  return { ...base, ok: true, bytes, detail: `dumped ${(bytes / 1024).toFixed(0)} KB` };
}

/** SQLite files, found by header rather than by extension. Exported for tests. */
export function findSqliteFiles(appsDir: string): { app: string; file: string }[] {
  const found: { app: string; file: string }[] = [];
  const header = Buffer.from('SQLite format 3');

  const walk = (dir: string, app: string, depth: number): void => {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable app data (root-owned volumes) is not our business
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === DUMP_DIR || entry.name === 'node_modules') continue;
        walk(full, app, depth + 1);
      } else if (entry.isFile() && /\.(db|sqlite3?|sqlite)$/i.test(entry.name)) {
        try {
          const fd = fs.openSync(full, 'r');
          const buf = Buffer.alloc(15);
          fs.readSync(fd, buf, 0, 15, 0);
          fs.closeSync(fd);
          // Several apps use a .db extension for BoltDB or H2, which this
          // check rejects — copying those as SQLite would silently produce
          // garbage.
          if (buf.equals(header)) found.push({ app, file: full });
        } catch {
          /* skip */
        }
      }
    }
  };

  for (const app of Object.keys(SERVICES)) {
    const dataDir = path.join(appsDir, app, 'data');
    if (fs.existsSync(dataDir)) walk(dataDir, app, 0);
  }
  return found;
}

/**
 * Snapshot every SQLite database in ONE container run.
 *
 * `.backup` is used rather than a file copy because it is safe against a live
 * writer: a plain copy can catch a partial transaction and misses the
 * write-ahead log entirely.
 *
 * Batched deliberately. A container per file meant fourteen `apk add sqlite`
 * installs — minutes of work to copy a few megabytes, every backup. One
 * container mounts the whole apps/ tree and loops instead.
 */
async function dumpSqliteBatch(files: { app: string; file: string }[], appsDir: string): Promise<DumpOutcome[]> {
  if (files.length === 0) return [];

  // Build the loop as app<TAB>relative-path lines, so the shell side needs no
  // quoting gymnastics for paths containing spaces.
  const lines = files
    .map(({ app, file }) => {
      const rel = path.relative(appsDir, file);
      const name = path.basename(file).replace(/\.(db|sqlite3?|sqlite)$/i, '');
      return `${app}\t${rel}\t${name}`;
    })
    .join('\n');

  const script = `
apk add --no-cache sqlite >/dev/null 2>&1 || exit 90
printf '%s\n' "$SQLITE_JOBS" | while IFS="$(printf '\t')" read -r app rel name; do
  [ -n "$app" ] || continue
  mkdir -p "/apps/$app/data/${DUMP_DIR}"
  out="/apps/$app/data/${DUMP_DIR}/$name.sqlite"
  if sqlite3 "/apps/$rel" ".backup '$out.part'" 2>/dev/null && mv "$out.part" "$out"; then
    echo "OK\t$app\t$name"
  else
    echo "FAIL\t$app\t$name"
  fi
done`;

  const result = await run('docker', [
    'run', '--rm',
    '-e', `SQLITE_JOBS=${lines}`,
    '-v', `${appsDir}:/apps`,
    'alpine:latest', 'sh', '-c', script,
  ]);

  if (result.code === 90) {
    return files.map(({ app, file }) => ({
      app, kind: 'sqlite' as const, target: file, ok: false,
      detail: 'could not install sqlite in the helper container (no network?)',
    }));
  }

  const reported = new Map<string, boolean>();
  for (const line of result.stdout.toString().split('\n')) {
    const [status, app, name] = line.split('\t');
    if (status === 'OK' || status === 'FAIL') reported.set(`${app}/${name}`, status === 'OK');
  }

  return files.map(({ app, file }) => {
    const name = path.basename(file).replace(/\.(db|sqlite3?|sqlite)$/i, '');
    const outPath = path.join(appsDir, app, 'data', DUMP_DIR, `${name}.sqlite`);
    const ok = reported.get(`${app}/${name}`);
    if (ok === undefined) {
      return { app, kind: 'sqlite' as const, target: outPath, ok: false, detail: 'no result reported by the helper' };
    }
    let bytes: number | undefined;
    try {
      bytes = fs.statSync(outPath).size;
    } catch {
      /* written as root; size is a nicety */
    }
    return {
      app, kind: 'sqlite' as const, target: outPath, ok, bytes,
      detail: ok ? (bytes ? `snapshot ${(bytes / 1024).toFixed(0)} KB` : 'snapshot written') : 'sqlite .backup failed',
    };
  });
}

export interface DumpReport {
  outcomes: DumpOutcome[];
  ok: number;
  failed: number;
}

/**
 * Dump every app database. Never throws — one broken app must not stop the
 * rest being made safe.
 */
export async function dumpAllAppDatabases(): Promise<DumpReport> {
  const appsDir = getAppsDir();
  const outcomes: DumpOutcome[] = [];

  for (const [name, definition] of Object.entries(SERVICES)) {
    const backup = definition.backup;
    if (!backup) continue;
    const appDir = path.join(appsDir, name);
    try {
      outcomes.push(await dumpServerDatabase(name, backup.service, backup.engine, appDir));
    } catch (error) {
      outcomes.push({ app: name, kind: backup.engine, target: '', ok: false, detail: (error as Error).message });
    }
  }

  try {
    outcomes.push(...(await dumpSqliteBatch(findSqliteFiles(appsDir), appsDir)));
  } catch (error) {
    logger.error('SQLite snapshot batch failed', { error: (error as Error).message });
  }

  const ok = outcomes.filter((o) => o.ok).length;
  const failed = outcomes.length - ok;
  logger.info('App database dump finished', { ok, failed });
  return { outcomes, ok, failed };
}

/**
 * Dump one app's database(s) — the server DB if it has one, plus any SQLite
 * files under its data dir — into `apps/<name>/data/_dump/`. The per-app
 * counterpart of `dumpAllAppDatabases`, for the per-app backup archive
 * (services/appBackup.ts, plan.md §185).
 *
 * Same never-throws contract: an unreachable database yields a failed
 * `DumpOutcome`, not an exception, so the archive step can still capture the
 * rest of the app's data. An unknown name, or one with no server DB and no
 * SQLite, returns an empty report.
 */
export async function dumpOneApp(name: string): Promise<DumpReport> {
  const definition = SERVICES[name];
  const appsDir = getAppsDir();
  const outcomes: DumpOutcome[] = [];

  if (definition?.backup) {
    const { service, engine } = definition.backup;
    const appDir = path.join(appsDir, name);
    try {
      outcomes.push(await dumpServerDatabase(name, service, engine, appDir));
    } catch (error) {
      outcomes.push({ app: name, kind: engine, target: '', ok: false, detail: (error as Error).message });
    }
  }

  if (definition) {
    try {
      const files = findSqliteFiles(appsDir).filter((f) => f.app === name);
      outcomes.push(...(await dumpSqliteBatch(files, appsDir)));
    } catch (error) {
      logger.error('SQLite snapshot failed', { app: name, error: (error as Error).message });
    }
  }

  const ok = outcomes.filter((o) => o.ok).length;
  const failed = outcomes.length - ok;
  logger.info('Per-app database dump finished', { app: name, ok, failed });
  return { outcomes, ok, failed };
}

/**
 * Replay `apps/<name>/data/_dump/<name>.sql` back into the app's server
 * database — the server-DB half of a per-app restore (services/appBackup.ts,
 * plan.md §185 slice 3). SQLite is handled by the file restore itself
 * (the consistent `.sqlite` snapshot copied over the live file).
 *
 * Mirrors `dumpServerDatabase`: a throwaway container on the same image and
 * network as the DB, credentials read from the running container. The DB
 * container must already be up — the caller brings it up alone before the
 * rest of the app. Postgres replays with `psql -f` (the dump carries
 * `--clean --if-exists`, so it drops and recreates over the existing
 * database); MySQL/MariaDB pipe the file into the client.
 *
 * Never throws: returns a failed `DumpOutcome` so the caller can still bring
 * the app back up and report what did not restore.
 */
export async function restoreServerDatabase(name: string): Promise<DumpOutcome> {
  const definition = SERVICES[name];
  const base: DumpOutcome = {
    app: name,
    kind: definition?.backup?.engine ?? 'postgres',
    target: '',
    ok: false,
    detail: '',
  };
  if (!definition?.backup) {
    return { ...base, ok: true, detail: 'no server database — nothing to replay' };
  }

  const { service, engine } = definition.backup;
  const dumpPath = path.join(getAppsDir(), name, 'data', DUMP_DIR, `${name}.sql`);
  base.target = dumpPath;
  if (!fs.existsSync(dumpPath)) {
    return { ...base, ok: false, detail: 'the archive has no _dump/<name>.sql to replay' };
  }

  const container = await findContainer(name, service);
  if (!container) {
    return { ...base, ok: false, detail: `${service} is not running; cannot replay the dump` };
  }
  const { env, image, network } = await inspectDb(container);
  if (!network) {
    return { ...base, ok: false, detail: 'the database container is not on a reachable network' };
  }

  let args: string[];
  if (engine === 'postgres') {
    const user = env.POSTGRES_USER || 'postgres';
    const db = env.POSTGRES_DB || user;
    args = [
      'run', '--rm', '--network', network,
      '-e', `PGPASSWORD=${env.POSTGRES_PASSWORD ?? ''}`,
      '-v', `${dumpPath}:/restore.sql:ro`,
      // --entrypoint psql for the same reason dumpServerDatabase overrides it:
      // several images wrap the entrypoint in an init system that never runs
      // the argument.
      '--entrypoint', 'psql', image,
      '-h', service, '-U', user,
      // Keep going on individual errors — a fresh target has nothing for the
      // DROPs to remove, exactly like the restore proof in §183.
      '-v', 'ON_ERROR_STOP=0',
      '-f', '/restore.sql', db,
    ];
  } else {
    const user = env.MARIADB_USER || env.MYSQL_USER || 'root';
    const password =
      env.MARIADB_PASSWORD || env.MYSQL_PASSWORD || env.MARIADB_ROOT_PASSWORD || env.MYSQL_ROOT_PASSWORD || '';
    const db = env.MARIADB_DATABASE || env.MYSQL_DATABASE || '';
    if (!db) {
      return { ...base, ok: false, detail: 'could not determine the database name from the container' };
    }
    args = [
      'run', '--rm', '--network', network,
      '-e', `MYSQL_PWD=${password}`,
      '-e', `RH=${service}`, '-e', `RU=${user}`, '-e', `RD=${db}`,
      '-v', `${dumpPath}:/restore.sql:ro`,
      '--entrypoint', 'sh', image,
      // `mysql` in mysql:8, `mariadb` in current MariaDB images (the `mysql`
      // compat symlink is gone in 11.x). The client reads the dump from stdin.
      '-c', 'if command -v mariadb >/dev/null 2>&1; then M=mariadb; else M=mysql; fi; exec "$M" -h "$RH" -u "$RU" "$RD" < /restore.sql',
    ];
  }

  const result = await run('docker', args);
  if (result.code !== 0) {
    return { ...base, ok: false, detail: (result.stderr || 'the replay produced an error').trim().slice(0, 300) };
  }
  return { ...base, ok: true, detail: 'database replayed from the dump' };
}
