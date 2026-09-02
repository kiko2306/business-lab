import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, retry } from 'rxjs';
import { API_BASE_URL } from './api';
import { SKIP_GLOBAL_ERROR_HANDLING } from './http-context';
import {
  CloudflareSettings,
  CloudflareTestResponse,
  ExposureSettings,
  ExposureSettingsInput,
  MailSettings,
  MailSettingsInput,
  MailTestResponse,
  BackupTargetInput,
  BackupTargetSettings,
  BackupTargetTestResponse,
  BackupJobProvisionResponse,
  ExposureTestResponse,
  GeneralSettings,
  AlertNotifySettings,
} from './models';

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  private readonly http = inject(HttpClient);

  loadCloudflareSettings(): Observable<CloudflareSettings> {
    return this.http
      .get<CloudflareSettings>(`${API_BASE_URL}/settings/cloudflare-token`, {
        context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true),
      })
      .pipe(retry({ count: 1, delay: 400 }));
  }

  saveCloudflareToken(token: string): Observable<CloudflareSettings> {
    return this.http.put<CloudflareSettings>(
      `${API_BASE_URL}/settings/cloudflare-token`,
      { token: token.trim() },
      { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  testCloudflareToken(token?: string): Observable<CloudflareTestResponse> {
    const payload = token?.trim() ? { token: token.trim() } : {};
    return this.http.post<CloudflareTestResponse>(
      `${API_BASE_URL}/settings/cloudflare-token/test`,
      payload,
      { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  loadExposureSettings(): Observable<ExposureSettings> {
    return this.http
      .get<ExposureSettings>(`${API_BASE_URL}/settings/exposure`, {
        context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true),
      })
      .pipe(retry({ count: 1, delay: 400 }));
  }

  getBackupTarget(): Observable<BackupTargetSettings> {
    return this.http.get<BackupTargetSettings>(`${API_BASE_URL}/settings/backup-target`);
  }

  saveBackupTarget(input: BackupTargetInput): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${API_BASE_URL}/settings/backup-target`, input);
  }

  provisionBackupJob(): Observable<BackupJobProvisionResponse> {
    return this.http.post<BackupJobProvisionResponse>(`${API_BASE_URL}/settings/backup-target/provision-job`, {});
  }

  testBackupTarget(): Observable<BackupTargetTestResponse> {
    return this.http.post<BackupTargetTestResponse>(`${API_BASE_URL}/settings/backup-target/test`, {});
  }

  getMailSettings(): Observable<MailSettings> {
    return this.http.get<MailSettings>(`${API_BASE_URL}/settings/mail`);
  }

  saveMailSettings(input: MailSettingsInput): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${API_BASE_URL}/settings/mail`, input);
  }

  testMailSettings(): Observable<MailTestResponse> {
    return this.http.post<MailTestResponse>(`${API_BASE_URL}/settings/mail/test`, {});
  }

  saveExposureSettings(input: ExposureSettingsInput): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${API_BASE_URL}/settings/exposure`, input, {
      context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true),
    });
  }

  testExposureConnection(): Observable<ExposureTestResponse> {
    return this.http.post<ExposureTestResponse>(
      `${API_BASE_URL}/settings/exposure/test`,
      {},
      { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  loadGeneralSettings(): Observable<GeneralSettings> {
    return this.http
      .get<GeneralSettings>(`${API_BASE_URL}/settings/general`, {
        context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true),
      })
      .pipe(retry({ count: 1, delay: 400 }));
  }

  saveGeneralSettings(timezone: string): Observable<{ timezone: string; message: string }> {
    return this.http.put<{ timezone: string; message: string }>(
      `${API_BASE_URL}/settings/general`,
      { timezone },
      { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  loadAlertSettings(): Observable<AlertNotifySettings> {
    return this.http
      .get<AlertNotifySettings>(`${API_BASE_URL}/settings/alerts`, {
        context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true),
      })
      .pipe(retry({ count: 1, delay: 400 }));
  }

  saveAlertSettings(
    input: { topic?: string; crowdsecEnabled?: boolean }
  ): Observable<AlertNotifySettings & { message: string }> {
    return this.http.put<AlertNotifySettings & { message: string }>(
      `${API_BASE_URL}/settings/alerts`,
      input,
      { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }

  testAlertSource(source: string): Observable<{ ok: boolean; message: string }> {
    return this.http.post<{ ok: boolean; message: string }>(
      `${API_BASE_URL}/settings/alerts/test`,
      { source },
      { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
    );
  }
}
