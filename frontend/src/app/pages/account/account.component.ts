import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { finalize } from 'rxjs';
import { extractErrorMessage } from '../../core/api';
import { TotpStatus } from '../../core/models';
import { OperationsService } from '../../core/operations.service';
import { ToastService } from '../../core/toast.service';

// Which panel is on screen. 'enrolling' and 'recovery-codes' are transient and
// only reachable by walking through the flow — never on a fresh load.
type View = 'loading' | 'status' | 'enrolling' | 'recovery-codes';

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './account.component.html',
  styleUrl: './account.component.css',
})
export class AccountComponent implements OnInit {
  private readonly operations = inject(OperationsService);
  private readonly toast = inject(ToastService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly sanitizer = inject(DomSanitizer);

  protected view: View = 'loading';
  protected status: TotpStatus | null = null;
  protected errorMessage = '';
  protected busy = false;

  // Enrolment state — the pending secret and its QR, held only until activate
  // succeeds or the user cancels. The secret is also shown as text for manual
  // entry into apps that can't scan.
  protected qrSvg: SafeHtml | null = null;
  protected secret = '';

  // Shown exactly once, straight after activate. The backend never returns
  // these again, so leaving this view without saving them is the user's loss.
  protected recoveryCodes: string[] = [];

  protected readonly activateForm = this.formBuilder.nonNullable.group({
    code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6)]],
  });

  // A current 6-digit code OR the account password — the backend accepts
  // either, so neither field is individually required; disable() checks that
  // at least one is filled.
  protected readonly disableForm = this.formBuilder.nonNullable.group({
    code: [''],
    password: [''],
  });

  ngOnInit(): void {
    this.loadStatus();
  }

  private loadStatus(): void {
    this.view = 'loading';
    this.operations.getTotpStatus().subscribe({
      next: (status) => {
        this.status = status;
        this.view = 'status';
      },
      error: (error) => {
        this.errorMessage = extractErrorMessage(error, 'Unable to load two-factor status.');
        this.view = 'status';
      },
    });
  }

  beginSetup(): void {
    this.errorMessage = '';
    this.busy = true;
    this.operations
      .setupTotp()
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: (response) => {
          // The SVG comes from our own backend (the `qrcode` lib), not user
          // input, so bypassing the sanitiser here is safe and necessary —
          // Angular would otherwise strip the <path> elements.
          this.qrSvg = this.sanitizer.bypassSecurityTrustHtml(response.qrSvg);
          this.secret = response.secret;
          this.activateForm.reset();
          this.view = 'enrolling';
        },
        error: (error) => (this.errorMessage = extractErrorMessage(error, 'Unable to start enrolment.')),
      });
  }

  cancelSetup(): void {
    // The pending secret is left on the server; the next setup call replaces
    // it, and it's inert until activated.
    this.qrSvg = null;
    this.secret = '';
    this.activateForm.reset();
    this.errorMessage = '';
    this.view = 'status';
  }

  activate(): void {
    if (this.activateForm.invalid) {
      this.activateForm.markAllAsTouched();
      return;
    }

    this.errorMessage = '';
    this.busy = true;
    this.operations
      .activateTotp(this.activateForm.getRawValue().code.trim())
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: (response) => {
          this.recoveryCodes = response.recoveryCodes;
          this.qrSvg = null;
          this.secret = '';
          this.view = 'recovery-codes';
          this.toast.success('Two-factor authentication is on.');
        },
        error: (error) => (this.errorMessage = extractErrorMessage(error, 'That code was not accepted.')),
      });
  }

  finishRecoveryCodes(): void {
    this.recoveryCodes = [];
    this.loadStatus();
  }

  downloadRecoveryCodes(): void {
    const body = [
      'Business Lab — two-factor recovery codes',
      'Each code works once. Keep them somewhere safe and offline.',
      '',
      ...this.recoveryCodes,
      '',
    ].join('\n');
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'business-lab-recovery-codes.txt';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  copyRecoveryCodes(): void {
    void navigator.clipboard?.writeText(this.recoveryCodes.join('\n')).then(
      () => this.toast.success('Recovery codes copied.'),
      () => this.toast.error('Could not copy to the clipboard.'),
    );
  }

  disable(): void {
    const { code, password } = this.disableForm.getRawValue();
    const trimmedCode = code.trim();
    if (!trimmedCode && !password) {
      this.errorMessage = 'Enter a current 6-digit code or your account password.';
      return;
    }

    this.errorMessage = '';
    this.busy = true;
    const proof = trimmedCode ? { code: trimmedCode } : { password };
    this.operations
      .disableTotp(proof)
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: () => {
          this.disableForm.reset();
          this.toast.success('Two-factor authentication is off.');
          this.loadStatus();
        },
        error: (error) =>
          (this.errorMessage = extractErrorMessage(error, 'Unable to disable two-factor authentication.')),
      });
  }
}
