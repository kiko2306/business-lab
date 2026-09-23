import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { extractErrorMessage } from '../../core/api';
import { OperationsService } from '../../core/operations.service';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { TranslateService } from '../../i18n/translate.service';

/**
 * Public landing for a locked-out app (plan.md §463): nginx's Authelia
 * advanced_config 302s a group-denied (403) request here instead of leaving
 * it on nginx's bare default error page, carrying the denied hostname as
 * `?host=`. Reachable signed out, same as /set-password and /recovery — the
 * whole point is that the visitor may hold no dashboard session at all.
 */
@Component({
  selector: 'app-access-denied',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, TranslatePipe],
  templateUrl: './access-denied.component.html',
  styleUrl: './access-denied.component.css',
})
export class AccessDeniedComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly operations = inject(OperationsService);
  private readonly route = inject(ActivatedRoute);
  private readonly translate = inject(TranslateService);

  protected readonly hostname = (this.route.snapshot.queryParamMap.get('host') ?? '').trim();

  protected readonly form = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email, Validators.maxLength(255)]],
    reason: ['', [Validators.required, Validators.maxLength(2000)]],
  });

  protected submitting = false;
  protected sent = false;
  protected error = '';

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting = true;
    this.error = '';
    const { email, reason } = this.form.getRawValue();
    this.operations
      .submitAccessRequest(this.hostname, email, reason)
      .pipe(finalize(() => (this.submitting = false)))
      .subscribe({
        next: () => (this.sent = true),
        error: (err) => (this.error = extractErrorMessage(err, this.translate.t('accessDenied.errors.submitFailed'))),
      });
  }
}
