import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api';
import { SKIP_AUTH, SKIP_GLOBAL_ERROR_HANDLING } from './http-context';
import { AuditLogResponse, BackupListResponse, HealthStatus } from './models';

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

  resetAdminPassword(username: string, password: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${API_BASE_URL}/recovery/reset-admin-password`,
      { username, password },
      { context: new HttpContext().set(SKIP_AUTH, true).set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }
}
