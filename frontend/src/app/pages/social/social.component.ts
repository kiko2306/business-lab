import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PanelComponent } from '../../components/panel/panel.component';
import { SocialService } from '../../core/social.service';
import { SocialDraft } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { ConfirmService } from '../../core/confirm.service';
import { extractErrorMessage } from '../../core/api';

/**
 * Content generation (plan.md §254 P2): a prompt in, a stored draft out.
 * Publishing and scheduling are later phases — this page only writes copy.
 */
@Component({
  selector: 'app-social',
  standalone: true,
  imports: [CommonModule, FormsModule, PanelComponent],
  templateUrl: './social.component.html',
  styleUrl: './social.component.css',
})
export class SocialComponent implements OnInit {
  private readonly social = inject(SocialService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  protected prompt = '';
  protected generating = false;
  protected drafts: SocialDraft[] | null = null;
  // Per-draft editable copy of the content, keyed by id; committed on Save.
  protected edits: Record<number, string> = {};
  protected savingId: number | null = null;
  protected deletingId: number | null = null;

  ngOnInit(): void {
    this.loadDrafts();
  }

  private loadDrafts(): void {
    this.social.listDrafts().subscribe({
      next: ({ drafts }) => {
        this.drafts = drafts;
        this.edits = Object.fromEntries(drafts.map((d) => [d.id, d.content]));
      },
      error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to load drafts.')),
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
        this.toast.success('Draft generated.');
      },
      error: (error) => {
        this.toast.error(extractErrorMessage(error, 'Generation failed.'));
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
        this.toast.success('Draft saved.');
      },
      error: (error) => {
        this.toast.error(extractErrorMessage(error, 'Unable to save the draft.'));
        this.savingId = null;
      },
    });
  }

  async remove(draft: SocialDraft): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Delete draft',
      message: 'This removes the generated draft for good.',
      confirmText: 'Delete',
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
        this.toast.error(extractErrorMessage(error, 'Unable to delete the draft.'));
        this.deletingId = null;
      },
    });
  }
}
