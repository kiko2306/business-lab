import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api';
import { SKIP_GLOBAL_ERROR_HANDLING } from './http-context';
import { SocialDraft } from './models';

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
}
