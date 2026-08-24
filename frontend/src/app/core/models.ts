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
