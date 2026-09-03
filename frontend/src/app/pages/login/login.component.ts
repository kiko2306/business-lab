import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { extractErrorMessage } from '../../core/api';
import { AuthService } from '../../core/auth.service';
import { sanitizePastedText } from '../../core/input-sanitize';
import { isMfaChallenge } from '../../core/models';
import { ToastService } from '../../core/toast.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toastService = inject(ToastService);

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
          this.toastService.success('Signed in successfully.');
          void this.router.navigateByUrl('/dashboard');
        },
        error: (error) => {
          this.errorMessage = extractErrorMessage(error, 'Unable to sign in.');
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
          this.toastService.success('Signed in successfully.');
          void this.router.navigateByUrl('/dashboard');
        },
        error: (error) => {
          this.errorMessage = extractErrorMessage(error, 'That code was not accepted.');
        },
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
