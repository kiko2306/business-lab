/**
 * Talks to the Kopia server's REST API, so the dashboard is the only place
 * backups are configured and driven — the same role `duplicatiClient.ts` plays
 * for Duplicati, and the first half of replacing it (plan.md §81.5).
 *
 * Kopia stays the engine: it does content-addressed dedup, encryption,
 * retention and restore properly (and unlike Duplicati its restore API
 * actually writes files — §75.3). The dashboard owns the *decisions* — which
 * source, what retention, when to snapshot, where to restore — and pushes them
 * in over this client.
 *
 * Slice 2 is this module and its tests only. Wiring it into the scheduler, the
 * Settings panel and the backup-destination translation are later slices; until
 * then Duplicati still runs in parallel.
 *
 * ## Auth
 *
 * The server (`apps/kopia/`, `--server-username kopia --server-password …`)
 * gates everything — UI and API — behind HTTP basic auth, and additionally
 * requires a CSRF token on every `/api/**` call, GET included. The token lives
 * in a `<meta name="kopia-csrf-token">` tag in the served HTML and is tied to
 * the session cookies handed out with it, so each call sequence starts by
 * fetching `/` to open a session. `openSession` does that; `api` replays the
 * cookies + token.
 */

import logger from '../utils/logger';

/**
 * What Kopia snapshots: the managed apps/ tree, mounted read-only into the
 * container by `apps/kopia/docker-compose.yml` as `/source/apps`. Matches
 * Duplicati's `SOURCE_PATH` so the two engines back up exactly the same tree.
 */
const SOURCE_PATH = '/source/apps';

/**
 * The basic-auth username. Fixed to `kopia` in the compose file (only the
 * passwords carry security), so the client does not need it passed in.
 */
const SERVER_USERNAME = 'kopia';

/** Every request gets its own deadline; a hung server must not wedge a caller. */
const REQUEST_TIMEOUT_MS = 20_000;

/** A restore can take a while to enumerate; give the trigger call more room. */
const RESTORE_TIMEOUT_MS = 60_000;

/**
 * Default retention ladder for the repository's global policy. Kept in step
 * with the `kopia policy set --global` line in `apps/kopia/entrypoint.sh` —
 * the entrypoint sets it on first start so a snapshot taken before this client
 * ever runs is still thinned; `setRetentionPolicy` re-asserts it.
 */
const DEFAULT_RETENTION: KopiaRetention = {
  keepLatest: 10,
  keepHourly: 24,
  keepDaily: 14,
  keepWeekly: 8,
  keepMonthly: 6,
  keepAnnual: 2,
};

function apiBase(): string {
  // host.docker.internal resolves to the host gateway from inside the
  // management container (compose adds the extra_hosts entry), so this reaches
  // Kopia's published port the same way duplicatiClient reaches Duplicati's.
  return process.env.KOPIA_API_URL || 'http://host.docker.internal:10470';
}

// ---------------------------------------------------------------------------
// Session + transport
// ---------------------------------------------------------------------------

interface Session {
  /** `Basic …` header value. */
  auth: string;
  /** `name=value; name=value` from the session's Set-Cookie headers. */
  cookie: string;
  /** The matching CSRF token. */
  csrf: string;
}

/**
 * Pull the CSRF token out of Kopia's served HTML. Exported for testing — it is
 * the one bit of screen-scraping in here and the format is not contractual.
 */
export function extractCsrfToken(html: string): string | null {
  const match = /<meta\s+name="kopia-csrf-token"\s+content="([^"]+)"/i.exec(html);
  return match ? match[1] : null;
}

/**
 * Fold a list of Set-Cookie header values down to a `Cookie` request header —
 * just the `name=value` pair of each, attributes dropped. Exported for testing.
 */
export function cookieHeader(setCookies: string[]): string {
  return setCookies
    .map((c) => c.split(';', 1)[0].trim())
    .filter(Boolean)
    .join('; ');
}

function readSetCookies(headers: Headers): string[] {
  // getSetCookie() is the correct, un-folded accessor (Node 20+); fall back to
  // the folded single header if something older is ever in play.
  const withGetter = headers as unknown as { getSetCookie?: () => string[] };
  if (typeof withGetter.getSetCookie === 'function') {
    return withGetter.getSetCookie();
  }
  const raw = headers.get('set-cookie');
  return raw ? [raw] : [];
}

async function openSession(password: string): Promise<Session> {
  const auth = 'Basic ' + Buffer.from(`${SERVER_USERNAME}:${password}`).toString('base64');
  const response = await fetch(`${apiBase()}/`, {
    headers: { Authorization: auth },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 401) {
    throw new Error("Kopia rejected the credentials. Check KOPIA_SERVER_PASSWORD in the app's configuration.");
  }
  if (!response.ok) {
    throw new Error(`Kopia's web server answered HTTP ${response.status}.`);
  }
  const cookie = cookieHeader(readSetCookies(response.headers));
  const csrf = extractCsrfToken(await response.text());
  if (!csrf) {
    throw new Error('Kopia did not return a CSRF token — the server may still be starting.');
  }
  return { auth, cookie, csrf };
}

async function api(
  session: Session,
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {}
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${apiBase()}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: session.auth,
      Cookie: session.cookie,
      'X-Kopia-Csrf-Token': session.csrf,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(init.timeoutMs ?? REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* Kopia returns bare text on some errors — keep it for the message. */
  }
  return { status: response.status, body };
}

/** Kopia error bodies are `{ code, error }`; fall back to a trimmed dump. */
function describeError(body: unknown): string {
  const asObj = body as { error?: string; code?: string } | null;
  if (asObj?.error) {
    return asObj.error;
  }
  const dump = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  return dump.slice(0, 300);
}

// ---------------------------------------------------------------------------
// Source addressing
// ---------------------------------------------------------------------------

/** Kopia identifies a snapshot source by this triple. */
export interface KopiaSourceId {
  userName: string;
  host: string;
  path: string;
}

interface SourcesResponse {
  localUsername?: string;
  localHost?: string;
  sources?: Array<{
    source: KopiaSourceId;
    status?: string;
    lastSnapshot?: {
      startTime?: string;
      endTime?: string;
      stats?: {
        totalSize?: number;
        fileCount?: number;
        errorCount?: number;
        ignoredErrorCount?: number;
      };
    };
  }>;
}

function sourceQuery(id: KopiaSourceId): string {
  const p = new URLSearchParams({ userName: id.userName, host: id.host, path: id.path });
  return `?${p.toString()}`;
}

/**
 * The (user, host) this server snapshots as. Read from the running server
 * rather than assumed: the host is pinned to `kopia` in the compose file, but
 * letting the server tell us keeps this correct if that ever changes.
 */
async function localSourceId(session: Session, path: string): Promise<KopiaSourceId> {
  const res = await api(session, '/api/v1/sources');
  const info = res.body as SourcesResponse | null;
  if (res.status !== 200 || !info?.localUsername || !info?.localHost) {
    throw new Error(`Kopia did not report its local identity (HTTP ${res.status}).`);
  }
  return { userName: info.localUsername, host: info.localHost, path };
}

// ---------------------------------------------------------------------------
// connect
// ---------------------------------------------------------------------------

/**
 * Check the server is reachable and its repository is connected, without
 * changing anything. Never throws — returns `ok:false` with a reason, the same
 * contract `duplicatiClient.testDestinationUrl` uses.
 */
export async function checkKopiaConnection(password: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const session = await openSession(password);
    const res = await api(session, '/api/v1/repo/status');
    const status = res.body as { connected?: boolean; description?: string } | null;
    if (res.status !== 200) {
      return { ok: false, detail: `Kopia status check failed (HTTP ${res.status}).` };
    }
    if (!status?.connected) {
      return { ok: false, detail: 'Kopia is running but not connected to a repository.' };
    }
    return { ok: true, detail: status.description ?? 'connected' };
  } catch (error) {
    return { ok: false, detail: (error as Error).message };
  }
}

// ---------------------------------------------------------------------------
// set policy
// ---------------------------------------------------------------------------

export interface KopiaRetention {
  keepLatest?: number;
  keepHourly?: number;
  keepDaily?: number;
  keepWeekly?: number;
  keepMonthly?: number;
  keepAnnual?: number;
}

/**
 * Set the repository-wide (global) retention policy. Idempotent. Defaults to
 * the same ladder `apps/kopia/entrypoint.sh` applies on first start, so calling
 * it with no argument re-asserts the intended policy rather than changing it.
 */
export async function setRetentionPolicy(
  password: string,
  retention: KopiaRetention = DEFAULT_RETENTION
): Promise<void> {
  const session = await openSession(password);
  // Empty user/host/path == the global policy every source inherits from.
  const res = await api(session, '/api/v1/policy?userName=&host=&path=', {
    method: 'PUT',
    body: { retention },
  });
  if (res.status !== 200) {
    throw new Error(`Kopia rejected the retention policy (HTTP ${res.status}): ${describeError(res.body)}`);
  }
}

// ---------------------------------------------------------------------------
// provision the managed source
// ---------------------------------------------------------------------------

export interface ProvisionSourceResult {
  /** false when the source was already registered. */
  created: boolean;
  source: KopiaSourceId;
}

/**
 * Register `/source/apps` as a snapshot source if it is not already, with an
 * empty per-source policy so it inherits the global retention ladder. Safe to
 * call repeatedly. Throws on a real failure — this is provisioning, and a
 * caller that asked for it wants to know it did not happen (mirrors
 * `duplicatiClient.provisionBackupJob`).
 */
export async function provisionBackupSource(password: string): Promise<ProvisionSourceResult> {
  const session = await openSession(password);

  const repo = await api(session, '/api/v1/repo/status');
  if ((repo.body as { connected?: boolean } | null)?.connected !== true) {
    throw new Error('Kopia is running but not connected to a repository.');
  }

  const list = await api(session, '/api/v1/sources');
  const existing = ((list.body as SourcesResponse | null)?.sources ?? []).some(
    (s) => s.source.path === SOURCE_PATH
  );

  // POST /sources with an inline (empty) policy both registers the source and
  // gives it the policy it needs to exist — a bare POST fails "missing policy".
  const res = await api(session, '/api/v1/sources', {
    method: 'POST',
    body: { path: SOURCE_PATH, createSnapshot: false, policy: {} },
  });
  if (res.status !== 200) {
    throw new Error(`Kopia refused to register the backup source (HTTP ${res.status}): ${describeError(res.body)}`);
  }

  const source = await localSourceId(session, SOURCE_PATH);
  if (!existing) {
    logger.info('Registered the Kopia backup source', { path: SOURCE_PATH });
  }
  return { created: !existing, source };
}

// ---------------------------------------------------------------------------
// snapshot now
// ---------------------------------------------------------------------------

interface UploadResponse {
  sources?: Record<string, { success?: boolean }>;
}

/**
 * Ask Kopia to snapshot `/source/apps` now. Returns `started:false` with a
 * reason rather than throwing when the source is not set up or Kopia is
 * unreachable: a scheduled run must not fail its whole cycle because the
 * app-data half is not provisioned yet (mirrors `runBackupJobNow`).
 */
export async function runSnapshotNow(password: string): Promise<{ started: boolean; detail: string }> {
  try {
    const session = await openSession(password);

    const list = await api(session, '/api/v1/sources');
    const info = list.body as SourcesResponse | null;
    const known = (info?.sources ?? []).some((s) => s.source.path === SOURCE_PATH);
    if (!known) {
      return { started: false, detail: 'no dashboard-managed backup source exists yet' };
    }

    const id: KopiaSourceId = {
      userName: info?.localUsername ?? 'root',
      host: info?.localHost ?? 'kopia',
      path: SOURCE_PATH,
    };
    const res = await api(session, `/api/v1/sources/upload${sourceQuery(id)}`, { method: 'POST', body: {} });
    if (res.status !== 200) {
      return { started: false, detail: `Kopia refused to start the snapshot (HTTP ${res.status})` };
    }
    const perSource = Object.values((res.body as UploadResponse | null)?.sources ?? {});
    if (perSource.length > 0 && perSource[0].success === false) {
      return { started: false, detail: 'Kopia reported the snapshot did not succeed' };
    }
    return { started: true, detail: `triggered a Kopia snapshot of ${SOURCE_PATH}` };
  } catch (error) {
    return { started: false, detail: (error as Error).message };
  }
}

// ---------------------------------------------------------------------------
// list snapshots
// ---------------------------------------------------------------------------

export interface KopiaSnapshotInfo {
  /** Manifest id — identifies the snapshot. */
  id: string;
  /** Root object id — what a restore is pointed at. */
  rootId: string;
  startTime: string | null;
  endTime: string | null;
  sizeBytes: number | null;
  fileCount: number | null;
  /** Why retention keeps this one, e.g. `["latest-1","daily-1"]`. */
  retentionReasons: string[];
}

interface SnapshotsResponse {
  snapshots?: Array<{
    id?: string;
    rootID?: string;
    startTime?: string;
    endTime?: string;
    summary?: { size?: number; files?: number };
    retention?: string[];
  }>;
}

function toSnapshotInfo(raw: NonNullable<SnapshotsResponse['snapshots']>[number]): KopiaSnapshotInfo {
  return {
    id: raw.id ?? '',
    rootId: raw.rootID ?? '',
    startTime: raw.startTime ?? null,
    endTime: raw.endTime ?? null,
    sizeBytes: typeof raw.summary?.size === 'number' ? raw.summary.size : null,
    fileCount: typeof raw.summary?.files === 'number' ? raw.summary.files : null,
    retentionReasons: raw.retention ?? [],
  };
}

/**
 * The snapshots held for `/source/apps` (or another path), oldest first.
 * Returns `[]` on any failure — a status card listing restore points must
 * degrade quietly, not throw (mirrors `getBackupJobStatus`).
 */
export async function listSnapshots(password: string, path: string = SOURCE_PATH): Promise<KopiaSnapshotInfo[]> {
  try {
    const session = await openSession(password);
    const id = await localSourceId(session, path);
    const res = await api(session, `/api/v1/snapshots${sourceQuery(id)}`);
    if (res.status !== 200) {
      return [];
    }
    return ((res.body as SnapshotsResponse | null)?.snapshots ?? []).map(toSnapshotInfo);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// restore
// ---------------------------------------------------------------------------

export interface RestoreRequest {
  /** Root object id of the snapshot to restore (from `listSnapshots`). */
  rootId: string;
  /** Absolute path *inside the Kopia container* to write the tree to. */
  targetPath: string;
  /**
   * Overwrite files already at the target. Default true — a restore into a
   * prepared empty directory is the normal case; false makes it incremental.
   */
  overwrite?: boolean;
}

/**
 * Start a restore. Returns the async task id to poll with
 * `getRestoreTaskStatus`. Throws on failure — restore is an explicit,
 * destructive-ish action and the caller must not mistake a rejection for
 * "in progress".
 */
export async function restoreSnapshot(
  password: string,
  request: RestoreRequest
): Promise<{ taskId: string }> {
  const session = await openSession(password);
  const res = await api(session, '/api/v1/restore', {
    method: 'POST',
    timeoutMs: RESTORE_TIMEOUT_MS,
    body: {
      root: request.rootId,
      fsOutput: {
        targetPath: request.targetPath,
        skipOwners: false,
        skipPermissions: false,
        skipTimes: false,
      },
      options: {
        // Without this Kopia does a *shallow* restore: directories below a
        // small depth become `<name>.kopia-entry` placeholder files instead
        // of real content. Max int32 means "fully restore everything".
        restoreDirEntryAtDepth: 2147483647,
        minSizeForPlaceholder: 0,
        incremental: request.overwrite === false,
        ignoreErrors: false,
      },
    },
  });
  if (res.status !== 200) {
    throw new Error(`Kopia rejected the restore (HTTP ${res.status}): ${describeError(res.body)}`);
  }
  const taskId = (res.body as { id?: string } | null)?.id;
  if (!taskId) {
    throw new Error('Kopia accepted the restore but returned no task id.');
  }
  return { taskId };
}

export interface KopiaTaskStatus {
  /** `RUNNING` | `SUCCESS` | `FAILED` | `CANCELED` (Kopia's own strings). */
  status: string;
  running: boolean;
  succeeded: boolean;
  restoredBytes: number | null;
  restoredFiles: number | null;
  error: string | null;
}

interface KopiaTask {
  status?: string;
  errorMessage?: string;
  counters?: Record<string, { value?: number }>;
}

function counter(task: KopiaTask, name: string): number | null {
  const v = task.counters?.[name]?.value;
  return typeof v === 'number' ? v : null;
}

/**
 * Poll a restore (or any Kopia server task) by id. Throws if the lookup itself
 * fails; a task that finished with `FAILED` is a normal return with
 * `succeeded:false` and `error` set.
 */
export async function getRestoreTaskStatus(password: string, taskId: string): Promise<KopiaTaskStatus> {
  const session = await openSession(password);
  const res = await api(session, `/api/v1/tasks/${encodeURIComponent(taskId)}`);
  if (res.status !== 200) {
    throw new Error(`Kopia task ${taskId} lookup failed (HTTP ${res.status}).`);
  }
  const task = res.body as KopiaTask;
  return {
    status: task.status ?? 'UNKNOWN',
    running: task.status === 'RUNNING',
    succeeded: task.status === 'SUCCESS',
    restoredBytes: counter(task, 'Restored Bytes'),
    restoredFiles: counter(task, 'Restored Files'),
    error: task.errorMessage ?? null,
  };
}

// ---------------------------------------------------------------------------
// Read-only status for the dashboard's schedule card (later slices).
// Mirrors duplicatiClient.getBackupJobStatus: never throws, degrades to
// "unreachable" so the page still renders.
// ---------------------------------------------------------------------------

export interface KopiaBackupStatus {
  /** Kopia's web server answered. false → everything below is null/false. */
  reachable: boolean;
  /** `/source/apps` is registered as a snapshot source. */
  configured: boolean;
  /** Human-readable repository description, e.g. "Repository in Filesystem: /repository". */
  repositoryDescription: string | null;
  /** Backend kind, e.g. "filesystem", "s3", "gcs". */
  storageType: string | null;
  /** Restore points currently held for the managed source. */
  snapshotCount: number | null;
  lastSnapshotAt: string | null;
  lastSnapshotSizeBytes: number | null;
  lastSnapshotFileCount: number | null;
  /** File-level errors in the last snapshot (a non-zero here is worth a warning). */
  lastSnapshotErrorCount: number | null;
  /** Source state: `IDLE`, `UPLOADING`, `PENDING`, … */
  sourceStatus: string | null;
}

const UNREACHABLE_STATUS: KopiaBackupStatus = {
  reachable: false,
  configured: false,
  repositoryDescription: null,
  storageType: null,
  snapshotCount: null,
  lastSnapshotAt: null,
  lastSnapshotSizeBytes: null,
  lastSnapshotFileCount: null,
  lastSnapshotErrorCount: null,
  sourceStatus: null,
};

export async function getBackupSourceStatus(password: string | null): Promise<KopiaBackupStatus> {
  if (!password) {
    return UNREACHABLE_STATUS;
  }
  try {
    const session = await openSession(password);

    const repo = await api(session, '/api/v1/repo/status');
    const repoStatus = repo.body as { connected?: boolean; description?: string; storage?: string } | null;
    if (repo.status !== 200) {
      return UNREACHABLE_STATUS;
    }
    if (!repoStatus?.connected) {
      // Server is up but has no repository — reachable, nothing else known.
      return { ...UNREACHABLE_STATUS, reachable: true };
    }

    const list = await api(session, '/api/v1/sources');
    const info = list.body as SourcesResponse | null;
    const managed = (info?.sources ?? []).find((s) => s.source.path === SOURCE_PATH);

    let snapshotCount: number | null = null;
    if (managed && info?.localUsername && info?.localHost) {
      const snaps = await api(
        session,
        `/api/v1/snapshots${sourceQuery({ userName: info.localUsername, host: info.localHost, path: SOURCE_PATH })}`
      );
      const arr = (snaps.body as SnapshotsResponse | null)?.snapshots;
      snapshotCount = Array.isArray(arr) ? arr.length : null;
    }

    return {
      reachable: true,
      configured: Boolean(managed),
      repositoryDescription: repoStatus.description ?? null,
      storageType: repoStatus.storage ?? null,
      snapshotCount,
      lastSnapshotAt: managed?.lastSnapshot?.startTime ?? null,
      lastSnapshotSizeBytes:
        typeof managed?.lastSnapshot?.stats?.totalSize === 'number'
          ? managed.lastSnapshot.stats.totalSize
          : null,
      lastSnapshotFileCount:
        typeof managed?.lastSnapshot?.stats?.fileCount === 'number'
          ? managed.lastSnapshot.stats.fileCount
          : null,
      lastSnapshotErrorCount:
        typeof managed?.lastSnapshot?.stats?.errorCount === 'number'
          ? managed.lastSnapshot.stats.errorCount
          : null,
      sourceStatus: managed?.status ?? null,
    };
  } catch {
    return UNREACHABLE_STATUS;
  }
}
