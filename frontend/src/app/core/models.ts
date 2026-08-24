export interface User {
  id: number;
  username: string;
  role: string;
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
