import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { extractErrorMessage } from '../../core/api';
import { AuthService } from '../../core/auth.service';
import { sanitizePastedText } from '../../core/input-sanitize';
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

  protected submitting = false;
  protected errorMessage = '';

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
        next: () => {
          this.toastService.success('Signed in successfully.');
          void this.router.navigateByUrl('/dashboard');
        },
        error: (error) => {
          this.errorMessage = extractErrorMessage(error, 'Unable to sign in.');
        },
      });
  }
}
