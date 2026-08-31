/**
 * Creates and maintains the backup job inside Duplicati, so the dashboard is
 * the only place backups are configured.
 *
 * Without this the user picks a destination in the dashboard and is then told
 * to go and rebuild the same decision by hand in another UI — which is both
 * the §0 principle 2 problem and an easy way to end up with a destination that
 * is set but never actually written to.
 *
 * Duplicati stays the engine. It does deduplication, encryption, retention and
 * versioning properly, and none of that is worth reimplementing; the dashboard
 * only owns the *decisions* and pushes them in.
 */

import crypto from 'crypto';
import { query } from '../utils/database';
import { getBackupTarget, isMountedKind, toDuplicatiUrl } from '../utils/backupTarget';
import logger from '../utils/logger';

/** Name of the job the dashboard owns. Matching by name is how it is found again. */
const JOB_NAME = 'Homelab apps (managed by dashboard)';

/** What Duplicati backs up: the apps/ tree, mounted read-only in its compose file. */
const SOURCE_PATH = '/source/apps';

/** Where a mounted destination appears inside the Duplicati container. */
const MOUNTED_TARGET = 'file:///backups';

/**
 * The passphrase Duplicati encrypts with.
 *
 * Stored here because **a Duplicati backup cannot be restored without it** —
 * losing it makes every backup permanently unreadable, which is a worse
 * outcome than having no backup at all, since it looks like it is working.
 * Generated once and kept in settings so it survives a Duplicati rebuild, and
 * surfaced in the UI so the user can record it somewhere off-box.
 */
const PASSPHRASE_KEY = 'backup_job_passphrase';

interface DuplicatiBackupEntry {
  Backup: { ID: string; Name: string; TargetURL: string };
}

async function api(
  path: string,
  init: { method?: string; body?: unknown; token?: string } = {}
): Promise<{ status: number; body: unknown }> {
  const base = process.env.DUPLICATI_API_URL || 'http://host.docker.internal:10150';
  const response = await fetch(`${base}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* Duplicati returns bare text on some errors; keep it as-is for the message */
  }
  return { status: response.status, body };
}

async function login(password: string): Promise<string> {
  const { status, body } = await api('/api/v1/auth/login', { method: 'POST', body: { Password: password } });
  const token = (body as { AccessToken?: string })?.AccessToken;
  if (status !== 200 || !token) {
    throw new Error(
      status === 401
        ? "Duplicati rejected the password. It is the DUPLICATI_WEB_PASSWORD in the app's configuration."
        : `Duplicati login failed (HTTP ${status}).`
    );
  }
  return token;
}

async function getOrCreatePassphrase(): Promise<string> {
  const existing = await query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [PASSPHRASE_KEY]);
  if (existing.rows[0]?.value) {
    return existing.rows[0].value;
  }
  // Base64url so it survives being pasted anywhere without escaping surprises.
  const passphrase = crypto.randomBytes(32).toString('base64url');
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [PASSPHRASE_KEY, passphrase]
  );
  logger.info('Generated the backup encryption passphrase');
  return passphrase;
}

export interface ProvisionResult {
  created: boolean;
  jobId: string;
  targetUrl: string;
  /** Returned once so the UI can tell the user to record it. */
  passphrase: string;
}

/**
 * Create the dashboard's backup job in Duplicati, or update it if it exists.
 *
 * Deliberately creates the job with **no schedule**. A job that starts
 * uploading the moment it is defined is a surprise, and the first run of a
 * 1.8 GB backup to a remote is something the user should choose to start.
 */
export async function provisionBackupJob(duplicatiPassword: string, frequency: 'daily' | 'weekly' | null): Promise<ProvisionResult> {
  const target = await getBackupTarget();
  if (!target) {
    throw new Error('No backup destination is configured.');
  }

  // A mounted destination is a directory to Duplicati; a backend destination
  // carries its own credentials in the URL.
  const targetUrl = isMountedKind(target.kind) ? MOUNTED_TARGET : toDuplicatiUrl(target);
  if (!targetUrl) {
    throw new Error(`Cannot build a Duplicati target for a ${target.kind} destination.`);
  }

  const token = await login(duplicatiPassword);
  const passphrase = await getOrCreatePassphrase();

  const settings = [
    { Name: 'encryption-module', Value: 'aes' },
    { Name: 'passphrase', Value: passphrase },
    { Name: 'compression-module', Value: 'zip' },
    { Name: 'dblock-size', Value: '50mb' },
    // Thins old versions instead of keeping everything: daily for a week,
    // weekly for a month, monthly for a year.
    { Name: 'retention-policy', Value: '7D:1D,4W:1W,12M:1M' },
  ];

  const schedule = frequency ? { Repeat: frequency === 'weekly' ? '1W' : '1D' } : null;

  const list = await api('/api/v1/backups', { token });
  const existing = (list.body as DuplicatiBackupEntry[] | null)?.find?.((entry) => entry.Backup?.Name === JOB_NAME);

  const payload = {
    Backup: {
      Name: JOB_NAME,
      Description: 'Created by the homelab dashboard. Edit the destination and schedule there, not here.',
      Tags: [],
      TargetURL: targetUrl,
      Settings: settings,
      // Exclude the live database directories. Their contents are already in
      // the _dump/*.sql files, written consistently just before each run —
      // and copying a running Postgres or MariaDB data directory can restore
      // torn. Excluding them also stops the same data being stored twice
      // (203 MB for NPM alone).
      //
      // Duplicati filter syntax: "-" excludes, and a regex is wrapped in [].
      Filters: [
        { Order: 0, Include: false, Expression: '[.*/data/db/.*]' },
        { Order: 1, Include: false, Expression: '[.*/data/pgdata/.*]' },
        // SQLite side-files change constantly and are meaningless without the
        // database they belong to; the .backup snapshot in _dump is the
        // consistent copy.
        { Order: 2, Include: false, Expression: '[.*-wal]' },
        { Order: 3, Include: false, Expression: '[.*-shm]' },
      ],
      Sources: [SOURCE_PATH],
    },
    Schedule: schedule,
  };

  if (existing) {
    const update = await api(`/api/v1/backup/${existing.Backup.ID}`, { method: 'PUT', token, body: payload });
    if (update.status !== 200) {
      throw new Error(`Duplicati rejected the job update (HTTP ${update.status}).`);
    }
    return { created: false, jobId: existing.Backup.ID, targetUrl, passphrase };
  }

  const create = await api('/api/v1/backups', { method: 'POST', token, body: payload });
  const id = (create.body as { ID?: string })?.ID;
  if (create.status !== 200 || !id) {
    throw new Error(`Duplicati rejected the new job (HTTP ${create.status}).`);
  }
  return { created: true, jobId: id, targetUrl, passphrase };
}

/**
 * Ask Duplicati to run the dashboard's job now.
 *
 * Returns false rather than throwing when there is no job or Duplicati is
 * unreachable: a scheduled run must not fail the whole backup cycle because
 * the app-data half is not set up yet.
 */
export async function runBackupJobNow(duplicatiPassword: string): Promise<{ started: boolean; detail: string }> {
  try {
    const token = await login(duplicatiPassword);
    const list = await api('/api/v1/backups', { token });
    const job = (list.body as DuplicatiBackupEntry[] | null)?.find?.((entry) => entry.Backup?.Name === JOB_NAME);
    if (!job) {
      return { started: false, detail: 'no dashboard-managed backup job exists yet' };
    }
    const started = await api(`/api/v1/backup/${job.Backup.ID}/run`, { method: 'POST', token });
    if (started.status !== 200) {
      return { started: false, detail: `Duplicati refused to start the job (HTTP ${started.status})` };
    }
    return { started: true, detail: `queued Duplicati job ${job.Backup.ID}` };
  } catch (error) {
    return { started: false, detail: (error as Error).message };
  }
}
