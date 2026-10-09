import { CommonModule, formatDate } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PanelComponent } from '../../components/panel/panel.component';
import { SubscribersComponent } from '../../components/subscribers/subscribers.component';
import { SocialService } from '../../core/social.service';
import { SocialDraft } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { ConfirmService } from '../../core/confirm.service';
import { SectionCollapseService } from '../../core/section-collapse.service';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { TranslateService } from '../../i18n/translate.service';

/**
 * Content generation (plan.md §254 P2) plus the email-advert publish path
 * (plan.md §611/§612 slice 1): a prompt in, a stored draft out, and a
 * Publish button that sends it to every active subscriber. Scheduling and
 * social-platform posting (slice 2) are still later phases.
 */
@Component({
    selector: 'app-social',
    imports: [CommonModule, FormsModule, RouterLink, PanelComponent, SubscribersComponent, TranslatePipe],
    templateUrl: './social.component.html',
    styleUrl: './social.component.css'
})
export class SocialComponent implements OnInit {
  private readonly social = inject(SocialService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly collapse = inject(SectionCollapseService);
  protected readonly translate = inject(TranslateService);

  protected prompt = '';
  protected generating = false;
  protected drafts: SocialDraft[] | null = null;
  protected loadFailed = false;
  /** Why the last Generate failed, shown beside the button: a missing AI key has a way out, anything else a retry. */
  protected generateError: 'noKey' | 'failed' | null = null;
  // Per-draft editable copy of the content, keyed by id; committed on Save.
  protected edits: Record<number, string> = {};
  protected savingId: number | null = null;
  protected deletingId: number | null = null;
  protected publishingId: number | null = null;
  /** One polite line for what the last copy did; read out, not shown. */
  protected announcement = '';
  /** Drafts whose last send only partly went out, until the next send replaces it. In memory only: the server keeps the count that left, not who missed it. */
  protected partial: Record<number, { failed: number; total: number }> = {};

  ngOnInit(): void {
    this.loadDrafts();
  }

  protected loadDrafts(): void {
    this.loadFailed = false;
    this.social.listDrafts().subscribe({
      next: ({ drafts }) => {
        this.drafts = drafts;
        this.edits = Object.fromEntries(drafts.map((d) => [d.id, d.content]));
      },
      // Inline with a retry: a toast is gone in 5s and "Loading…" would never end.
      error: () => (this.loadFailed = true),
    });
  }

  /** After the next render: the card or box the owner should land in, since the control that held focus is gone or disabled. */
  private focusSoon(id: string): void {
    setTimeout(() => {
      const target = document.getElementById(id);
      target?.focus();
      target?.scrollIntoView?.({ block: 'nearest' });
    });
  }

  generate(): void {
    const prompt = this.prompt.trim();
    if (!prompt || this.generating) {
      return;
    }
    this.generating = true;
    this.generateError = null;
    this.social.generate(prompt).subscribe({
      next: ({ draft }) => {
        this.drafts = [draft, ...(this.drafts ?? [])];
        this.edits[draft.id] = draft.content;
        this.prompt = '';
        this.generating = false;
        // The new draft lives in the other panel, which may be closed; open it and
        // land in the draft, or the owner is told "ready" and shown nothing.
        this.collapse.open('social:drafts');
        this.announcement = this.translate.t('social.toast.generated');
        this.focusSoon(`draft-${draft.id}`);
      },
      error: (error) => {
        // 400 is the server saying no AI key is set up; the rest is a failed call.
        this.generateError = error instanceof HttpErrorResponse && error.status === 400 ? 'noKey' : 'failed';
        this.generating = false;
      },
    });
  }

  /** Joi's limit on `prompt` (middleware/validation.ts); the counter appears from 3500. */
  readonly briefMax = 4000;

  isDirty(draft: SocialDraft): boolean {
    const edit = (this.edits[draft.id] ?? '').trim();
    // Both sides trimmed: the server stores the trimmed text, but content saved
    // before that rule can carry trailing whitespace, which showed Save as live on load.
    return edit !== draft.content.trim() && edit.length > 0;
  }

  save(draft: SocialDraft): void {
    if (!this.isDirty(draft)) {
      return;
    }
    void this.persist(draft, true);
  }

  /** Stores the textarea's text; resolves false (after a toast) when the server refused it. */
  private async persist(draft: SocialDraft, announce: boolean): Promise<boolean> {
    this.savingId = draft.id;
    try {
      const { draft: updated } = await firstValueFrom(this.social.updateContent(draft.id, this.edits[draft.id]));
      this.drafts = (this.drafts ?? []).map((d) => (d.id === updated.id ? updated : d));
      this.edits[updated.id] = updated.content;
      if (announce) {
        this.toast.success(this.translate.t('social.toast.saved'));
        // Save disables itself once the draft is clean, which would drop focus to <body>.
        this.focusSoon(`draft-${updated.id}`);
      }
      return true;
    } catch {
      this.toast.error(this.translate.t('social.errors.save'));
      return false;
    } finally {
      this.savingId = null;
    }
  }

  async remove(draft: SocialDraft): Promise<void> {
    const ok = await this.confirm.ask({
      title: this.translate.t('social.confirmDelete.title'),
      message: this.translate.t('social.confirmDelete.message'),
      confirmText: this.translate.t('social.confirmDelete.confirmText'),
      danger: true,
    });
    if (!ok) {
      return;
    }
    this.deletingId = draft.id;
    this.social.deleteDraft(draft.id).subscribe({
      next: () => {
        this.drafts = (this.drafts ?? []).filter((d) => d.id !== draft.id);
        delete this.edits[draft.id];
        this.deletingId = null;
        this.announcement = this.translate.t('social.toast.deleted');
        this.focusSoon('prompt'); // the card that held focus is gone
      },
      error: () => {
        this.toast.error(this.translate.t('social.errors.delete'));
        this.deletingId = null;
      },
    });
  }

  async publish(draft: SocialDraft): Promise<void> {
    // The server emails the *saved* copy. Whatever the textarea shows must be
    // saved first, or the owner mails every subscriber text they are not
    // looking at (plan.md §845, the P0). A cleared box differs from the saved
    // copy too, but cannot be saved, so it stops here instead.
    const edit = (this.edits[draft.id] ?? '').trim();
    const unsaved = edit !== draft.content;
    if (unsaved && !edit) {
      this.toast.error(this.translate.t('social.errors.publishEmpty'));
      return;
    }

    // Ask the server what this send would do, for the text on screen: the
    // subject comes from the same code that builds the email.
    let preview: { subject: string; recipients: number };
    try {
      preview = await firstValueFrom(this.social.previewPublish(edit));
    } catch {
      this.toast.error(this.translate.t('social.errors.prepareSend'));
      return;
    }
    if (preview.recipients === 0) {
      this.toast.error(this.translate.t('social.errors.noSubscribers'));
      return;
    }

    const t = (key: string, params?: Record<string, string | number>) => this.translate.t(key, params);
    const excerpt = edit.length > 280 ? `${edit.slice(0, 280)}…` : edit;
    const message = [
      draft.lastSentAt
        ? t('social.confirmPublish.alreadySent', {
            date: formatDate(draft.lastSentAt, 'mediumDate', this.translate.locale()),
            count: draft.lastSentCount ?? 0,
          })
        : '',
      unsaved ? t('social.confirmPublish.unsavedNote') : '',
      t(preview.recipients === 1 ? 'social.confirmPublish.messageOne' : 'social.confirmPublish.message', { count: preview.recipients }),
      `${t('social.confirmPublish.subject', { subject: preview.subject })}\n\n${excerpt}`,
      t('social.confirmPublish.cannotUndo'),
    ]
      .filter(Boolean)
      .join('\n\n');

    const ok = await this.confirm.ask({
      title: t('social.confirmPublish.title'),
      message,
      confirmText: t('social.confirmPublish.confirmText'),
      danger: true,
    });
    if (!ok) {
      return;
    }
    // Lock the button across the save too, so a second click cannot start a second send.
    this.publishingId = draft.id;
    if (unsaved && !(await this.persist(draft, false))) {
      this.publishingId = null;
      return;
    }
    this.social.publish(draft.id).subscribe({
      next: ({ sent, failed, total }) => {
        this.publishingId = null;
        if (total === 0) {
          this.toast.error(this.translate.t('social.errors.noSubscribers'));
          return;
        }
        if (sent > 0) {
          // The server stamped it; mirror that here so the line appears without a reload,
          // and without re-reading the list (which would drop edits in other drafts).
          this.drafts = (this.drafts ?? []).map((d) =>
            d.id === draft.id ? { ...d, lastSentAt: new Date().toISOString(), lastSentCount: sent } : d
          );
        }
        if (failed > 0) {
          // Mostly worked: a warning, and a line that outlives the toast so the owner
          // can see why sending again would not be harmless.
          this.partial[draft.id] = { failed, total };
          this.toast.warning(this.translate.t('social.toast.publishedPartial', { sent, total, failed }));
          return;
        }
        delete this.partial[draft.id];
        this.toast.success(this.translate.t('social.toast.published', { sent }));
      },
      error: (error) => {
        // 400 is "email is not set up" (mailbox or Dashboard URL); the server's own words are English.
        this.toast.error(
          this.translate.t(error instanceof HttpErrorResponse && error.status === 400 ? 'social.errors.publishNotReady' : 'social.errors.publish')
        );
        this.publishingId = null;
      },
    });
  }

  /** Copies what the owner is looking at — the post generator's main act. */
  async copy(draft: SocialDraft): Promise<void> {
    const text = (this.edits[draft.id] ?? '').trim();
    if (!text) {
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (!this.copyBySelection(text)) {
        throw new Error('copy refused');
      }
      this.announcement = this.translate.t('social.toast.copied');
    } catch {
      this.announcement = '';
      this.toast.error(this.translate.t('social.errors.copy'));
    }
  }

  // `navigator.clipboard` exists only on https and localhost; the box is often
  // opened over plain http on the LAN, where only select-and-copy works.
  private copyBySelection(text: string): boolean {
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.position = 'fixed';
    box.style.opacity = '0';
    document.body.appendChild(box);
    box.select();
    try {
      return document.execCommand('copy');
    } finally {
      box.remove();
    }
  }
}
