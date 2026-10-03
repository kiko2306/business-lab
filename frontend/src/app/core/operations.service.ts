import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api';
import { SKIP_AUTH, SKIP_GLOBAL_ERROR_HANDLING } from './http-context';
import {
  AdminUser,
  AdminUserListResponse,
  AppAccessOptionsResponse,
  AppBackupCreateResponse,
  AppBackupListResponse,
  AppRestoreResponse,
  AuditLogResponse,
  AutheliaAdminUser,
  AutheliaAdminUserUpdate,
  BackupListResponse,
  BackupProgress,
  BackupScheduleConfig,
  BackupScheduleSettings,
  BackupLastAppDataDump,
  BackupStatusResponse,
  RemoteBackupListResponse,
  SnapshotRestoreResponse,
  DiscoveredHost,
  HealthStatus,
  ServiceEnvStatus,
  SelfUpdateCheck,
  SelfUpdateRun,
  SelfUpdateStatus,
  TotpActivateResponse,
  TotpSetupResponse,
  TotpStatus,
} from './models';

@Injectable({
  providedIn: 'root'
})
export class OperationsService {
  private readonly http = inject(HttpClient);

  // The methods below set SKIP_GLOBAL_ERROR_HANDLING because their one caller
  // already shows its own, more specific toast on error — without the flag,
  // a failure showed that toast *and* the interceptor's generic one stacked
  // on top of it (found live during an audit, plan.md §794.1). Checked each
  // one has no other caller that would otherwise go silent.
  getAuditLogs(params: Record<string, string | number>): Observable<AuditLogResponse> {
    return this.http.get<AuditLogResponse>(`${API_BASE_URL}/audit-logs`, {
      params,
      context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true),
    });
  }

  getAuditExportUrl(params: URLSearchParams): string {
    return `${API_BASE_URL}/audit-logs/export.csv?${params.toString()}`;
  }

  downloadAuditCsv(params: Record<string, string>): Observable<Blob> {
    return this.http.get(`${API_BASE_URL}/audit-logs/export.csv`, {
      params,
      responseType: 'blob',
      context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true),
    });
  }

  listBackups(): Observable<BackupListResponse> {
    return this.http.get<BackupListResponse>(`${API_BASE_URL}/backups`, {
      context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true),
    });
  }

  listRemoteBackups(): Observable<RemoteBackupListResponse> {
    return this.http.get<RemoteBackupListResponse>(`${API_BASE_URL}/backups/remote`);
  }

  /**
   * Restore ONE app's data out of an offsite snapshot. Destructive — the app
   * is stopped and its data replaced (plan.md §592).
   */
  restoreAppFromSnapshot(snapshotId: string, app: string): Observable<SnapshotRestoreResponse> {
    return this.http.post<SnapshotRestoreResponse>(`${API_BASE_URL}/backups/remote/restore`, { snapshotId, app });
  }

  createBackup(): Observable<{ message: string; fileName: string; downloadUrl: string }> {
    return this.http.post<{ message: string; fileName: string; downloadUrl: string }>(
      `${API_BASE_URL}/backups/create`,
      {},
      { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  restoreBackup(fileName: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${API_BASE_URL}/backups/restore`,
      { fileName },
      { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  downloadBackup(fileName: string): Observable<Blob> {
    return this.http.get(`${API_BASE_URL}/backups/download/${encodeURIComponent(fileName)}`, {
      responseType: 'blob',
      context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true),
    });
  }

  getBackupSchedule(): Observable<BackupScheduleConfig> {
    return this.http.get<BackupScheduleConfig>(`${API_BASE_URL}/backups/schedule`, {
      context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true),
    });
  }

  getBackupStatus(): Observable<BackupStatusResponse> {
    return this.http.get<BackupStatusResponse>(`${API_BASE_URL}/backups/status`);
  }

  /** Just the last successful app-data backup's timestamp — no Kopia round trip,
   * cheap enough for Home's status strip to read on every visit (plan.md §781). */
  getLastSuccessfulBackup(): Observable<{ lastSuccessfulAppData: BackupLastAppDataDump | null }> {
    // Read by Home on every visit; a failure here shouldn't toast (same
    // reasoning as getSelfUpdateStatus below) — the caller just shows no badge.
    return this.http.get<{ lastSuccessfulAppData: BackupLastAppDataDump | null }>(`${API_BASE_URL}/backups/last-successful`, {
      context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true),
    });
  }

  getSelfUpdateStatus(): Observable<SelfUpdateStatus> {
    // Polled through the backend's own restart, where it fails until the new
    // container is up; every caller handles errors itself, so no global toast.
    return this.http.get<SelfUpdateStatus>(`${API_BASE_URL}/self-update/status`, {
      context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true),
    });
  }

  checkForSelfUpdate(): Observable<SelfUpdateCheck> {
    return this.http.post<SelfUpdateCheck>(
      `${API_BASE_URL}/self-update/check`,
      {},
      { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  triggerSelfUpdate(): Observable<SelfUpdateRun> {
    return this.http.post<SelfUpdateRun>(
      `${API_BASE_URL}/self-update/trigger`,
      {},
      { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  runAppDataBackup(): Observable<{ ok: boolean; message: string }> {
    return this.http.post<{ ok: boolean; message: string }>(`${API_BASE_URL}/backups/run`, {});
  }

  getBackupProgress(): Observable<BackupProgress> {
    return this.http.get<BackupProgress>(`${API_BASE_URL}/backups/run/progress`);
  }

  updateBackupSchedule(config: BackupScheduleSettings): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${API_BASE_URL}/backups/schedule`, config, {
      context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true),
    });
  }

  // ---- Per-app backup / restore (plan.md §185) ----

  listAppBackups(serviceName: string): Observable<AppBackupListResponse> {
    return this.http.get<AppBackupListResponse>(`${API_BASE_URL}/services/${serviceName}/backups`, {
      context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true),
    });
  }

  createAppBackup(serviceName: string): Observable<AppBackupCreateResponse> {
    return this.http.post<AppBackupCreateResponse>(
      `${API_BASE_URL}/services/${serviceName}/backup`,
      {},
      { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  restoreAppBackup(serviceName: string, file: string): Observable<AppRestoreResponse> {
    return this.http.post<AppRestoreResponse>(
      `${API_BASE_URL}/services/${serviceName}/backup/restore`,
      { file },
      { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  deleteAppBackup(serviceName: string, file: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${API_BASE_URL}/services/${serviceName}/backups/${encodeURIComponent(file)}`,
      { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  downloadAppBackup(serviceName: string, file: string): Observable<Blob> {
    return this.http.get(`${API_BASE_URL}/services/${serviceName}/backups/${encodeURIComponent(file)}`, {
      responseType: 'blob',
      context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true),
    });
  }

  getServiceEnv(serviceName: string): Observable<ServiceEnvStatus> {
    return this.http.get<ServiceEnvStatus>(`${API_BASE_URL}/services/${serviceName}/env`, {
      context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true),
    });
  }

  updateServiceEnv(serviceName: string, values: Record<string, string>): Observable<{ message: string } & ServiceEnvStatus> {
    return this.http.put<{ message: string } & ServiceEnvStatus>(
      `${API_BASE_URL}/services/${serviceName}/env`,
      { values },
      { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  getAutheliaAdminUser(serviceName: string): Observable<AutheliaAdminUser> {
    return this.http.get<AutheliaAdminUser>(`${API_BASE_URL}/services/${serviceName}/admin-user`, {
      context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true),
    });
  }

  updateAutheliaAdminUser(
    serviceName: string,
    update: AutheliaAdminUserUpdate
  ): Observable<{ message: string; user: AutheliaAdminUser }> {
    return this.http.put<{ message: string; user: AutheliaAdminUser }>(
      `${API_BASE_URL}/services/${serviceName}/admin-user`,
      update,
      { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  getHealth(): Observable<HealthStatus> {
    // Polled every 5s by the resource strip, which also runs through a backend
    // restart; callers handle errors themselves, so no global toast.
    return this.http.get<HealthStatus>(`${API_BASE_URL}/health/system`, {
      context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true),
    });
  }

  /** Public: the running backend's version, shown in the dashboard footer. */
  getAppVersion(): Observable<{ version: string }> {
    return this.http.get<{ version: string }>(`${API_BASE_URL}/version`, {
      context: new HttpContext().set(SKIP_AUTH, true).set(SKIP_GLOBAL_ERROR_HANDLING, true),
    });
  }

  scanNetwork(): Observable<{ hosts: DiscoveredHost[] }> {
    return this.http.post<{ hosts: DiscoveredHost[] }>(
      `${API_BASE_URL}/network/scan`,
      {},
      { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  getRecoveryStatus(): Observable<{ enabled: boolean; available: boolean }> {
    return this.http.get<{ enabled: boolean; available: boolean }>(
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

  /** Sent from the public /access-denied page (plan.md §463) — reachable signed out. */
  submitAccessRequest(hostname: string, email: string, reason: string): Observable<void> {
    return this.http.post<void>(
      `${API_BASE_URL}/access-requests`,
      { hostname, email, reason },
      { context: new HttpContext().set(SKIP_AUTH, true).set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  /** What the public /unsubscribe/:token page calls (plan.md §612) — reachable signed out. */
  confirmUnsubscribe(token: string): Observable<void> {
    return this.http.get<void>(
      `${API_BASE_URL}/subscribers/unsubscribe/${encodeURIComponent(token)}`,
      { context: new HttpContext().set(SKIP_AUTH, true).set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  listUsers(): Observable<AdminUserListResponse> {
    return this.http.get<AdminUserListResponse>(`${API_BASE_URL}/users`, {
      context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true),
    });
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
      },
      { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  resendInvite(id: number): Observable<{ message: string; warning?: string }> {
    return this.http.post<{ message: string; warning?: string }>(
      `${API_BASE_URL}/users/${id}/invitation/resend`,
      {},
      { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  updateUserAccess(
    id: number,
    email: string,
    appAccess: string[]
  ): Observable<{ message: string; email: string; appAccess: string[] }> {
    return this.http.put<{ message: string; email: string; appAccess: string[] }>(
      `${API_BASE_URL}/users/${id}/access`,
      { email, appAccess },
      { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  updateUserRoles(id: number, roles: string[]): Observable<{ message: string; roles: string[] }> {
    return this.http.put<{ message: string; roles: string[] }>(
      `${API_BASE_URL}/users/${id}/roles`,
      { roles },
      { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  updateUserCapabilities(
    id: number,
    capabilities: string[]
  ): Observable<{ message: string; capabilities: string[] }> {
    return this.http.put<{ message: string; capabilities: string[] }>(
      `${API_BASE_URL}/users/${id}/capabilities`,
      { capabilities },
      { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  updateUserPassword(id: number, password: string): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(
      `${API_BASE_URL}/users/${id}/password`,
      { password },
      { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  deleteUser(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${API_BASE_URL}/users/${id}`, {
      context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true),
    });
  }

  // --- Own-account 2FA (TOTP) enrolment. All behind the access JWT; the
  // login-time second factor lives on AuthService instead (it runs without a
  // session). ---

  // Account's own TOTP flow shows its own inline errorMessage, not a toast —
  // without the flag, a failure showed that inline message and the
  // interceptor's generic toast stacked on top (plan.md §796).
  getTotpStatus(): Observable<TotpStatus> {
    return this.http.get<TotpStatus>(`${API_BASE_URL}/auth/totp/status`, {
      context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true),
    });
  }

  setupTotp(): Observable<TotpSetupResponse> {
    return this.http.post<TotpSetupResponse>(
      `${API_BASE_URL}/auth/totp/setup`,
      {},
      { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  activateTotp(code: string): Observable<TotpActivateResponse> {
    return this.http.post<TotpActivateResponse>(
      `${API_BASE_URL}/auth/totp/activate`,
      { code },
      { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  /** A current 6-digit code or an unused recovery code; the password is not accepted (plan.md §819). */
  disableTotp(proof: { code: string }): Observable<{ enabled: false }> {
    return this.http.post<{ enabled: false }>(`${API_BASE_URL}/auth/totp/disable`, proof, {
      context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true),
    });
  }

  resetAdminPassword(username: string, password: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${API_BASE_URL}/recovery/reset-admin-password`,
      { username, password },
      { context: new HttpContext().set(SKIP_AUTH, true).set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }
}
