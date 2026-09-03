import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { extractErrorMessage } from '../../core/api';
import { AuthService } from '../../core/auth.service';
import { sanitizePastedText } from '../../core/input-sanitize';
import { ToastService } from '../../core/toast.service';

/**
 * Public landing for a `/set-password?token=…` invite link (plan.md §158).
 * Validates the token, then lets the invitee choose a password; on success the
 * account is activated and signed in.
 */
@Component({
  selector: 'app-set-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './set-password.component.html',
  styleUrl: './set-password.component.css',
})
export class SetPasswordComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly form = this.formBuilder.nonNullable.group({
    password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128)]],
    confirmPassword: ['', [Validators.required, Validators.maxLength(128)]],
  });

  private token = '';
  protected loading = true;
  protected submitting = false;
  /** Set when the link is bad/expired — the form is not shown. */
  protected linkError = '';
  protected invite: { username: string; email: string } | null = null;

  ngOnInit(): void {
    this.token = (this.route.snapshot.queryParamMap.get('token') ?? '').trim();
    if (!this.token) {
      this.loading = false;
      this.linkError = 'This link is missing its token. Ask whoever invited you to resend it.';
      return;
    }
    this.auth
      .getInvitation(this.token)
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: (invite) => (this.invite = invite),
        error: (error) =>
          (this.linkError = extractErrorMessage(
            error,
            'This invitation link is no longer valid. Ask for a new one.'
          )),
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
    this.submitting = true;
    this.auth
      .acceptInvitation(this.token, this.form.controls.password.value)
      .pipe(finalize(() => (this.submitting = false)))
      .subscribe({
        next: () => {
          this.toast.success('Password set — you are signed in.');
          void this.router.navigateByUrl('/home');
        },
        error: (error) =>
          this.toast.error(
            extractErrorMessage(error, 'Could not set the password. The link may have just expired.')
          ),
      });
  }
}
