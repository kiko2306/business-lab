// Settings routes: Backup destination: where Kopia keeps its repository.
// Mounted, behind the capability gate, by ./index.ts.
import { Router, Request, Response } from 'express';
import { query } from '../../utils/database';
import { writeAuditLog } from '../../utils/audit';
import { schemas, validateBody } from '../../middleware/validation';
import {
  BACKUP_TARGET_KEYS,
  getBackupTarget,
  isMountedKind,
  toKopiaRepositoryMount,
  toMountSpec,
  validateTarget,
} from '../../utils/backupTarget';
import { testBackupTarget } from '../../services/backupTargetTest';
import { applyKopiaTarget } from '../../services/kopiaTargetApply';
import { checkKopiaConnection } from '../../services/kopiaClient';
import { readAppEnvValue } from '../../services/appEnv';
import { setSettings } from '../../utils/settingsStore';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/settings/backup-target — where backups are written.
// ---------------------------------------------------------------------------
router.get('/backup-target', async (_req: Request, res: Response) => {
  try {
    const result = await query<{ key: string; value: string }>('SELECT key, value FROM settings WHERE key = ANY($1)', [
      Object.values(BACKUP_TARGET_KEYS),
    ]);
    const values = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));

    return res.json({
      // Unconfigured is meaningfully different from "set to a local disk":
      // until this is chosen, backups sit beside the data they protect.
      configured: Boolean(values[BACKUP_TARGET_KEYS.kind]),
      kind: values[BACKUP_TARGET_KEYS.kind] ?? 'disk',
      path: values[BACKUP_TARGET_KEYS.path] ?? null,
      server: values[BACKUP_TARGET_KEYS.server] ?? null,
      share: values[BACKUP_TARGET_KEYS.share] ?? null,
      username: values[BACKUP_TARGET_KEYS.username] ?? null,
      passwordConfigured: Boolean(values[BACKUP_TARGET_KEYS.password]),
      options: values[BACKUP_TARGET_KEYS.options] ?? null,
    });
  } catch {
    return res.status(500).json({ error: 'Unable to load the backup destination.' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/settings/backup-target
// ---------------------------------------------------------------------------
router.put('/backup-target', validateBody(schemas.backupTarget), async (req: Request, res: Response) => {
  const existing = await getBackupTarget();
  const target = {
    kind: req.body.kind,
    path: (req.body.path ?? '').trim(),
    server: (req.body.server ?? '').trim(),
    share: (req.body.share ?? '').trim(),
    username: (req.body.username ?? '').trim(),
    // Keep the stored password when the field is left blank.
    password: req.body.password || existing?.password || '',
    options: (req.body.options ?? '').trim(),
  };

  const problem = validateTarget(target);
  if (problem) {
    return res.status(400).json({ error: problem });
  }

  const values: Record<string, string> = {
    [BACKUP_TARGET_KEYS.kind]: target.kind,
    [BACKUP_TARGET_KEYS.path]: target.path,
    [BACKUP_TARGET_KEYS.server]: target.server,
    [BACKUP_TARGET_KEYS.share]: target.share,
    [BACKUP_TARGET_KEYS.username]: target.username,
    [BACKUP_TARGET_KEYS.options]: target.options,
  };
  // Secrets only overwrite when supplied, so saving with the field blank keeps
  // the stored value — same convention as every other credential here.
  if (req.body.password) values[BACKUP_TARGET_KEYS.password] = req.body.password;

  try {
    await setSettings(values);

    await writeAuditLog({
      userId: req.user?.id ?? null,
      action: 'settings_change',
      resource: 'backup_target',
      result: 'success',
    });

    // Saving alone leaves Kopia mounted at the previous destination while the
    // UI claims otherwise, so apply it here rather than asking the user to
    // remember a restart — and a restart alone is not enough, because Docker
    // reuses a named volume whose definition changed (see kopiaTargetApply).
    const applied = await applyKopiaTarget(target);

    return res.json({
      message: applied.detail,
      restarted: applied.restarted,
      // No Docker mount at all for s3 (§221) or ftp (§267) — toMountSpec
      // throws for those on purpose, so the mount details are simply omitted.
      ...(isMountedKind(target.kind)
        ? { mount: toMountSpec(target), kopiaRepository: toKopiaRepositoryMount(target) }
        : {}),
    });
  } catch {
    return res.status(500).json({ error: 'Unable to save the backup destination.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/settings/backup-target/kopia-status — polled by the destination
// save modal after PUT above recreates the container, since `docker compose
// up -d` returns as soon as the container starts, well before its entrypoint
// has actually reconnected (or failed to) against the new destination
// (plan.md §581).
// ---------------------------------------------------------------------------
router.get('/backup-target/kopia-status', async (_req: Request, res: Response) => {
  const password = readAppEnvValue('kopia', 'KOPIA_SERVER_PASSWORD');
  if (!password) {
    return res.json({ ok: false, detail: 'Kopia has no password configured yet.' });
  }
  return res.json(await checkKopiaConnection(password));
});

// ---------------------------------------------------------------------------
// POST /api/settings/backup-target/test — mount it and write to it.
// ---------------------------------------------------------------------------
router.post('/backup-target/test', async (_req: Request, res: Response) => {
  const target = await getBackupTarget();
  if (!target) {
    return res.status(400).json({ error: 'No backup destination is configured yet.' });
  }
  const problem = validateTarget(target);
  if (problem) {
    return res.status(400).json({ error: problem });
  }

  const result = await testBackupTarget(target);
  return res.status(result.success ? 200 : 400).json(result);
});

export default router;
