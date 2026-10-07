import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { extractErrorMessage } from '../../core/api';
import { AuthService } from '../../core/auth.service';
import { AuthShellComponent } from '../../components/auth-shell/auth-shell.component';
import { OperationsService } from '../../core/operations.service';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { TranslateService } from '../../i18n/translate.service';
import { FieldErrorDirective } from '../../components/field-error.directive';

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
  imports: [CommonModule, ReactiveFormsModule, RouterLink, TranslatePipe, FieldErrorDirective, AuthShellComponent],
  templateUrl: './access-denied.component.html',
  styleUrl: './access-denied.component.css',
})
export class AccessDeniedComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly operations = inject(OperationsService);
  private readonly route = inject(ActivatedRoute);
  private readonly translate = inject(TranslateService);
  private readonly auth = inject(AuthService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly changes = inject(ChangeDetectorRef);

  /** The dashboard session's account, when there is one: Authelia's own identity is not visible to this page. */
  protected readonly user$ = this.auth.user$;

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
        next: () => {
          this.sent = true;
          this.focusResult();
        },
        error: (err) => {
          this.error = extractErrorMessage(err, this.translate.t('accessDenied.errors.submitFailed'));
          this.focusResult();
        },
      });
  }

  protected otherAccount(): void {
    this.auth.logout();
  }

  /** The form or button the person just used is gone or stale; without this focus falls to <body>. */
  private focusResult(): void {
    this.changes.detectChanges();
    this.host.nativeElement.querySelector<HTMLElement>('[data-result]')?.focus();
  }
}
