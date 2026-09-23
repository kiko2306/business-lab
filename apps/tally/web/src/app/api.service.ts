import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { EnrolmentCode, Store } from './models';

/**
 * Same-origin throughout: the API serves this bundle (plan.md §632), so there
 * is no base URL to configure and no CORS boundary. Authentication is the
 * Authelia session cookie the browser already holds — nothing here sends a
 * credential of its own.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  listStores(): Observable<Store[]> {
    return this.http.get<Store[]>('/api/stores');
  }

  createStore(name: string): Observable<Store> {
    return this.http.post<Store>('/api/stores', { name });
  }

  updateStore(id: string, changes: { name?: string; isActive?: boolean }): Observable<Store> {
    return this.http.patch<Store>(`/api/stores/${id}`, changes);
  }

  deleteStore(id: string): Observable<void> {
    return this.http.delete<void>(`/api/stores/${id}`);
  }

  listAccess(id: string): Observable<string[]> {
    return this.http.get<string[]>(`/api/stores/${id}/access`);
  }

  grantAccess(id: string, identity: string): Observable<void> {
    return this.http.put<void>(`/api/stores/${id}/access/${encodeURIComponent(identity)}`, {});
  }

  revokeAccess(id: string, identity: string): Observable<void> {
    return this.http.delete<void>(`/api/stores/${id}/access/${encodeURIComponent(identity)}`);
  }

  issueEnrolmentCode(id: string): Observable<EnrolmentCode> {
    return this.http.post<EnrolmentCode>(`/api/stores/${id}/enrolment-code`, {});
  }

  revokeAgent(id: string): Observable<void> {
    return this.http.delete<void>(`/api/stores/${id}/agent`);
  }
}
