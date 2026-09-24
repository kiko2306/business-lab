import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Feedback, PulseAnswer } from './models';

/**
 * Same-origin: nginx proxies `/api/<token>` through to hotel-core's
 * `/pulse/<token>` (plan.md §644). No auth header — the token in the path
 * is the whole of the guest's authorisation.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  get(token: string): Observable<Feedback> {
    return this.http.get<Feedback>(`/api/${token}`);
  }

  submit(token: string, responses: PulseAnswer[]): Observable<Feedback> {
    return this.http.post<Feedback>(`/api/${token}`, { responses });
  }
}
