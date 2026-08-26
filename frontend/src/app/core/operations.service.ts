import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api';
import { SKIP_AUTH, SKIP_GLOBAL_ERROR_HANDLING } from './http-context';
import {
  AdminUser,
  AdminUserListResponse,
  AuditLogResponse,
  BackupListResponse,
  BackupScheduleConfig,
  HealthStatus,
  ServiceEnvStatus,
  ServiceExposureConfig,
  ServiceExposureUpdate,
  ServiceExposureVerifyResult,
} from './models';

@Injectable({
  providedIn: 'root'
})
export class OperationsService {
  private readonly http = inject(HttpClient);

  getAuditLogs(params: Record<string, string | number>): Observable<AuditLogResponse> {
    return this.http.get<AuditLogResponse>(`${API_BASE_URL}/audit-logs`, { params });
  }

  getAuditExportUrl(params: URLSearchParams): string {
    return `${API_BASE_URL}/audit-logs/export.csv?${params.toString()}`;
  }

  downloadAuditCsv(params: Record<string, string>): Observable<Blob> {
    return this.http.get(`${API_BASE_URL}/audit-logs/export.csv`, {
      params,
      responseType: 'blob'
    });
  }

  listBackups(): Observable<BackupListResponse> {
    return this.http.get<BackupListResponse>(`${API_BASE_URL}/backups`);
  }

  createBackup(): Observable<{ message: string; fileName: string; downloadUrl: string }> {
    return this.http.post<{ message: string; fileName: string; downloadUrl: string }>(
      `${API_BASE_URL}/backups/create`,
      {}
    );
  }

  restoreBackup(fileName: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${API_BASE_URL}/backups/restore`, { fileName });
  }

  downloadBackup(fileName: string): Observable<Blob> {
    return this.http.get(`${API_BASE_URL}/backups/download/${encodeURIComponent(fileName)}`, {
      responseType: 'blob'
    });
  }

  getBackupSchedule(): Observable<BackupScheduleConfig> {
    return this.http.get<BackupScheduleConfig>(`${API_BASE_URL}/backups/schedule`);
  }

  updateBackupSchedule(config: Omit<BackupScheduleConfig, 'lastRunAt'>): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${API_BASE_URL}/backups/schedule`, config);
  }

  getServiceExposure(serviceName: string): Observable<ServiceExposureConfig> {
    return this.http.get<ServiceExposureConfig>(`${API_BASE_URL}/services/${serviceName}/exposure`);
  }

  updateServiceExposure(serviceName: string, update: ServiceExposureUpdate): Observable<{ message: string; hostname: string | null }> {
    return this.http.put<{ message: string; hostname: string | null }>(
      `${API_BASE_URL}/services/${serviceName}/exposure`,
      update
    );
  }

  verifyServiceExposure(serviceName: string): Observable<ServiceExposureVerifyResult> {
    return this.http.post<ServiceExposureVerifyResult>(`${API_BASE_URL}/services/${serviceName}/exposure/verify`, {});
  }

  getServiceEnv(serviceName: string): Observable<ServiceEnvStatus> {
    return this.http.get<ServiceEnvStatus>(`${API_BASE_URL}/services/${serviceName}/env`);
  }

  updateServiceEnv(serviceName: string, values: Record<string, string>): Observable<{ message: string } & ServiceEnvStatus> {
    return this.http.put<{ message: string } & ServiceEnvStatus>(`${API_BASE_URL}/services/${serviceName}/env`, {
      values,
    });
  }

  getHealth(): Observable<HealthStatus> {
    return this.http.get<HealthStatus>(`${API_BASE_URL}/health/system`);
  }

  getRecoveryStatus(): Observable<{ enabled: boolean }> {
    return this.http.get<{ enabled: boolean }>(
      `${API_BASE_URL}/recovery/status`,
      { context: new HttpContext().set(SKIP_AUTH, true).set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  enableRecoveryMode(): Observable<{ enabled: boolean; message: string }> {
    return this.http.post<{ enabled: boolean; message: string }>(
      `${API_BASE_URL}/recovery/enable`,
      { confirm: 'ENABLE_RECOVERY_MODE' },
      { context: new HttpContext().set(SKIP_AUTH, true).set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  disableRecoveryMode(): Observable<{ enabled: boolean; message: string }> {
    return this.http.post<{ enabled: boolean; message: string }>(
      `${API_BASE_URL}/recovery/disable`,
      {},
      { context: new HttpContext().set(SKIP_AUTH, true).set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  listUsers(): Observable<AdminUserListResponse> {
    return this.http.get<AdminUserListResponse>(`${API_BASE_URL}/users`);
  }

  createUser(username: string, password: string): Observable<{ user: AdminUser }> {
    return this.http.post<{ user: AdminUser }>(`${API_BASE_URL}/users`, { username, password });
  }

  updateUserPassword(id: number, password: string): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${API_BASE_URL}/users/${id}/password`, { password });
  }

  deleteUser(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${API_BASE_URL}/users/${id}`);
  }

  resetAdminPassword(username: string, password: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${API_BASE_URL}/recovery/reset-admin-password`,
      { username, password },
      { context: new HttpContext().set(SKIP_AUTH, true).set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }
}
