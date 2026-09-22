export interface User {
  id: number;
  username: string;
  // Named roles (plan.md §149, §152). The login / setup / refresh responses
  // carry this.
  roles?: Role[];
  // The effective dashboard capabilities the backend computed for this account
  // (plan.md §152). Authoritative for gating — the role→capability constant
  // can't know an admin's per-account feature grants. Absent on sessions
  // opened before §152; `AuthService` then falls back to the role constant.
  capabilities?: string[];
}

export type Role = 'webmaster' | 'admin' | 'user';

/** One account in the Users & roles list. */
export interface ManagedUser {
  id: number;
  username: string;
  createdAt?: string;
  created_at?: string;
  roles: Role[];
  capabilities?: string[];
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

/**
 * What POST /auth/login returns (202) when the password is right but the
 * account has a TOTP second factor. The mfaToken is spent at
 * POST /auth/login/totp and is never persisted.
 */
export interface MfaChallenge {
  mfaRequired: true;
  mfaToken: string;
}

export type LoginResult = AuthResponse | MfaChallenge;

export function isMfaChallenge(result: LoginResult): result is MfaChallenge {
  return (result as MfaChallenge).mfaRequired === true;
}

/** GET /auth/totp/status — what the Account security page renders from. */
export interface TotpStatus {
  enabled: boolean;
  enrolledAt: string | null;
  recoveryCodesRemaining: number;
}

/** POST /auth/totp/setup — a pending (not yet active) secret plus its QR. */
export interface TotpSetupResponse {
  otpauthUri: string;
  qrSvg: string;
  secret: string;
}

/** POST /auth/totp/activate — the one-time recovery codes, shown only now. */
export interface TotpActivateResponse {
  enabled: true;
  recoveryCodes: string[];
}

export type ServiceCategory =
  | 'Networking & Security'
  | 'Monitoring & Management'
  | 'Media'
  | 'Backup & Storage'
  | 'Productivity'
  | 'Home Automation'
  | 'Development';

export interface ServicePortMapping {
  hostPort: string;
  containerPort: string;
  protocol: string;
}

// What the row's Start/Stop buttons can ask for. There is no per-app
// `update` action any more (§209) — managed-app images only ever move as a
// batch step of a Business Lab self-update, never independently per app.
export type ServiceAction = 'start' | 'stop';

export interface ServiceStatus {
  name: string;
  label: string;
  description: string;
  icon: string;
  category?: ServiceCategory;
  state: 'running' | 'stopped' | 'starting' | 'error' | 'unknown';
  healthy: boolean;
  lastChecked: string;
  error?: string;
  adminUserManagementSupported?: boolean;
  // Must be running before this app can start — the Start button is disabled
  // while one of them is down, and the API refuses the start with a 409.
  dependsOn?: string[];
  // Needed for the app to work properly, but not to boot: listed with live
  // state and warned about, never blocking.
  requires?: string[];
  // Image refs the last self-update (§209) pinned into the app's managed
  // docker-compose.override.yml (`repo:tag@sha256:…`) — what's actually
  // installed. Surfaced on the card as a single version-info badge.
  pinnedImages?: string[];
  // Non-`latest` tags baked into the app's own compose file (e.g. Guacamole
  // must match guacd's version) — falls back to this when nothing's pinned.
  versionPinned?: string[];
  ports?: ServicePortMapping[];
  exposedHostname?: string | null;
  // URL path suffix for the app's web UI when it isn't the bare root
  // (e.g. Pi-hole's `/admin`) — appended to the public URL for "open" links.
  webPath?: string;
  // Published host port of the app's web UI while running — used for a LAN
  // "open" link when the app isn't publicly exposed.
  webPort?: number | null;
  // Never on the public tunnel regardless of exposability — labels why the
  // LAN link is the only one (lanOnly) or names the overlay VPN (overlayOnly).
  lanOnly?: boolean;
  overlayOnly?: boolean;
  // Live secondary hostnames from this service's `additionalExposures`
  // (services.ts) — the URL a native client (e.g. NetBird's mobile/desktop
  // app, which points at the Management API, not the browser dashboard)
  // actually needs, when it differs from `exposedHostname`.
  additionalExposureUrls?: { label: string; hostname: string }[];
}

export interface AutheliaAdminUser {
  username: string;
  displayName: string;
  email: string;
  groups: string[];
}

export interface AutheliaAdminUserUpdate {
  username: string;
  displayName: string;
  email: string;
  // Omit or leave blank to keep the current password.
  password?: string;
}

export interface StartupActionEvent {
  serviceName: string;
  // Whether `docker compose up` for this start attempt succeeded.
  ok: boolean;
  // Success message, or the failure detail (compose output / error text).
  message: string;
}

export interface ServiceSummary {
  total: number;
  running: number;
  stopped: number;
  error: number;
  starting: number;
}

export interface ServiceStatusResponse {
  timestamp: string;
  services: ServiceStatus[];
  summary: ServiceSummary;
  // Host-wide, not per-service — where a LAN/overlay-only app's access link
  // points instead of the dashboard's own (possibly public) hostname.
  hostLanIp?: string | null;
}

/** Which Cloudflare account holds the client's zone (plan.md §203/§357). */
export type CloudflareAccountModel = 'self-controlled' | 'contracted';

export interface CloudflareSettings {
  configured: boolean;
  tokenMasked: string | null;
  permissionExplanation: string;
  accountModel: CloudflareAccountModel | null;
  message?: string;
}

export interface CloudflareTestResponse {
  success: boolean;
  message: string;
  // Present when Zone:Read let us count; `warning` is set when > 1 (an
  // account-wide token — see §357 P9b).
  zoneCount?: number;
  warning?: string;
}

/** GET/PUT /settings/claude-key. The key itself is never sent back. */
export interface ClaudeKeySettings {
  configured: boolean;
  keyMasked: string | null;
  message?: string;
}

export interface ClaudeKeyTestResponse {
  success: boolean;
  message: string;
}

/** A generated social-media post draft (plan.md §254 P2). */
export interface SocialDraft {
  id: number;
  prompt: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExposureSettings {
  configured: boolean;
  baseDomain: string | null;
  // Derived server-side (docker bridge gateway + NPM_ADMIN_PORT), read-only.
  npmApiUrl: string | null;
  npmEmail: string | null;
  npmPasswordConfigured: boolean;
  cloudflareAccountId: string | null;
  cloudflareZoneId: string | null;
  cloudflareTunnelId: string | null;
}

export interface ExposureTestCheckResult {
  success: boolean;
  message: string;
}

export interface ExposureTestResponse {
  success: boolean;
  npm: ExposureTestCheckResult;
  cloudflare: ExposureTestCheckResult;
}

export interface GeneralSettings {
  timezone: string;
  defaultTimezone: string;
  timezones: string[];
  // Operator-set base URL for links the dashboard emails (invites, §158);
  // '' when unset. `dashboardUrlEffective` is what will actually be used — the
  // stored value or a derived `dashboard.<domain>` guess, or null.
  dashboardUrl?: string;
  dashboardUrlEffective?: string | null;
  // Branch the Update page's self-update panel fetches/pulls — 'main' unless
  // this deployment tracks something else (plan.md §406).
  updateBranch?: string;
  defaultUpdateBranch?: string;
}

/** GET /api/settings/deployment — the per-client provisioning checklist (§357). */
export interface DeploymentCheck {
  id: string;
  label: string;
  done: boolean;
  detail: string;
  fixIn: string;
}

export interface DeploymentStatus {
  checks: DeploymentCheck[];
  outstanding: number;
}

/** GET /api/auth/invitation/:token — what the set-password screen shows. */
export interface InvitationInfo {
  username: string;
  email: string;
}

// Every alert source. Matches backend/src/utils/alertNotify.ts's AlertSource.
export type AlertCategory = 'crowdsec' | 'critical-service' | 'netbird' | 'backup';

export interface AlertNotifySettings {
  // The default ntfy topic — a category with no override of its own
  // publishes here. Subscribe to it in an ntfy client.
  topic: string;
  // Every category's resolved topic (its own override, or the default).
  topics: Record<AlertCategory, string>;
  // Per-source flags.
  crowdsecEnabled: boolean;
  // Whether CrowdSec's bans are actually enforced, by the Lua bouncer inside
  // Nginx Proxy Manager. Detection-only when off — and the alert wording
  // follows it, so a push only says "banned" when the ban is real.
  enforceNpm: boolean;
}

// One banned IP from CrowdSec's own detections (not the community
// blocklist), as listed under Settings for unbanning (plan.md §540).
export interface CrowdsecBan {
  ip: string;
  scenarios: string[];
  expiresInSeconds: number;
  country: string | null;
  asName: string | null;
  since: string | null;
}

export interface ExposureSettingsInput {
  baseDomain: string;
  npmEmail: string;
  npmPassword?: string;
  cloudflareAccountId: string;
  cloudflareZoneId: string;
  cloudflareTunnelId: string;
}

export interface ServiceEnvField {
  key: string;
  required: boolean;
  secret: boolean;
  isSet: boolean;
  // Render a true/false choice instead of a text field.
  boolean: boolean;
  // Generated and persisted automatically on save — never rendered.
  hidden: boolean;
  // Value is derived automatically (managedEnvKeys, or an exposure override
  // while exposure is on) and shown read-only; never submitted by the client.
  managed: boolean;
  // The exposure-derived value for a managed field, when exposure is on.
  managedValue: string | null;
  value: string | null;
  defaultValue: string | null;
  // A value to pre-fill an unset field with (saved as-is): a generated secret
  // for auto-generated keys, or the dashboard-wide timezone for `TZ`.
  suggestedValue: string | null;
  // True for `*_PORT` keys — a host port validated against what's already
  // published by other services.
  isPort: boolean;
  // A fixed protocol port (NPM's 80/443, Pi-hole's 53). Rendered read-only —
  // the backend also refuses to write it. See docs/ports.md.
  locked: boolean;
  lockedReason: string | null;
  // Port fields only: whether the effective value collides with a port
  // another service already publishes, and the next free port to offer.
  portInUse: boolean;
  suggestedPort: number | null;
}

export interface ServiceEnvStatus {
  envFileExists: boolean;
  fields: ServiceEnvField[];
}

export interface ServiceActionResponse {
  message: string;
  exposure?: { attempted: boolean; success?: boolean; warning?: string; hostname?: string };
}

export interface ToastMessage {
  id: number;
  variant: 'success' | 'danger' | 'warning' | 'info';
  text: string;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'sse' | 'polling' | 'disconnected';

export interface AuditLogEntry {
  id: number;
  username: string | null;
  action: string;
  resource: string | null;
  result: string;
  created_at: string;
  ip: string | null;
}

export interface AuditLogResponse {
  items: AuditLogEntry[];
  page: number;
  pageSize: number;
  total: number;
}

export interface BackupFile {
  name: string;
  size: number;
  createdAt: string;
}

export interface BackupListResponse {
  items: BackupFile[];
}

/** One Kopia snapshot of the managed apps/ tree — GET /backups/remote. */
export interface RemoteBackupSnapshot {
  id: string;
  rootId: string;
  startTime: string | null;
  endTime: string | null;
  sizeBytes: number | null;
  fileCount: number | null;
  /** Why retention keeps this one, e.g. `["latest-1","daily-1"]`. */
  retentionReasons: string[];
}

export interface RemoteBackupListResponse {
  items: RemoteBackupSnapshot[];
}

// ---- Per-app backup / restore (plan.md §185) ----

export interface AppBackupDump {
  target: string;
  kind: string;
  bytes: number | null;
  detail: string;
}

export interface AppBackupManifest {
  app: string;
  createdAt: string;
  dashboardVersion: string;
  engine: string | null;
  archiveBytes: number;
  dumps: AppBackupDump[];
  dumpFailures: AppBackupDump[];
}

export interface AppBackupEntry {
  file: string;
  bytes: number;
  createdAt: string;
  /** null when the manifest sidecar is missing or unreadable. */
  manifest: AppBackupManifest | null;
}

export interface AppBackupListResponse {
  items: AppBackupEntry[];
}

export interface AppBackupCreateResponse {
  success: boolean;
  service: string;
  file: string;
  manifest: AppBackupManifest;
  dumpFailures: AppBackupDump[];
  message: string;
}

export interface AppRestoreResponse {
  success: boolean;
  service: string;
  file: string;
  fileRestore: string;
  databaseRestore: AppBackupDump | null;
  warnings: string[];
  message: string;
}

export type BackupScheduleFrequency = 'daily' | 'weekly';

/** The values the user actually chooses; the rest is run history. */
export interface BackupScheduleSettings {
  enabled: boolean;
  frequency: BackupScheduleFrequency;
  /** Local server time the schedule tries to run at, "HH:mm". */
  runAtTime: string;
  retentionCount: number;
}

export type BackupRunOutcome = 'success' | 'failed';

export interface BackupScheduleConfig extends BackupScheduleSettings {
  /** When the schedule last *attempted* a run — not whether it worked. */
  lastRunAt: string | null;
  lastOutcome: BackupRunOutcome | null;
  /** When one last worked end to end. The value worth alarming on. */
  lastSuccessAt: string | null;
  consecutiveFailures: number;
}

/** Read-only view of what Kopia actually holds — see GET /backups/status. */
export interface BackupJobStatus {
  /** Kopia's web server answered. false → everything below is null/false. */
  reachable: boolean;
  /** The managed app-data source is registered as a snapshot source. */
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

export interface BackupAppDumpFailure {
  app: string;
  kind: string;
  detail: string;
}

export interface BackupLastAppDataDump {
  at: string;
  result: string;
  dumped: number | null;
  failed: number | null;
  trigger: string | null;
  failures: BackupAppDumpFailure[];
}

export interface BackupStatusResponse {
  job: BackupJobStatus;
  lastAppData: BackupLastAppDataDump | null;
}

export interface BackupProgress {
  running: boolean;
  trigger: 'scheduled' | 'manual' | null;
  phase: 'idle' | 'dumping' | 'snapshotting' | 'done';
  index: number;
  total: number;
  label: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean | null;
  detail: string | null;
}

export interface HealthAlert {
  metric: string;
  value: number;
  threshold: number;
}

export interface AdminUser {
  id: number;
  username: string;
  email: string | null;
  created_at: string;
  roles: Role[];
  // Effective capabilities the account holds — an admin's grants (or all-on
  // when it has none), everything for a webmaster, nothing for a user.
  capabilities?: string[];
  // Managed apps this account may reach — through Authelia SSO, or (§480) a
  // no-SSO app that mirrors this account's own credentials instead.
  appAccess?: string[];
  // false while the account's set-password invite is still outstanding (§158).
  active?: boolean;
}

export interface AdminUserListResponse {
  items: AdminUser[];
}

/** One choice in the app-access picker — GET /api/users/app-access-options. */
export interface AppAccessOption {
  serviceName: string;
  label: string;
  hostname: string | null;
  /** Named Authelia groups a grant to this app also implies. */
  requiredGroups: string[];
}

export interface AppAccessOptionsResponse {
  items: AppAccessOption[];
}

export interface DiskUsage {
  name: string;
  path: string;
  percentUsed: number;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
}

export interface HealthStatus {
  status: 'ok' | 'degraded';
  database: string;
  // One entry per filesystem worth watching: `docker` is wherever Docker's
  // data root lives, `system` is the host's own root. They are the same
  // filesystem until the data root is moved off it, and the API sends one
  // entry while that is true.
  disks: DiskUsage[];
  // Percent of CPU time spent non-idle since the previous poll (or a short
  // inline sample when polls are too close together). Not thresholded — it
  // does not feed `status` — the header strip colours it on its own.
  cpu: { percentUsed: number };
  memory: { percentUsed: number; totalBytes: number; usedBytes: number };
  load: { oneMinute: number; loadPerCpu: number };
  thresholds: { diskPercent: number; memoryPercent: number; loadPerCpu: number };
  alerts: HealthAlert[];
  timestamp: string;
}

export interface DiscoveredHost {
  ip: string;
  hostname: string | null;
  type: string | null;
}

export type MailEncryption = 'tls' | 'ssl' | 'none';

/** Shape returned by GET /settings/mail. Passwords are never sent back. */
export interface MailSettings {
  configured: boolean;
  receiveConfigured: boolean;
  smtpHost: string | null;
  smtpPort: string | null;
  smtpUser: string | null;
  smtpPasswordConfigured: boolean;
  smtpEncryption: MailEncryption;
  fromAddress: string | null;
  fromName: string | null;
  imapHost: string | null;
  imapPort: string | null;
  imapUser: string | null;
  imapPasswordConfigured: boolean;
  imapEncryption: MailEncryption;
}

export interface MailSettingsInput {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  /** Omitted to keep the stored password unchanged. */
  smtpPassword?: string;
  smtpEncryption: MailEncryption;
  fromAddress: string;
  fromName?: string;
  imapHost?: string;
  imapPort?: number | null;
  imapUser?: string;
  imapPassword?: string;
  imapEncryption?: MailEncryption;
}

export interface MailTestResponse {
  success: boolean;
  message: string;
  smtp: { ok: boolean; detail: string };
  imap: { ok: boolean; detail: string } | null;
}

export type BackupTargetKind = 'disk' | 'smb' | 'nfs' | 's3' | 'ftp' | 'ftps' | 'sftp' | 'webdav';

/** GET /settings/backup-target. Secrets report only whether they are set. */
export interface BackupTargetSettings {
  configured: boolean;
  kind: BackupTargetKind;
  path: string | null;
  server: string | null;
  share: string | null;
  username: string | null;
  passwordConfigured: boolean;
  options: string | null;
}

export interface BackupTargetInput {
  kind: BackupTargetKind;
  path?: string;
  server?: string;
  share?: string;
  username?: string;
  password?: string;
  options?: string;
}

export interface BackupTargetTestResponse {
  success: boolean;
  message: string;
  detail: string;
}

/** PUT /settings/backup-target. `restarted` is whether Kopia's container was
 * successfully brought back up against the new destination — the save modal
 * only starts polling `KopiaStatus` when this is true. */
export interface BackupTargetSaveResponse {
  message: string;
  restarted: boolean;
}

/** GET /settings/backup-target/kopia-status — polled after a destination
 * save until Kopia reconnects (or fails) against it. */
export interface KopiaStatus {
  ok: boolean;
  detail: string;
}

export type SelfUpdateRunState =
  | 'checking'
  | 'pulling'
  | 'building'
  | 'updating_apps'
  | 'restarting_frontend'
  | 'restarting_backend'
  | 'done'
  | 'error';

export interface SelfUpdateRun {
  id: number;
  state: SelfUpdateRunState;
  fromCommit: string | null;
  toCommit: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface SelfUpdateCheck {
  currentCommit: string;
  remoteCommit: string;
  commitsBehind: number;
  checkedAt: string;
  branch: string;
}

export interface SelfUpdateCheckError {
  message: string;
  at: string;
}

export interface SelfUpdateStatus {
  appVersion: string;
  check: SelfUpdateCheck | null;
  lastCheckError: SelfUpdateCheckError | null;
  latestRun: SelfUpdateRun | null;
}
