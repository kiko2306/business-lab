import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, retry } from 'rxjs';
import { API_BASE_URL } from './api';
import { SKIP_GLOBAL_ERROR_HANDLING } from './http-context';
import { CloudflareSettings, CloudflareTestResponse, ExposureSettings, ExposureSettingsInput } from './models';

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

  saveExposureSettings(input: ExposureSettingsInput): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${API_BASE_URL}/settings/exposure`, input, {
      context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true),
    });
  }
}
