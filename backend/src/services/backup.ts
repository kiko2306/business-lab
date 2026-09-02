import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile, ExecFileOptions } from 'child_process';
import { query } from '../utils/database';

export const BACKUP_DIR = path.join(process.cwd(), 'backups');

export const BACKUP_SCHEDULE_SETTINGS_KEYS = {
  enabled: 'backup_schedule_enabled',
  frequency: 'backup_schedule_frequency',
  retentionCount: 'backup_schedule_retention_count',
  lastRunAt: 'backup_schedule_last_run_at',
  // What the last run actually did. Without these, a run that ticked and a run
  // that worked are the same row (§86.2).
  lastOutcome: 'backup_schedule_last_outcome',
  lastSuccessAt: 'backup_schedule_last_success_at',
  consecutiveFailures: 'backup_schedule_consecutive_failures',
} as const;

export type BackupScheduleFrequency = 'daily' | 'weekly';
export type BackupRunOutcome = 'success' | 'failed';

export interface BackupScheduleConfig {
  enabled: boolean;
  frequency: BackupScheduleFrequency;
  retentionCount: number;
  /** When the schedule last *attempted* a run. Drives the cadence. */
  lastRunAt: string | null;
  lastOutcome: BackupRunOutcome | null;
  /**
   * When a run last succeeded end to end. This is the one worth alarming on:
   * "last run was an hour ago" is reassuring and can be true while nothing has
   * been backed up for a week.
   */
  lastSuccessAt: string | null;
  consecutiveFailures: number;
}

/** The settings a user chooses; the run-history fields are read, never defaulted. */
const DEFAULT_SCHEDULE: Pick<BackupScheduleConfig, 'enabled' | 'frequency' | 'retentionCount'> = {
  enabled: false,
  frequency: 'daily',
  retentionCount: 14,
};

export function safeBackupFileName(name: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(name);
}

export function resolveBackupPath(fileName: string): string {
  if (!safeBackupFileName(fileName)) {
    throw new Error('Invalid backup name.');
  }
  const basePath = path.resolve(BACKUP_DIR) + path.sep;
  const resolvedPath = path.resolve(BACKUP_DIR, fileName);
  if (!resolvedPath.startsWith(basePath)) {
    throw new Error('Invalid backup path.');
  }
  return resolvedPath;
}

export function runCommand(command: string, args: string[], options: ExecFileOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 120000, maxBuffer: 50 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.toString() || error.message));
        return;
      }
      resolve(stdout.toString());
    });
  });
}

export function pgConnectionEnv(): NodeJS.ProcessEnv {
  const dbUrl = new URL(process.env.DATABASE_URL as string);
  return {
    ...process.env,
    PGHOST: dbUrl.hostname,
    PGPORT: dbUrl.port || '5432',
    PGUSER: decodeURIComponent(dbUrl.username),
    PGPASSWORD: decodeURIComponent(dbUrl.password),
    PGDATABASE: dbUrl.pathname.replace(/^\//, ''),
  };
}

export async function ensureBackupDir(): Promise<void> {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
}

/**
 * Dump the database, a filtered slice of settings, and user metadata into a
 * single .tar.gz under BACKUP_DIR. Shared by the manual "Create backup"
 * route and the scheduled backup check.
 */
export async function createBackupArchive(): Promise<string> {
  let tmpDir = '';
  try {
    await ensureBackupDir();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'homelab-backup-'));
    const pgEnv = pgConnectionEnv();

    const dbDumpPath = path.join(tmpDir, 'database.sql');
    const settingsPath = path.join(tmpDir, 'settings.json');
    const usersPath = path.join(tmpDir, 'users.json');

    await runCommand('pg_dump', ['--no-owner', '--no-privileges', '--dbname', pgEnv.PGDATABASE as string], {
      env: pgEnv,
    }).then((stdout) => fs.writeFile(dbDumpPath, stdout, 'utf8'));

    const settingsResult = await query(
      `SELECT key, value, updated_at
       FROM settings
       WHERE key LIKE 'cloudflare_%' OR key LIKE 'health_%' OR key LIKE 'backup_schedule_%' OR key = 'recovery_mode_enabled'`
    );
    await fs.writeFile(settingsPath, JSON.stringify(settingsResult.rows, null, 2), 'utf8');

    const usersResult = await query('SELECT id, username, is_setup_complete, created_at FROM users ORDER BY id ASC');
    await fs.writeFile(usersPath, JSON.stringify(usersResult.rows, null, 2), 'utf8');

    const fileName = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.tar.gz`;
    const archivePath = path.join(BACKUP_DIR, fileName);
    await runCommand('tar', ['-czf', archivePath, '-C', tmpDir, '.']);

    return fileName;
  } finally {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/**
 * Delete the oldest backup archives beyond retentionCount, oldest first.
 * Returns the names of the files that were deleted.
 */
export async function pruneOldBackups(retentionCount: number): Promise<string[]> {
  await ensureBackupDir();
  const entries = await fs.readdir(BACKUP_DIR, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.tar.gz'))
      .map(async (entry) => {
        const fullPath = path.join(BACKUP_DIR, entry.name);
        const stat = await fs.stat(fullPath);
        return { name: entry.name, mtimeMs: stat.mtimeMs };
      })
  );

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const deleted: string[] = [];
  for (const file of files.slice(retentionCount)) {
    try {
      await fs.unlink(path.join(BACKUP_DIR, file.name));
      deleted.push(file.name);
    } catch {
      // One undeletable archive is not worth failing the whole prune over — the
      // next run tries again. It stays out of the returned list so callers
      // never report a file as gone while it is still in the backup list.
    }
  }
  return deleted;
}

export async function getBackupScheduleConfig(): Promise<BackupScheduleConfig> {
  const result = await query<{ key: string; value: string }>('SELECT key, value FROM settings WHERE key = ANY($1)', [
    Object.values(BACKUP_SCHEDULE_SETTINGS_KEYS),
  ]);
  const values = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));

  const frequencyRaw = values[BACKUP_SCHEDULE_SETTINGS_KEYS.frequency];
  const frequency: BackupScheduleFrequency = frequencyRaw === 'weekly' ? 'weekly' : DEFAULT_SCHEDULE.frequency;

  const retentionRaw = Number.parseInt(values[BACKUP_SCHEDULE_SETTINGS_KEYS.retentionCount] ?? '', 10);
  const retentionCount = Number.isFinite(retentionRaw) && retentionRaw > 0 ? retentionRaw : DEFAULT_SCHEDULE.retentionCount;

  const outcomeRaw = values[BACKUP_SCHEDULE_SETTINGS_KEYS.lastOutcome];
  const lastOutcome: BackupRunOutcome | null =
    outcomeRaw === 'success' || outcomeRaw === 'failed' ? outcomeRaw : null;

  const failuresRaw = Number.parseInt(values[BACKUP_SCHEDULE_SETTINGS_KEYS.consecutiveFailures] ?? '', 10);

  return {
    enabled: values[BACKUP_SCHEDULE_SETTINGS_KEYS.enabled] === 'true',
    frequency,
    retentionCount,
    lastRunAt: values[BACKUP_SCHEDULE_SETTINGS_KEYS.lastRunAt] ?? null,
    lastOutcome,
    lastSuccessAt: values[BACKUP_SCHEDULE_SETTINGS_KEYS.lastSuccessAt] ?? null,
    consecutiveFailures: Number.isFinite(failuresRaw) && failuresRaw > 0 ? failuresRaw : 0,
  };
}

export async function saveBackupScheduleConfig(config: {
  enabled: boolean;
  frequency: BackupScheduleFrequency;
  retentionCount: number;
}): Promise<void> {
  const values: Record<string, string> = {
    [BACKUP_SCHEDULE_SETTINGS_KEYS.enabled]: String(config.enabled),
    [BACKUP_SCHEDULE_SETTINGS_KEYS.frequency]: config.frequency,
    [BACKUP_SCHEDULE_SETTINGS_KEYS.retentionCount]: String(config.retentionCount),
  };
  for (const [key, value] of Object.entries(values)) {
    await query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, value]
    );
  }
}

/**
 * Record the end of a scheduled run: when it happened, and whether it worked.
 *
 * One writer for all four values because they only make sense together. Writing
 * the timestamp on its own — which is what this function used to do, before the
 * step that matters had even run — is precisely what let 2026-09-01 look like a
 * successful backup while nothing left the machine (§86.2).
 *
 * `lastSuccessAt` only moves on success, so it is the value that can say "the
 * last working backup was six days ago" while `lastRunAt` says "an hour".
 */
export async function recordBackupScheduleRun(outcome: BackupRunOutcome, at: Date = new Date()): Promise<void> {
  const iso = at.toISOString();
  // Read back rather than take a count from the caller: the streak is an
  // invariant of these rows, and a caller passing a stale one would quietly
  // reset the retry budget.
  const previous = await getBackupScheduleConfig();

  const values: Record<string, string> = {
    [BACKUP_SCHEDULE_SETTINGS_KEYS.lastRunAt]: iso,
    [BACKUP_SCHEDULE_SETTINGS_KEYS.lastOutcome]: outcome,
    [BACKUP_SCHEDULE_SETTINGS_KEYS.consecutiveFailures]: String(
      outcome === 'success' ? 0 : previous.consecutiveFailures + 1
    ),
  };
  if (outcome === 'success') {
    values[BACKUP_SCHEDULE_SETTINGS_KEYS.lastSuccessAt] = iso;
  }

  for (const [key, value] of Object.entries(values)) {
    await query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, value]
    );
  }
}

// ---------------------------------------------------------------------------
// The last app-database dump, read back for the dashboard (plan.md §75.2).
//
// The scheduler writes one audit row per run (§88.5) carrying which app dumps
// failed and why. The schedule card showed the run's own outcome but not this,
// so "the backup ran" could sit next to eight silently-stale databases.
// ---------------------------------------------------------------------------

export interface AppDumpFailure {
  app: string;
  kind: string;
  detail: string;
}

export interface LastAppDataDump {
  /** ISO 8601. */
  at: string;
  /** The audit row's own result — 'success' | 'failure'. */
  result: string;
  /** How many databases dumped / failed on that run, when the row recorded it. */
  dumped: number | null;
  failed: number | null;
  trigger: string | null;
  /**
   * Per-app failure reasons. Empty for rows written before §88.5 added them,
   * even when `failed` is non-zero — the frontend says so rather than implying
   * there were none.
   */
  failures: AppDumpFailure[];
}

/** Shape one `audit_logs` row (metadata is jsonb) into what the card needs. */
export function toLastAppDataDump(
  row: { result: string; created_at: Date | string; metadata: unknown } | undefined
): LastAppDataDump | null {
  if (!row) {
    return null;
  }
  const meta = (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, unknown>;
  const rawFailures = Array.isArray(meta.failures) ? meta.failures : [];
  return {
    at: new Date(row.created_at).toISOString(),
    result: String(row.result ?? ''),
    dumped: typeof meta.dumped === 'number' ? meta.dumped : null,
    failed: typeof meta.failed === 'number' ? meta.failed : null,
    trigger: typeof meta.trigger === 'string' ? meta.trigger : null,
    failures: rawFailures
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
      .map((entry) => ({
        app: String(entry.app ?? ''),
        kind: String(entry.kind ?? ''),
        detail: String(entry.detail ?? ''),
      })),
  };
}

export async function getLastAppDataDump(): Promise<LastAppDataDump | null> {
  // Both resources are app-database dumps: the scheduler writes 'app-data',
  // the manual "dump apps" route writes 'app-databases'. Newest of either.
  const result = await query<{ result: string; created_at: Date; metadata: unknown }>(
    `SELECT result, created_at, metadata FROM audit_logs
     WHERE action = 'backup_create' AND resource IN ('app-data', 'app-databases')
     ORDER BY created_at DESC
     LIMIT 1`
  );
  return toLastAppDataDump(result.rows[0]);
}
