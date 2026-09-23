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
 * footer (plan.md §612): `{baseUrl}/unsubscribe/:token`. Calls the backend
 * to perform the unsubscribe, then renders the result — reachable signed
 * out, same shape as SetPasswordComponent / AccessDeniedComponent.
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

  protected loading = true;
  protected error = '';

  ngOnInit(): void {
    const token = (this.route.snapshot.paramMap.get('token') ?? '').trim();
    if (!token) {
      this.loading = false;
      this.error = this.translate.t('unsubscribe.errors.missingToken');
      return;
    }
    this.operations
      .confirmUnsubscribe(token)
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: () => {},
        error: (err) => (this.error = extractErrorMessage(err, this.translate.t('unsubscribe.errors.failed'))),
      });
  }
}
