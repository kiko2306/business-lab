import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Checkin, CheckinExtra, CheckinGuest } from './models';

/**
 * Same-origin: nginx proxies `/api/<token>` through to hotel-core's
 * `/checkin/<token>` (plan.md §641). No auth header — the token in the path
 * is the whole of the guest's authorisation.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  get(token: string): Observable<Checkin> {
    return this.http.get<Checkin>(`/api/${token}`);
  }

  submit(token: string, guest: CheckinGuest, extras: CheckinExtra[]): Observable<Checkin> {
    return this.http.post<Checkin>(`/api/${token}`, { guest, extras });
  }
}
