import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile, ExecFileOptions } from 'child_process';
import { query } from '../utils/database';
import { writeAuditLog } from '../utils/audit';
import { schemas, validateBody, validateParams } from '../middleware/validation';
import logger from '../utils/logger';

const router = Router();

const BACKUP_DIR = path.join(process.cwd(), 'backups');

function safeBackupFileName(name: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(name);
}

function resolveBackupPath(fileName: string): string {
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

function runCommand(command: string, args: string[], options: ExecFileOptions = {}): Promise<string> {
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

function pgConnectionEnv(): NodeJS.ProcessEnv {
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

async function ensureBackupDir(): Promise<void> {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    await ensureBackupDir();
    const entries = await fs.readdir(BACKUP_DIR, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.tar.gz'))
        .map(async (entry) => {
          const fullPath = path.join(BACKUP_DIR, entry.name);
          const stat = await fs.stat(fullPath);
          return {
            name: entry.name,
            size: stat.size,
            createdAt: stat.mtime.toISOString(),
          };
        })
    );
    files.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return res.json({ items: files });
  } catch {
    return res.status(500).json({ error: 'Unable to list backups.' });
  }
});

router.post('/create', async (req: Request, res: Response) => {
  const userId = req.user!.id;
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
       WHERE key LIKE 'cloudflare_%' OR key LIKE 'health_%' OR key = 'recovery_mode_enabled'`
    );
    await fs.writeFile(settingsPath, JSON.stringify(settingsResult.rows, null, 2), 'utf8');

    const usersResult = await query('SELECT id, username, is_setup_complete, created_at FROM users ORDER BY id ASC');
    await fs.writeFile(usersPath, JSON.stringify(usersResult.rows, null, 2), 'utf8');

    const fileName = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.tar.gz`;
    const archivePath = path.join(BACKUP_DIR, fileName);
    await runCommand('tar', ['-czf', archivePath, '-C', tmpDir, '.']);

    await writeAuditLog({ userId, action: 'backup_create', resource: fileName, result: 'success' });

    return res.status(201).json({
      message: 'Backup created successfully.',
      fileName,
      downloadUrl: `/api/backups/download/${encodeURIComponent(fileName)}`,
    });
  } catch (error) {
    await writeAuditLog({ userId, action: 'backup_create', resource: 'backup', result: 'failure' }).catch(() => {});
    logger.error('Backup creation failed', { error: (error as Error).message, userId });
    return res.status(500).json({ error: 'Unable to create backup.' });
  } finally {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
});

router.get('/download/:fileName', validateParams(schemas.backupDownloadParams), async (req: Request, res: Response) => {
  const fileName = req.params.fileName;
  let backupPath = '';

  try {
    backupPath = resolveBackupPath(fileName);
  } catch {
    return res.status(400).json({ error: 'Invalid backup name.' });
  }

  try {
    await fs.access(backupPath);
    return res.download(backupPath, fileName);
  } catch {
    return res.status(404).json({ error: 'Backup file not found.' });
  }
});

router.post('/restore', validateBody(schemas.backupRestore), async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const fileName = req.body.fileName;
  let tmpDir = '';

  if (!safeBackupFileName(fileName)) {
    return res.status(400).json({ error: 'Invalid backup name.' });
  }
  let backupPath = '';
  try {
    backupPath = resolveBackupPath(fileName);
  } catch {
    return res.status(400).json({ error: 'Invalid backup name.' });
  }

  try {
    await fs.access(backupPath);
    const pgEnv = pgConnectionEnv();

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'homelab-restore-'));
    await runCommand('tar', ['-xzf', backupPath, '-C', tmpDir]);

    const sqlPath = path.join(tmpDir, 'database.sql');
    await runCommand('psql', ['--dbname', pgEnv.PGDATABASE as string, '-f', sqlPath], { env: pgEnv });

    const settingsPath = path.join(tmpDir, 'settings.json');
    const settingsRaw = await fs.readFile(settingsPath, 'utf8').catch(() => '[]');
    const settings = JSON.parse(settingsRaw);
    if (Array.isArray(settings)) {
      for (const entry of settings) {
        if (typeof entry.key !== 'string' || !/^[a-z0-9_]+$/.test(entry.key)) {
          continue;
        }
        await query(
          `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [entry.key, String(entry.value ?? '').slice(0, 4096)]
        );
      }
    }

    await writeAuditLog({ userId, action: 'backup_restore', resource: fileName, result: 'success' });
    return res.json({ message: 'Backup restored successfully.' });
  } catch (error) {
    await writeAuditLog({ userId, action: 'backup_restore', resource: fileName, result: 'failure' }).catch(() => {});
    logger.error('Backup restore failed', { error: (error as Error).message, userId, fileName });
    return res.status(500).json({ error: 'Unable to restore backup.' });
  } finally {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
});

export default router;
