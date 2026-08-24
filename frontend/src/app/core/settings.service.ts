import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, retry } from 'rxjs';
import { API_BASE_URL } from './api';
import { SKIP_GLOBAL_ERROR_HANDLING } from './http-context';
import { CloudflareSettings, CloudflareTestResponse } from './models';

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
}
