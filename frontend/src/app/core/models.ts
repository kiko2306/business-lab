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
  value: string | null;
  defaultValue: string | null;
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
  disk: { percentUsed: number };
  memory: { percentUsed: number };
  load: { oneMinute: number; loadPerCpu: number };
  thresholds: { diskPercent: number; memoryPercent: number; loadPerCpu: number };
  alerts: HealthAlert[];
  timestamp: string;
}
