import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { extractErrorMessage } from '../../core/api';
import { AuthService } from '../../core/auth.service';
import { sanitizePastedText } from '../../core/input-sanitize';
import { ToastService } from '../../core/toast.service';

@Component({
  selector: 'app-setup',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './setup.component.html',
  styleUrl: './setup.component.css'
})
export class SetupComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toastService = inject(ToastService);

  protected readonly form = this.formBuilder.nonNullable.group({
    username: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(64)]],
    password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128)]],
    confirmPassword: ['', [Validators.required, Validators.maxLength(128)]],
  });

  protected submitting = false;
  protected errorMessage = '';

  sanitizePaste(event: ClipboardEvent, controlName: 'username' | 'password' | 'confirmPassword', maxLength: number): void {
    const pasted = event.clipboardData?.getData('text') ?? '';
    const sanitized = sanitizePastedText(pasted, maxLength, controlName === 'username');
    event.preventDefault();
    this.form.controls[controlName].setValue(sanitized);
    this.form.controls[controlName].markAsDirty();
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { username, password, confirmPassword } = this.form.getRawValue();
    if (password !== confirmPassword) {
      this.errorMessage = 'Passwords do not match.';
      return;
    }

    this.errorMessage = '';
    this.submitting = true;

    this.authService
      .setup(username, password)
      .pipe(finalize(() => (this.submitting = false)))
      .subscribe({
        next: () => {
          this.toastService.success('Administrator account created.');
          void this.router.navigateByUrl('/home');
        },
        error: (error) => {
          this.errorMessage = extractErrorMessage(error, 'Unable to complete setup.');
        },
      });
  }
}
