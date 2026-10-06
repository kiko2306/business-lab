import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { PanelComponent } from '../panel/panel.component';
import { ConfirmService } from '../../core/confirm.service';
import { Subscriber } from '../../core/models';
import { SocialService } from '../../core/social.service';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { TranslateService } from '../../i18n/translate.service';

/**
 * The mailing list behind the "email to subscribers" send, managed on the
 * Content page where the posts are written (plan.md §847). People join
 * through the public form and leave through the link in every message; this
 * panel lets the owner see the list, add an address by hand and remove one.
 */
@Component({
  selector: 'app-subscribers',
  standalone: true,
  imports: [DatePipe, FormsModule, NgFor, NgIf, PanelComponent, TranslatePipe],
  templateUrl: './subscribers.component.html',
})
export class SubscribersComponent implements OnInit {
  private readonly social = inject(SocialService);
  private readonly confirm = inject(ConfirmService);
  protected readonly translate = inject(TranslateService);

  @ViewChild('emailInput') private emailInput?: ElementRef<HTMLInputElement>;

  protected subscribers: Subscriber[] | null = null;
  protected loadFailed = false;
  protected email = '';
  protected adding = false;
  /** Beside the box, not a toast: the owner is looking at the box. */
  protected addError = '';
  /** One polite announcement for the last thing that happened. */
  protected announcement = '';

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loadFailed = false;
    this.social.listSubscribers().subscribe({
      next: ({ subscribers }) => (this.subscribers = subscribers),
      error: () => (this.loadFailed = true),
    });
  }

  protected get activeCount(): number {
    return (this.subscribers ?? []).filter((s) => !s.unsubscribedAt).length;
  }

  protected get unsubscribedCount(): number {
    return (this.subscribers ?? []).length - this.activeCount;
  }

  protected async add(): Promise<void> {
    const email = this.email.trim();
    if (!email || this.adding) {
      return;
    }
    this.adding = true;
    this.addError = '';
    try {
      const { result } = await firstValueFrom(this.social.addSubscriber(email));
      this.announcement = this.translate.t(result === 'added' ? 'social.subscribers.added' : 'social.subscribers.alreadyThere', { email });
      this.email = '';
      this.load();
    } catch (error) {
      this.addError = this.translate.t(
        error instanceof HttpErrorResponse && error.status === 409 ? 'social.subscribers.optedOut' : 'social.subscribers.addFailed',
        { email }
      );
    } finally {
      this.adding = false;
      this.emailInput?.nativeElement.focus();
    }
  }

  protected async remove(subscriber: Subscriber): Promise<void> {
    const ok = await this.confirm.ask({
      title: this.translate.t('social.subscribers.confirmRemove.title'),
      message: this.translate.t('social.subscribers.confirmRemove.message', { email: subscriber.email }),
      confirmText: this.translate.t('social.subscribers.confirmRemove.confirmText'),
      danger: true,
    });
    if (!ok) {
      return;
    }
    try {
      await firstValueFrom(this.social.removeSubscriber(subscriber.id));
      this.subscribers = (this.subscribers ?? []).filter((s) => s.id !== subscriber.id);
      this.announcement = this.translate.t('social.subscribers.removed', { email: subscriber.email });
    } catch {
      this.addError = this.translate.t('social.subscribers.removeFailed', { email: subscriber.email });
    }
    // The row that held focus is gone; the box is the next sensible place.
    this.emailInput?.nativeElement.focus();
  }
}
