import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PanelComponent } from '../../components/panel/panel.component';
import { SocialService } from '../../core/social.service';
import { SocialDraft } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { ConfirmService } from '../../core/confirm.service';
import { extractErrorMessage } from '../../core/api';
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
  standalone: true,
  imports: [CommonModule, FormsModule, PanelComponent, TranslatePipe],
  templateUrl: './social.component.html',
  styleUrl: './social.component.css',
})
export class SocialComponent implements OnInit {
  private readonly social = inject(SocialService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  protected readonly translate = inject(TranslateService);

  protected prompt = '';
  protected generating = false;
  protected drafts: SocialDraft[] | null = null;
  // Per-draft editable copy of the content, keyed by id; committed on Save.
  protected edits: Record<number, string> = {};
  protected savingId: number | null = null;
  protected deletingId: number | null = null;
  protected publishingId: number | null = null;

  ngOnInit(): void {
    this.loadDrafts();
  }

  private loadDrafts(): void {
    this.social.listDrafts().subscribe({
      next: ({ drafts }) => {
        this.drafts = drafts;
        this.edits = Object.fromEntries(drafts.map((d) => [d.id, d.content]));
      },
      error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('social.errors.loadDrafts'))),
    });
  }

  generate(): void {
    const prompt = this.prompt.trim();
    if (!prompt || this.generating) {
      return;
    }
    this.generating = true;
    this.social.generate(prompt).subscribe({
      next: ({ draft }) => {
        this.drafts = [draft, ...(this.drafts ?? [])];
        this.edits[draft.id] = draft.content;
        this.prompt = '';
        this.generating = false;
        this.toast.success(this.translate.t('social.toast.generated'));
      },
      error: (error) => {
        this.toast.error(extractErrorMessage(error, this.translate.t('social.errors.generate')));
        this.generating = false;
      },
    });
  }

  isDirty(draft: SocialDraft): boolean {
    return (this.edits[draft.id] ?? '').trim() !== draft.content && (this.edits[draft.id] ?? '').trim().length > 0;
  }

  save(draft: SocialDraft): void {
    if (!this.isDirty(draft)) {
      return;
    }
    this.savingId = draft.id;
    this.social.updateContent(draft.id, this.edits[draft.id]).subscribe({
      next: ({ draft: updated }) => {
        this.drafts = (this.drafts ?? []).map((d) => (d.id === updated.id ? updated : d));
        this.edits[updated.id] = updated.content;
        this.savingId = null;
        this.toast.success(this.translate.t('social.toast.saved'));
      },
      error: (error) => {
        this.toast.error(extractErrorMessage(error, this.translate.t('social.errors.save')));
        this.savingId = null;
      },
    });
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
      },
      error: (error) => {
        this.toast.error(extractErrorMessage(error, this.translate.t('social.errors.delete')));
        this.deletingId = null;
      },
    });
  }

  async publish(draft: SocialDraft): Promise<void> {
    const ok = await this.confirm.ask({
      title: this.translate.t('social.confirmPublish.title'),
      message: this.translate.t('social.confirmPublish.message'),
      confirmText: this.translate.t('social.confirmPublish.confirmText'),
      danger: true,
    });
    if (!ok) {
      return;
    }
    this.publishingId = draft.id;
    this.social.publish(draft.id).subscribe({
      next: ({ sent, failed, total }) => {
        this.publishingId = null;
        if (total === 0) {
          this.toast.error(this.translate.t('social.errors.noSubscribers'));
          return;
        }
        if (failed > 0) {
          this.toast.error(this.translate.t('social.toast.publishedPartial', { sent, total }));
          return;
        }
        this.toast.success(this.translate.t('social.toast.published', { sent }));
      },
      error: (error) => {
        this.toast.error(extractErrorMessage(error, this.translate.t('social.errors.publish')));
        this.publishingId = null;
      },
    });
  }
}
