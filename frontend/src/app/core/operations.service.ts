import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api';
import { SKIP_AUTH, SKIP_GLOBAL_ERROR_HANDLING } from './http-context';
import {
  AdminUser,
  AdminUserListResponse,
  AppAccessOptionsResponse,
  AuditLogResponse,
  AutheliaAdminUser,
  AutheliaAdminUserUpdate,
  BackupListResponse,
  BackupScheduleConfig,
  BackupScheduleSettings,
  BackupStatusResponse,
  DiscoveredHost,
  HealthStatus,
  ServiceEnvStatus,
  ServiceExposureConfig,
  ServiceExposureUpdate,
  ServiceExposureVerifyResult,
  TotpActivateResponse,
  TotpSetupResponse,
  TotpStatus,
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

  getBackupStatus(): Observable<BackupStatusResponse> {
    return this.http.get<BackupStatusResponse>(`${API_BASE_URL}/backups/status`);
  }

  runAppDataBackup(): Observable<{ ok: boolean; message: string }> {
    return this.http.post<{ ok: boolean; message: string }>(`${API_BASE_URL}/backups/run`, {});
  }

  updateBackupSchedule(config: BackupScheduleSettings): Observable<{ message: string }> {
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

  getAutheliaAdminUser(serviceName: string): Observable<AutheliaAdminUser> {
    return this.http.get<AutheliaAdminUser>(`${API_BASE_URL}/services/${serviceName}/admin-user`);
  }

  updateAutheliaAdminUser(
    serviceName: string,
    update: AutheliaAdminUserUpdate
  ): Observable<{ message: string; user: AutheliaAdminUser }> {
    return this.http.put<{ message: string; user: AutheliaAdminUser }>(
      `${API_BASE_URL}/services/${serviceName}/admin-user`,
      update
    );
  }

  getHealth(): Observable<HealthStatus> {
    return this.http.get<HealthStatus>(`${API_BASE_URL}/health/system`);
  }

  /** Public: the running backend's version, shown in the dashboard footer. */
  getAppVersion(): Observable<{ version: string }> {
    return this.http.get<{ version: string }>(`${API_BASE_URL}/version`, {
      context: new HttpContext().set(SKIP_AUTH, true).set(SKIP_GLOBAL_ERROR_HANDLING, true),
    });
  }

  scanNetwork(): Observable<{ hosts: DiscoveredHost[] }> {
    return this.http.post<{ hosts: DiscoveredHost[] }>(`${API_BASE_URL}/network/scan`, {});
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

  listAppAccessOptions(): Observable<AppAccessOptionsResponse> {
    return this.http.get<AppAccessOptionsResponse>(`${API_BASE_URL}/users/app-access-options`);
  }

  createUser(
    username: string,
    email: string,
    roles: string[],
    options?: { capabilities?: string[]; appAccess?: string[] }
  ): Observable<{ user: AdminUser; invitePending: boolean; warning?: string }> {
    return this.http.post<{ user: AdminUser; invitePending: boolean; warning?: string }>(
      `${API_BASE_URL}/users`,
      {
        username,
        email,
        roles,
        ...(options?.capabilities ? { capabilities: options.capabilities } : {}),
        ...(options?.appAccess ? { appAccess: options.appAccess } : {}),
      }
    );
  }

  resendInvite(id: number): Observable<{ message: string; warning?: string }> {
    return this.http.post<{ message: string; warning?: string }>(
      `${API_BASE_URL}/users/${id}/invitation/resend`,
      {}
    );
  }

  updateUserAccess(
    id: number,
    email: string,
    appAccess: string[]
  ): Observable<{ message: string; email: string; appAccess: string[] }> {
    return this.http.put<{ message: string; email: string; appAccess: string[] }>(
      `${API_BASE_URL}/users/${id}/access`,
      { email, appAccess }
    );
  }

  updateUserRoles(id: number, roles: string[]): Observable<{ message: string; roles: string[] }> {
    return this.http.put<{ message: string; roles: string[] }>(`${API_BASE_URL}/users/${id}/roles`, { roles });
  }

  updateUserCapabilities(
    id: number,
    capabilities: string[]
  ): Observable<{ message: string; capabilities: string[] }> {
    return this.http.put<{ message: string; capabilities: string[] }>(
      `${API_BASE_URL}/users/${id}/capabilities`,
      { capabilities }
    );
  }

  updateUserPassword(id: number, password: string): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${API_BASE_URL}/users/${id}/password`, { password });
  }

  deleteUser(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${API_BASE_URL}/users/${id}`);
  }

  // --- Own-account 2FA (TOTP) enrolment. All behind the access JWT; the
  // login-time second factor lives on AuthService instead (it runs without a
  // session). ---

  getTotpStatus(): Observable<TotpStatus> {
    return this.http.get<TotpStatus>(`${API_BASE_URL}/auth/totp/status`);
  }

  setupTotp(): Observable<TotpSetupResponse> {
    return this.http.post<TotpSetupResponse>(`${API_BASE_URL}/auth/totp/setup`, {});
  }

  activateTotp(code: string): Observable<TotpActivateResponse> {
    return this.http.post<TotpActivateResponse>(`${API_BASE_URL}/auth/totp/activate`, { code });
  }

  /** The backend takes a current 6-digit code XOR the account password. */
  disableTotp(proof: { code: string } | { password: string }): Observable<{ enabled: false }> {
    return this.http.post<{ enabled: false }>(`${API_BASE_URL}/auth/totp/disable`, proof);
  }

  resetAdminPassword(username: string, password: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${API_BASE_URL}/recovery/reset-admin-password`,
      { username, password },
      { context: new HttpContext().set(SKIP_AUTH, true).set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }
}
