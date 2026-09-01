export interface User {
  id: number;
  username: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
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
  setupTokenSupported?: boolean;
  adminUserManagementSupported?: boolean;
  dependsOn?: string[];
  ports?: ServicePortMapping[];
  exposedHostname?: string | null;
  // URL path suffix for the app's web UI when it isn't the bare root
  // (e.g. Pi-hole's `/admin`) — appended to the public URL for "open" links.
  webPath?: string;
  // Published host port of the app's web UI while running — used for a LAN
  // "open" link when the app isn't publicly exposed.
  webPort?: number | null;
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
}

export interface CloudflareSettings {
  configured: boolean;
  tokenMasked: string | null;
  permissionExplanation: string;
  message?: string;
}

export interface CloudflareTestResponse {
  success: boolean;
  message: string;
}

export interface ExposureSettings {
  configured: boolean;
  baseDomain: string | null;
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
}

export interface ExposureSettingsInput {
  baseDomain: string;
  npmApiUrl: string;
  npmEmail: string;
  npmPassword?: string;
  cloudflareAccountId: string;
  cloudflareZoneId: string;
  cloudflareTunnelId: string;
}

export interface ServiceExposureConfig {
  enabled: boolean;
  // False for services with no published port at all (e.g. a VPN client
  // sidecar with no web UI) — nothing a reverse proxy could ever forward
  // to. hostname/lastError are always null when this is false.
  exposable: boolean;
  hostname: string | null;
  upstreamScheme: 'http' | 'https';
  upstreamHost: string | null;
  upstreamPort: number | null;
  websocket: boolean;
  autheliaProtected: boolean;
  status: string;
  lastError: string | null;
}

export interface ServiceExposureUpdate {
  enabled: boolean;
  autheliaProtected?: boolean;
}

export interface ServiceExposureVerifyResult {
  attempted: boolean;
  success?: boolean;
  warning?: string;
  hostname?: string;
  status: string | null;
  lastError: string | null;
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

export type BackupScheduleFrequency = 'daily' | 'weekly';

export interface BackupScheduleConfig {
  enabled: boolean;
  frequency: BackupScheduleFrequency;
  retentionCount: number;
  lastRunAt: string | null;
}

export interface HealthAlert {
  metric: string;
  value: number;
  threshold: number;
}

export interface AdminUser {
  id: number;
  username: string;
  created_at: string;
}

export interface AdminUserListResponse {
  items: AdminUser[];
}

export interface HealthStatus {
  status: 'ok' | 'degraded';
  database: string;
  disk: { percentUsed: number; totalBytes: number; usedBytes: number; availableBytes: number };
  memory: { percentUsed: number; totalBytes: number; usedBytes: number };
  load: { oneMinute: number; loadPerCpu: number };
  thresholds: { diskPercent: number; memoryPercent: number; loadPerCpu: number };
  alerts: HealthAlert[];
  timestamp: string;
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

export type BackupTargetKind = 'disk' | 'smb' | 'nfs' | 'googledrive';

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
  folder: string | null;
  authIdConfigured: boolean;
  /** Where the user obtains a Google Drive AuthID. */
  oauthUrl: string;
}

export interface BackupTargetInput {
  kind: BackupTargetKind;
  path?: string;
  server?: string;
  share?: string;
  username?: string;
  password?: string;
  options?: string;
  authId?: string;
  folder?: string;
}

export interface BackupTargetTestResponse {
  success: boolean;
  message: string;
  detail: string;
}

export interface BackupJobProvisionResponse {
  message: string;
  jobId: string;
  targetUrl: string;
  /** Shown once so it can be recorded off-box — backups are unrestorable without it. */
  passphrase: string;
  scheduled: string;
}
