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
import { DUPLICATI_OAUTH_REFRESH_URL, getBackupTarget, isMountedKind, toDuplicatiUrl } from '../utils/backupTarget';
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
 * The job is created with **no Duplicati-side schedule**, deliberately. The
 * dashboard's own scheduler drives it, and the order matters: it dumps every
 * database and *then* triggers this job. A schedule inside Duplicati would
 * fire independently of that, backing up whatever dumps happened to be lying
 * around — silently archiving stale data while reporting success.
 *
 * It also avoids a real failure mode: a Duplicati schedule with a repetition
 * but no valid start time leaves its scheduler logging
 * "Unable to find a valid date, given the start date 1/1/0001" on every cycle.
 *
 * The `frequency` argument is kept so callers can express intent, but it is
 * recorded rather than handed to Duplicati.
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

  // Make sure the destination exists before defining a job that points at it —
  // otherwise the first run fails with "missing-folder", which is easily
  // mistaken for a credential problem.
  const folder = await ensureDestinationFolder(duplicatiPassword, targetUrl);
  if (!folder.ok) {
    logger.warn('Backup destination could not be prepared', { detail: folder.detail });
  }

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

  // Pin the token-refresh endpoint. This build DOES honour `oauth-url` — an
  // earlier note here claimed it did not, and that mistake hid a malformed
  // value that answered 405 and broke every refresh mid-backup. Used verbatim:
  // it is the refresh endpoint, never the login page.
  if (!isMountedKind(target.kind)) {
    settings.push({ Name: 'oauth-url', Value: DUPLICATI_OAUTH_REFRESH_URL });
  }

  // Never a Duplicati-side schedule — see the note above. `frequency` is the
  // dashboard's own cadence and is reported back, not delegated.
  void frequency;
  const schedule = null;

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

/**
 * Ask Duplicati to test a destination URL, without creating or running a job.
 *
 * This is the authoritative check for a backend-family destination (Google
 * Drive and friends), which cannot be mounted and so cannot be probed the way
 * disk/SMB/NFS are. Duplicati lists the destination's contents using the same
 * code path a backup uses, so whatever it says here is what a backup will do —
 * in seconds rather than after a failed upload.
 *
 * The URL must be built from our own settings, not read back from a saved job:
 * Duplicati masks secrets in the job it returns, and testing that value fails
 * with "Unmasked URL contains password placeholder".
 */
export async function testDestinationUrl(duplicatiPassword: string, url: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const token = await login(duplicatiPassword);
    const result = await api('/api/v1/remoteoperation/test', { method: 'POST', token, body: { path: url } });
    if (result.status === 200) {
      return { ok: true, detail: 'Duplicati connected to the destination and listed its contents.' };
    }
    const raw = (result.body as { Error?: string })?.Error ?? JSON.stringify(result.body ?? '').slice(0, 300);
    // Duplicati prefixes machine-readable ids; the useful half is after
    // "user-information:".
    const friendly = /user-information:(.*)$/s.exec(raw)?.[1]?.trim() ?? raw;
    return { ok: false, detail: friendly.slice(0, 400) };
  } catch (error) {
    return { ok: false, detail: (error as Error).message };
  }
}

/**
 * Create the destination folder if it does not exist yet.
 *
 * Duplicati will not create it on its own: a backup against a missing folder
 * fails with a bare `missing-folder`, which — after an authentication problem
 * with a similar shape — reads like another credential fault. Creating it as
 * part of provisioning removes a whole class of confusing first-run failure.
 *
 * Safe to call repeatedly: an existing folder is reported as success, and a
 * failure here is returned rather than thrown, since a destination that cannot
 * be pre-created is still worth saving so the user can see the error.
 */
export async function ensureDestinationFolder(duplicatiPassword: string, url: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const token = await login(duplicatiPassword);

    // Only create when the destination actually reports the folder missing —
    // never blindly, so this cannot mask a different failure.
    const probe = await api('/api/v1/remoteoperation/test', { method: 'POST', token, body: { path: url } });
    if (probe.status === 200) {
      return { ok: true, detail: 'destination already exists' };
    }
    const message = (probe.body as { Error?: string })?.Error ?? '';
    if (!/missing-folder/i.test(message)) {
      return { ok: false, detail: message.slice(0, 300) || `destination test failed (HTTP ${probe.status})` };
    }

    const created = await api('/api/v1/remoteoperation/create', { method: 'POST', token, body: { path: url } });
    if (created.status !== 200) {
      return { ok: false, detail: `could not create the destination folder (HTTP ${created.status})` };
    }
    return { ok: true, detail: 'created the destination folder' };
  } catch (error) {
    return { ok: false, detail: (error as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Read-only status for the dashboard's schedule card (plan.md §75.2).
//
// "The schedule ran" and "backups exist at the destination" are different
// facts, and for the whole life of this system only the first was visible.
// This surfaces the second: where the job writes, how many restore points are
// there and how large, and when it last ran or errored.
// ---------------------------------------------------------------------------

export interface BackupJobStatus {
  /** Duplicati answered at all. false → everything below is null. */
  reachable: boolean;
  /** A dashboard-managed job exists in Duplicati. */
  configured: boolean;
  /** Destination the job writes to, with every credential stripped. */
  destination: string | null;
  /** Restore points currently held at the destination. */
  versionCount: number | null;
  /** Human-readable size stored at the destination, e.g. "593.215 MiB". */
  destinationSize: string | null;
  destinationSizeBytes: number | null;
  /** Human-readable size of the source tree at the last run. */
  sourceSize: string | null;
  /** ISO 8601. When the last backup started / finished. */
  lastBackupAt: string | null;
  lastBackupFinishedAt: string | null;
  /** Duplicati's own duration string, seconds precision, e.g. "01:33:33". */
  lastBackupDuration: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
}

const UNREACHABLE_STATUS: BackupJobStatus = {
  reachable: false,
  configured: false,
  destination: null,
  versionCount: null,
  destinationSize: null,
  destinationSizeBytes: null,
  sourceSize: null,
  lastBackupAt: null,
  lastBackupFinishedAt: null,
  lastBackupDuration: null,
  lastErrorAt: null,
  lastErrorMessage: null,
};

/**
 * Strip anything secret from a Duplicati target URL so it can be shown in the
 * dashboard. The query string carries `authid=` (Google Drive's long-lived
 * refresh token) and `//user:pass@host` carries share credentials; what is
 * left — scheme, host, path — is exactly "which destination", which is the
 * point of showing it.
 */
export function sanitizeTargetUrl(raw: string): string {
  const withoutQuery = raw.split(/[?#]/)[0];
  return withoutQuery.replace(/\/\/[^/@]*@/, '//');
}

/**
 * Duplicati reports times as `20260901T153928Z`, not ISO 8601. Widen it back
 * out so the frontend date pipe can read it; pass through anything already
 * parseable, and return null for empty or unrecognised input.
 */
export function parseDuplicatiTimestamp(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (compact) {
    const [, y, mo, d, h, mi, s] = compact;
    return `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/** Duplicati durations look like "01:33:33.2743087" — drop the sub-second tail. */
function trimDuration(raw: string | undefined | null): string | null {
  if (!raw) return null;
  return raw.split('.')[0] || null;
}

function metaInt(raw: unknown): number | null {
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) ? n : null;
}

interface DuplicatiListEntry {
  Backup?: {
    Name?: string;
    TargetURL?: string;
    Metadata?: Record<string, string>;
  };
}

/**
 * A read-only view of the dashboard's Duplicati job. Never throws: the
 * schedule card must degrade to "unreachable" rather than break the page.
 */
export async function getBackupJobStatus(duplicatiPassword: string | null): Promise<BackupJobStatus> {
  if (!duplicatiPassword) {
    return UNREACHABLE_STATUS;
  }
  try {
    const token = await login(duplicatiPassword);
    const list = await api('/api/v1/backups', { token });
    const entries = Array.isArray(list.body) ? (list.body as DuplicatiListEntry[]) : [];
    const job = entries.find((entry) => entry.Backup?.Name === JOB_NAME);
    if (!job?.Backup) {
      // Duplicati is up but the dashboard has never provisioned its job.
      return { ...UNREACHABLE_STATUS, reachable: true };
    }
    const meta = job.Backup.Metadata ?? {};
    return {
      reachable: true,
      configured: true,
      destination: job.Backup.TargetURL ? sanitizeTargetUrl(job.Backup.TargetURL) : null,
      // TargetFilesetsCount is the live figure; BackupListCount trails it
      // until a run finishes, so prefer the former and fall back.
      versionCount: metaInt(meta.TargetFilesetsCount) ?? metaInt(meta.BackupListCount),
      destinationSize: meta.TargetSizeString ?? null,
      destinationSizeBytes: metaInt(meta.TargetFilesSize),
      sourceSize: meta.SourceSizeString ?? null,
      lastBackupAt: parseDuplicatiTimestamp(meta.LastBackupStarted ?? meta.LastBackupDate),
      lastBackupFinishedAt: parseDuplicatiTimestamp(meta.LastBackupFinished),
      lastBackupDuration: trimDuration(meta.LastBackupDuration),
      lastErrorAt: parseDuplicatiTimestamp(meta.LastErrorDate),
      lastErrorMessage: meta.LastErrorMessage ?? null,
    };
  } catch {
    return UNREACHABLE_STATUS;
  }
}
