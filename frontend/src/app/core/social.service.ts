import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api';
import { SKIP_GLOBAL_ERROR_HANDLING } from './http-context';
import { SocialDraft, Subscriber } from './models';

/** Content generation — plan.md §254 P2. Publishing is a later phase. */
@Injectable({ providedIn: 'root' })
export class SocialService {
  private readonly http = inject(HttpClient);
  private readonly opts = { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) };

  listDrafts(): Observable<{ drafts: SocialDraft[] }> {
    return this.http.get<{ drafts: SocialDraft[] }>(`${API_BASE_URL}/social/drafts`, this.opts);
  }

  generate(prompt: string): Observable<{ draft: SocialDraft }> {
    return this.http.post<{ draft: SocialDraft }>(`${API_BASE_URL}/social/drafts`, { prompt: prompt.trim() }, this.opts);
  }

  updateContent(id: number, content: string): Observable<{ draft: SocialDraft }> {
    return this.http.patch<{ draft: SocialDraft }>(
      `${API_BASE_URL}/social/drafts/${id}`,
      { content: content.trim() },
      this.opts
    );
  }

  deleteDraft(id: number): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/social/drafts/${id}`, this.opts);
  }

  publish(id: number): Observable<{ total: number; sent: number; failed: number }> {
    return this.http.post<{ total: number; sent: number; failed: number }>(
      `${API_BASE_URL}/social/drafts/${id}/publish`,
      {},
      this.opts
    );
  }

  // The advert mailing list (plan.md §847), behind the same `settings:manage` gate as the drafts.
  listSubscribers(): Observable<{ subscribers: Subscriber[] }> {
    return this.http.get<{ subscribers: Subscriber[] }>(`${API_BASE_URL}/social/subscribers`, this.opts);
  }

  addSubscriber(email: string): Observable<{ result: 'added' | 'exists' }> {
    return this.http.post<{ result: 'added' | 'exists' }>(`${API_BASE_URL}/social/subscribers`, { email: email.trim() }, this.opts);
  }

  removeSubscriber(id: number): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/social/subscribers/${id}`, this.opts);
  }
}
