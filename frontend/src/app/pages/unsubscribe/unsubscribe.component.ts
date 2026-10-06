import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
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
  imports: [CommonModule, RouterLink, TranslatePipe],
  templateUrl: './unsubscribe.component.html',
  styleUrl: './unsubscribe.component.css',
})
export class UnsubscribeComponent implements OnInit {
  private readonly operations = inject(OperationsService);
  private readonly route = inject(ActivatedRoute);
  private readonly translate = inject(TranslateService);

  protected token = '';
  protected working = false;
  protected done = false;
  protected error = '';

  ngOnInit(): void {
    this.token = (this.route.snapshot.paramMap.get('token') ?? '').trim();
    if (!this.token) {
      this.error = this.translate.t('unsubscribe.errors.missingToken');
    }
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
