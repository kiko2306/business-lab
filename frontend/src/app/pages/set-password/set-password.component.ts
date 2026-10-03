import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { authErrorKey } from '../../core/auth-errors';
import { AuthService } from '../../core/auth.service';
import { sanitizePastedText } from '../../core/input-sanitize';
import { ToastService } from '../../core/toast.service';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { TranslateService } from '../../i18n/translate.service';
import { FieldErrorDirective } from '../../components/field-error.directive';
import { PasswordToggleDirective } from '../../components/password-toggle.directive';

/**
 * Public landing for a `/set-password?token=…` invite link (plan.md §158).
 * Validates the token, then lets the invitee choose a password; on success the
 * account is activated and signed in.
 */
@Component({
  selector: 'app-set-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, TranslatePipe, FieldErrorDirective, PasswordToggleDirective],
  templateUrl: './set-password.component.html',
  styleUrl: './set-password.component.css',
})
export class SetPasswordComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);

  protected readonly form = this.formBuilder.nonNullable.group({
    password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128)]],
    confirmPassword: ['', [Validators.required, Validators.maxLength(128)]],
  });

  private token = '';
  protected loading = true;
  protected submitting = false;
  /** Set when the link is bad/expired — the form is not shown. */
  protected linkError = '';
  /** A refused password: said inside the card, the form kept (plan.md §827). */
  protected submitError = '';
  protected invite: { username: string; email: string } | null = null;

  ngOnInit(): void {
    this.token = (this.route.snapshot.queryParamMap.get('token') ?? '').trim();
    if (!this.token) {
      this.loading = false;
      this.linkError = this.translate.t('setPassword.errors.missingToken');
      return;
    }
    this.auth
      .getInvitation(this.token)
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: (invite) => {
          this.invite = invite;
          // The person came here to type: put the cursor where they start (plan.md §827).
          setTimeout(() => document.getElementById('spPassword')?.focus());
        },
        error: (error) => (this.linkError = this.translate.t(authErrorKey(error, 'invitation'))),
      });
  }

  sanitizePaste(event: ClipboardEvent, controlName: 'password' | 'confirmPassword'): void {
    const pasted = event.clipboardData?.getData('text') ?? '';
    event.preventDefault();
    this.form.controls[controlName].setValue(sanitizePastedText(pasted, 128, false));
    this.form.controls[controlName].markAsDirty();
  }

  protected get mismatch(): boolean {
    const { password, confirmPassword } = this.form.getRawValue();
    return Boolean(confirmPassword) && password !== confirmPassword;
  }

  submit(): void {
    if (this.form.invalid || this.mismatch) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitError = '';
    this.submitting = true;
    this.auth
      .acceptInvitation(this.token, this.form.controls.password.value)
      .pipe(finalize(() => (this.submitting = false)))
      .subscribe({
        next: () => {
          this.toast.success(this.translate.t('setPassword.toast.success'));
          void this.router.navigateByUrl('/home');
        },
        error: (error) => {
          const key = authErrorKey(error, 'invitation');
          if (key === 'setPassword.errors.invalidLink') {
            // The link died between opening the page and pressing the button:
            // nothing on this form can work now, so show the way out instead.
            this.linkError = this.translate.t(key);
            return;
          }
          this.submitError = this.translate.t(key);
          setTimeout(() => {
            const field = document.getElementById('spPassword') as HTMLInputElement | null;
            field?.focus();
            field?.select();
          });
        },
      });
  }
}
