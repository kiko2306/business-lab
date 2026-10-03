import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { authErrorKey } from '../../core/auth-errors';
import { AuthService } from '../../core/auth.service';
import { sanitizePastedText } from '../../core/input-sanitize';
import { isMfaChallenge } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { TranslateService } from '../../i18n/translate.service';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { FieldErrorDirective } from '../../components/field-error.directive';
import { PasswordToggleDirective } from '../../components/password-toggle.directive';
import { AuthShellComponent } from '../../components/auth-shell/auth-shell.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, TranslatePipe, FieldErrorDirective, PasswordToggleDirective, AuthShellComponent],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toastService = inject(ToastService);
  protected readonly translate = inject(TranslateService);

  protected readonly form = this.formBuilder.nonNullable.group({
    username: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(64)]],
    password: ['', [Validators.required, Validators.maxLength(128)]],
  });

  protected readonly mfaForm = this.formBuilder.nonNullable.group({
    code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(32)]],
  });

  protected submitting = false;
  protected errorMessage = '';

  // Which step is on screen. 'mfa' appears only after the backend answers the
  // credentials step with a 202 challenge.
  protected stage: 'credentials' | 'mfa' = 'credentials';
  // Held in memory only — never persisted. Expires server-side in 5 minutes.
  private mfaToken = '';
  // Toggles the code field between "authenticator app" and "recovery code".
  protected useRecoveryCode = false;

  // Only offer "create the initial administrator account" while there genuinely
  // is no admin — otherwise the link reads as open self-registration on an
  // internet-facing page. Defaults false so nothing flashes before the probe
  // resolves.
  protected setupRequired = false;

  ngOnInit(): void {
    this.authService.isSetupRequired().subscribe((required) => (this.setupRequired = required));
    // The person came here to type: put the cursor where they start (plan.md §827).
    setTimeout(() => document.getElementById('username')?.focus());
  }

  sanitizePaste(event: ClipboardEvent, controlName: 'username' | 'password', maxLength: number): void {
    const pasted = event.clipboardData?.getData('text') ?? '';
    const sanitized = sanitizePastedText(pasted, maxLength, controlName !== 'password');
    event.preventDefault();
    this.form.controls[controlName].setValue(sanitized);
    this.form.controls[controlName].markAsDirty();
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.errorMessage = '';
    this.submitting = true;

    const { username, password } = this.form.getRawValue();
    this.authService
      .login(username, password)
      .pipe(finalize(() => (this.submitting = false)))
      .subscribe({
        next: (result) => {
          if (isMfaChallenge(result)) {
            this.mfaToken = result.mfaToken;
            this.stage = 'mfa';
            this.mfaForm.reset();
            this.useRecoveryCode = false;
            return;
          }
          this.toastService.success(this.translate.t('login.toast.success'));
          void this.router.navigateByUrl('/home');
        },
        error: (error) => {
          this.errorMessage = this.translate.t(authErrorKey(error, 'login'));
          this.refocus('password');
        },
      });
  }

  submitMfa(): void {
    if (this.mfaForm.invalid) {
      this.mfaForm.markAllAsTouched();
      return;
    }

    this.errorMessage = '';
    this.submitting = true;

    this.authService
      .completeMfaLogin(this.mfaToken, this.mfaForm.getRawValue().code)
      .pipe(finalize(() => (this.submitting = false)))
      .subscribe({
        next: () => {
          this.toastService.success(this.translate.t('login.toast.success'));
          void this.router.navigateByUrl('/home');
        },
        error: (error) => {
          const key = authErrorKey(error, 'mfa');
          if (key === 'login.error.mfaExpired') {
            // The token is gone: a retry on this step can only fail again.
            this.backToCredentials();
            this.errorMessage = this.translate.t(key);
            this.refocus('password');
            return;
          }
          this.errorMessage = this.translate.t(key);
          this.refocus('code');
        },
      });
  }

  /**
   * After a failure the cursor goes back to the field to retype, with its text
   * selected, once Angular has drawn the error. Without it focus fell to
   * <body> and the first Tab left the page (plan.md §827).
   */
  private refocus(id: string): void {
    setTimeout(() => {
      const field = document.getElementById(id) as HTMLInputElement | null;
      field?.focus();
      field?.select();
    });
  }

  toggleRecoveryCode(): void {
    this.useRecoveryCode = !this.useRecoveryCode;
    this.mfaForm.controls.code.reset();
  }

  backToCredentials(): void {
    this.stage = 'credentials';
    this.mfaToken = '';
    this.errorMessage = '';
    this.mfaForm.reset();
    this.form.controls.password.reset();
  }
}
