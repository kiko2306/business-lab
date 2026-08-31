import { Router, Request, Response } from 'express';
import { dumpAllAppDatabases } from '../services/appDumps';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { query } from '../utils/database';
import { writeAuditLog } from '../utils/audit';
import { schemas, validateBody, validateParams } from '../middleware/validation';
import logger from '../utils/logger';
import {
  BACKUP_DIR,
  createBackupArchive,
  ensureBackupDir,
  getBackupScheduleConfig,
  pgConnectionEnv,
  pruneOldBackups,
  resolveBackupPath,
  runCommand,
  safeBackupFileName,
  saveBackupScheduleConfig,
} from '../services/backup';

const router = Router();

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

  try {
    const fileName = await createBackupArchive();
    await writeAuditLog({ userId, action: 'backup_create', resource: fileName, result: 'success' });

    const scheduleConfig = await getBackupScheduleConfig();
    if (scheduleConfig.enabled) {
      await pruneOldBackups(scheduleConfig.retentionCount).catch((error: Error) => {
        logger.error('Backup retention cleanup failed', { error: error.message });
      });
    }

    return res.status(201).json({
      message: 'Backup created successfully.',
      fileName,
      downloadUrl: `/api/backups/download/${encodeURIComponent(fileName)}`,
    });
  } catch (error) {
    await writeAuditLog({ userId, action: 'backup_create', resource: 'backup', result: 'failure' }).catch(() => {});
    logger.error('Backup creation failed', { error: (error as Error).message, userId });
    return res.status(500).json({ error: 'Unable to create backup.' });
  }
});

/**
 * POST /api/backups/dump-apps
 * Dump every app database to apps/<app>/data/_dump/ so a file-level backup of
 * apps/ captures something consistent. Without this the file backup copies
 * live Postgres/MariaDB data directories and SQLite files with open
 * write-ahead logs, which can restore torn.
 */
router.post('/dump-apps', async (req: Request, res: Response) => {
  try {
    const report = await dumpAllAppDatabases();
    await writeAuditLog({
      userId: req.user?.id ?? null,
      action: 'backup_create',
      resource: 'app-databases',
      result: report.failed === 0 ? 'success' : 'failure',
      metadata: { ok: report.ok, failed: report.failed },
    }).catch(() => {});
    return res.json({
      message: report.failed === 0
        ? `Dumped ${report.ok} database${report.ok === 1 ? '' : 's'}.`
        : `Dumped ${report.ok}, ${report.failed} failed.`,
      ...report,
    });
  } catch (error) {
    logger.error('App database dump failed', { error: (error as Error).message });
    return res.status(500).json({ error: 'Unable to dump the app databases.' });
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

router.get('/schedule', async (_req: Request, res: Response) => {
  try {
    return res.json(await getBackupScheduleConfig());
  } catch {
    return res.status(500).json({ error: 'Unable to load backup schedule.' });
  }
});

router.put('/schedule', validateBody(schemas.backupScheduleUpdate), async (req: Request, res: Response) => {
  const { enabled, frequency, retentionCount } = req.body;

  try {
    await saveBackupScheduleConfig({ enabled, frequency, retentionCount });
    await writeAuditLog({
      userId: req.user?.id ?? null,
      action: 'settings_change',
      resource: 'backup_schedule',
      result: 'success',
    }).catch(() => {});
    return res.json({ message: 'Backup schedule updated.' });
  } catch {
    return res.status(500).json({ error: 'Unable to update backup schedule.' });
  }
});

export default router;
