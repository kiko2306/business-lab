import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DomSanitizer, SafeHtml, SafeUrl } from '@angular/platform-browser';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize } from 'rxjs';
import { extractErrorMessage } from '../../core/api';
import { TotpStatus } from '../../core/models';
import { OperationsService } from '../../core/operations.service';
import { ToastService } from '../../core/toast.service';
import { ConfirmService } from '../../core/confirm.service';
import { PanelComponent } from '../../components/panel/panel.component';
import { AuthService } from '../../core/auth.service';
import { CrowdsecBansComponent } from './crowdsec-bans.component';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { TranslateService } from '../../i18n/translate.service';
import { FieldErrorDirective } from '../../components/field-error.directive';

// Which panel is on screen. 'enrolling' and 'recovery-codes' are transient and
// only reachable by walking through the flow — never on a fresh load.
type View = 'loading' | 'status' | 'enrolling' | 'recovery-codes';

@Component({
    selector: 'app-account',
    imports: [CommonModule, ReactiveFormsModule, PanelComponent, CrowdsecBansComponent, TranslatePipe, FieldErrorDirective],
    templateUrl: './account.component.html',
    styleUrl: './account.component.css'
})
export class AccountComponent implements OnInit {
  private readonly operations = inject(OperationsService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly translate = inject(TranslateService);
  // The ban list's API sits behind `settings:manage` (§546).
  protected readonly canManageBans = inject(AuthService).hasCapability('settings:manage');

  protected view: View = 'loading';
  protected status: TotpStatus | null = null;
  protected errorMessage = '';
  protected busy = false;

  // Enrolment state — the pending secret and its QR, held only until activate
  // succeeds or the user cancels. The secret is also shown as text for manual
  // entry into apps that can't scan.
  protected qrSvg: SafeHtml | null = null;
  // The same secret as an otpauth:// link: on the phone showing the QR, an
  // authenticator cannot scan its own screen, but it can open this.
  protected otpauthUrl: SafeUrl | null = null;
  protected secret = '';

  // Shown exactly once, straight after activate. The backend never returns
  // these again, so leaving this view without saving them is the user's loss.
  protected recoveryCodes: string[] = [];
  /** Done stays held until the codes are copied, downloaded or the person says they are stored. */
  protected codesStored = false;

  // Failures of a code sit under the field that failed (announced through
  // appFieldError), not in the page banner `errorMessage`, which is for the
  // page as a whole: a failed load, a failed setup (plan.md §819).
  protected activateError = '';
  protected disableError = '';

  protected readonly activateForm = this.formBuilder.nonNullable.group({
    code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6)]],
  });

  // A current 6-digit code or a recovery code — never the account password: a
  // phished password would remove the second factor (plan.md §819). Not
  // individually `required`, so disable() can say what is wanted in words.
  protected readonly disableForm = this.formBuilder.nonNullable.group({
    code: [''],
  });

  ngOnInit(): void {
    this.loadStatus();
  }

  /** `focusSummary`: a step just ended, so focus lands on the status rather than falling to <body>. */
  private loadStatus(focusSummary = false): void {
    this.view = 'loading';
    this.operations.getTotpStatus().subscribe({
      next: (status) => {
        this.status = status;
        this.view = 'status';
        if (focusSummary) {
          this.refocus('status-summary');
        }
      },
      error: (error) => {
        this.errorMessage = extractErrorMessage(error, this.translate.t('account.errors.loadStatus'));
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
          this.otpauthUrl = this.sanitizer.bypassSecurityTrustUrl(response.otpauthUri);
          this.secret = response.secret;
          this.activateForm.reset();
          this.view = 'enrolling';
          this.refocus('enrolling-heading');
        },
        error: (error) => (this.errorMessage = extractErrorMessage(error, this.translate.t('account.errors.startEnrolment'))),
      });
  }

  /** A 400 means the code was wrong; anything else is the server's trouble, not theirs. */
  private codeFailure(error: unknown, rejectedKey: string, failedKey: string): string {
    return error instanceof HttpErrorResponse && error.status === 400
      ? this.translate.t(rejectedKey)
      : extractErrorMessage(error, this.translate.t(failedKey));
  }

  /** Puts the cursor back in the field after a failure, once Angular has drawn the error. */
  private refocus(id: string): void {
    setTimeout(() => document.getElementById(id)?.focus());
  }

  cancelSetup(): void {
    // The pending secret is left on the server; the next setup call replaces
    // it, and it's inert until activated.
    this.qrSvg = null;
    this.otpauthUrl = null;
    this.secret = '';
    this.activateForm.reset();
    this.errorMessage = '';
    this.activateError = '';
    this.view = 'status';
    this.refocus('status-summary');
  }

  activate(): void {
    if (this.activateForm.invalid) {
      this.activateForm.markAllAsTouched();
      return;
    }

    this.errorMessage = '';
    this.activateError = '';
    this.busy = true;
    this.operations
      .activateTotp(this.activateForm.getRawValue().code.trim())
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: (response) => {
          this.recoveryCodes = response.recoveryCodes;
          this.codesStored = false;
          this.qrSvg = null;
          this.otpauthUrl = null;
          this.secret = '';
          this.view = 'recovery-codes';
          // No toast: the screen itself says it, and a toast over the header
          // for five seconds was a third copy of the same news. Focus moves to
          // the heading so a screen reader lands on the codes.
          this.refocus('recovery-heading');
        },
        error: (error) => {
          this.activateError = this.codeFailure(error, 'account.errors.codeRejected', 'account.errors.activateFailed');
          this.refocus('activate-code');
        },
      });
  }

  finishRecoveryCodes(): void {
    this.recoveryCodes = [];
    this.loadStatus(true);
  }

  downloadRecoveryCodes(): void {
    const body = [
      this.translate.t('account.recoveryFile.header'),
      this.translate.t('account.recoveryFile.instructions'),
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
    this.codesStored = true;
  }

  copyKey(): void {
    void navigator.clipboard?.writeText(this.secret).then(
      () => this.toast.success(this.translate.t('account.toast.keyCopied')),
      () => this.toast.error(this.translate.t('account.toast.copyFailed')),
    );
  }

  copyRecoveryCodes(): void {
    void navigator.clipboard?.writeText(this.recoveryCodes.join('\n')).then(
      () => {
        this.codesStored = true;
        this.toast.success(this.translate.t('account.toast.recoveryCopied'));
      },
      () => this.toast.error(this.translate.t('account.toast.copyFailed')),
    );
  }

  async disable(): Promise<void> {
    const code = this.disableForm.getRawValue().code.trim();
    this.disableError = '';
    if (!code) {
      this.disableError = this.translate.t('account.errors.enterCode');
      this.refocus('disable-code');
      return;
    }

    // One click used to remove the second factor. Say what changes first.
    const confirmed = await this.confirm.ask({
      title: this.translate.t('account.disable.confirmTitle'),
      message: this.translate.t('account.disable.confirmMessage'),
      confirmText: this.translate.t('account.disable.confirmText'),
      danger: true,
    });
    if (!confirmed) {
      return;
    }

    this.busy = true;
    this.operations
      .disableTotp({ code })
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: () => {
          this.disableForm.reset();
          this.toast.success(this.translate.t('account.toast.disabled'));
          this.loadStatus(true);
        },
        error: (error) => {
          this.disableError = this.codeFailure(error, 'account.errors.disableRejected', 'account.errors.disable');
          this.refocus('disable-code');
        },
      });
  }
}
