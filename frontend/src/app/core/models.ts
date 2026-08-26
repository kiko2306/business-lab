export interface User {
  id: number;
  username: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface ServiceStatus {
  name: string;
  label: string;
  description: string;
  icon: string;
  state: 'running' | 'stopped' | 'starting' | 'error' | 'unknown';
  healthy: boolean;
  lastChecked: string;
  error?: string;
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
  hostname: string | null;
  upstreamScheme: 'http' | 'https';
  upstreamHost: string | null;
  upstreamPort: number | null;
  websocket: boolean;
  status: string;
  lastError: string | null;
}

export interface ServiceExposureUpdate {
  enabled: boolean;
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
