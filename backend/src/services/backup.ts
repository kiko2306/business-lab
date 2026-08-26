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
} as const;

export type BackupScheduleFrequency = 'daily' | 'weekly';

export interface BackupScheduleConfig {
  enabled: boolean;
  frequency: BackupScheduleFrequency;
  retentionCount: number;
  lastRunAt: string | null;
}

const DEFAULT_SCHEDULE: Omit<BackupScheduleConfig, 'lastRunAt'> = {
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
  const toDelete = files.slice(retentionCount);
  await Promise.all(toDelete.map((file) => fs.unlink(path.join(BACKUP_DIR, file.name)).catch(() => {})));
  return toDelete.map((file) => file.name);
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

  return {
    enabled: values[BACKUP_SCHEDULE_SETTINGS_KEYS.enabled] === 'true',
    frequency,
    retentionCount,
    lastRunAt: values[BACKUP_SCHEDULE_SETTINGS_KEYS.lastRunAt] ?? null,
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

export async function setBackupScheduleLastRun(isoTimestamp: string): Promise<void> {
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [BACKUP_SCHEDULE_SETTINGS_KEYS.lastRunAt, isoTimestamp]
  );
}
