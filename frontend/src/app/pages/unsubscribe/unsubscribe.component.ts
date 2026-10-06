import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AuthShellComponent } from '../../components/auth-shell/auth-shell.component';
import { finalize } from 'rxjs';
import { extractErrorMessage } from '../../core/api';
import { OperationsService } from '../../core/operations.service';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { TranslateService } from '../../i18n/translate.service';

/**
 * Public landing for the unsubscribe link in every sent advert email's
 * footer (plan.md §612): `{baseUrl}/unsubscribe/:token`. Reachable signed
 * out. Opening the page changes nothing; the person taps one button and
 * that POSTs (plan.md §854: a GET on load would let a mail gateway's link
 * scanner unsubscribe a customer who never tapped anything).
 */
@Component({
  selector: 'app-unsubscribe',
  standalone: true,
  imports: [CommonModule, AuthShellComponent, TranslatePipe],
  templateUrl: './unsubscribe.component.html',
  styleUrl: './unsubscribe.component.css',
})
export class UnsubscribeComponent implements OnInit {
  private readonly operations = inject(OperationsService);
  private readonly route = inject(ActivatedRoute);
  private readonly translate = inject(TranslateService);

  protected token = '';
  /** Whose emails these are; null until known, or when the server cannot say. */
  protected sender: string | null = null;
  protected resubscribed = false;
  protected working = false;
  protected done = false;
  protected error = '';

  ngOnInit(): void {
    this.token = (this.route.snapshot.paramMap.get('token') ?? '').trim();
    if (!this.token) {
      this.error = this.translate.t('unsubscribe.errors.missingToken');
      return;
    }
    // Best effort: the page works without it, just less specifically.
    this.operations.getUnsubscribeSender().subscribe({
      next: ({ sender }) => (this.sender = sender),
      error: () => (this.sender = null),
    });
  }

  protected get kicker(): string {
    return this.sender ?? this.translate.t('unsubscribe.kickerFallback');
  }

  /** The person changed their mind — their own token, so it may override their own opt-out. */
  protected undo(): void {
    if (this.working) {
      return;
    }
    this.working = true;
    this.error = '';
    this.operations
      .resubscribe(this.token)
      .pipe(finalize(() => (this.working = false)))
      .subscribe({
        next: () => {
          this.done = false;
          this.resubscribed = true;
        },
        error: (err) => (this.error = extractErrorMessage(err, this.translate.t('unsubscribe.errors.failed'))),
      });
  }

  protected confirm(): void {
    // aria-disabled, not disabled, so a second tap is ignored here without the button vanishing from focus.
    if (this.working || this.done || !this.token) {
      return;
    }
    this.working = true;
    this.error = '';
    this.operations
      .unsubscribe(this.token)
      .pipe(finalize(() => (this.working = false)))
      .subscribe({
        next: () => (this.done = true),
        error: (err) => (this.error = extractErrorMessage(err, this.translate.t('unsubscribe.errors.failed'))),
      });
  }
}
