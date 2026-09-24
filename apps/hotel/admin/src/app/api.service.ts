import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AgentStatus, EnrolmentCode, FlowKey, Identity, Unit } from './models';

/**
 * Same-origin: this bundle is served by nginx, which proxies `/api` through to
 * `hotel-core` over the compose network (plan.md §640). So there is no base
 * URL to configure and no CORS boundary, even though the API is a different
 * container. Authentication is the Authelia session cookie the browser holds.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  me(): Observable<Identity> {
    return this.http.get<Identity>('/api/me');
  }

  listUnits(): Observable<Unit[]> {
    return this.http.get<Unit[]>('/api/units');
  }

  setFlow(id: string, flow: FlowKey, value: boolean): Observable<Unit> {
    return this.http.patch<Unit>(`/api/units/${id}`, { [flow]: value });
  }

  setActive(id: string, isActive: boolean): Observable<Unit> {
    return this.http.patch<Unit>(`/api/units/${id}`, { isActive });
  }

  listAccess(id: string): Observable<string[]> {
    return this.http.get<string[]>(`/api/units/${id}/access`);
  }

  grantAccess(id: string, identity: string): Observable<void> {
    return this.http.put<void>(`/api/units/${id}/access/${encodeURIComponent(identity)}`, {});
  }

  revokeAccess(id: string, identity: string): Observable<void> {
    return this.http.delete<void>(`/api/units/${id}/access/${encodeURIComponent(identity)}`);
  }

  agent(): Observable<AgentStatus> {
    return this.http.get<AgentStatus>('/api/agent');
  }

  issueEnrolmentCode(): Observable<EnrolmentCode> {
    return this.http.post<EnrolmentCode>('/api/agent/enrolment-code', {});
  }

  revokeAgent(): Observable<void> {
    return this.http.delete<void>('/api/agent');
  }
}
