import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { extractErrorMessage } from '../../core/api';
import { sanitizePastedText } from '../../core/input-sanitize';
import {
  CloudflareAccountModel,
  CloudflareSettings,
  ExposureSettings,
  ExposureSettingsInput,
  ExposureTestResponse,
} from '../../core/models';
import { SettingsService } from '../../core/settings.service';
import { ToastService } from '../../core/toast.service';
import { PanelComponent } from '../../components/panel/panel.component';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { TranslateService } from '../../i18n/translate.service';

/**
 * Networking settings — the Cloudflare Tunnel token and the first-start
 * exposure-provisioning values (base domain, tunnel/zone IDs, Nginx Proxy
 * Manager credentials). Embedded in the Settings page (§331 slice 4, folded
 * back after living on its own `/exposure` route since §143). There is no
 * per-app exposure toggle any more — every exposable app is exposed
 * automatically (§331).
 */
@Component({
  selector: 'app-network-settings',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, PanelComponent, TranslatePipe],
  templateUrl: './network-settings.component.html',
  styleUrl: './network-settings.component.css',
})
export class NetworkSettingsComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly settingsService = inject(SettingsService);
  private readonly toastService = inject(ToastService);
  private readonly translate = inject(TranslateService);

  protected readonly form = this.formBuilder.nonNullable.group({
    token: ['', [Validators.minLength(20), Validators.maxLength(4096)]],
  });

  protected readonly exposureForm = this.formBuilder.nonNullable.group({
    baseDomain: ['', [Validators.required, Validators.maxLength(255)]],
    npmEmail: ['', [Validators.required, Validators.email, Validators.maxLength(255)]],
    npmPassword: ['', [Validators.maxLength(255)]],
    cloudflareAccountId: ['', [Validators.required, Validators.maxLength(32)]],
    cloudflareZoneId: ['', [Validators.required, Validators.maxLength(32)]],
    cloudflareTunnelId: ['', [Validators.required, Validators.maxLength(255)]],
  });

  protected configuredSettings: CloudflareSettings | null = null;
  protected exposureSettings: ExposureSettings | null = null;
  protected savingAccountModel = false;
  protected showToken = false;
  protected loading = true;
  protected exposureLoading = true;
  protected saving = false;
  protected savingExposure = false;
  protected testing = false;
  protected testingExposure = false;
  protected feedback: { type: 'success' | 'danger' | 'info'; message: string } | null = null;
  protected exposureFeedback: { type: 'success' | 'danger' | 'info'; message: string } | null = null;
  protected exposureTestResult: ExposureTestResponse | null = null;

  ngOnInit(): void {
    this.loadSettings();
    this.loadExposureSettings();
  }

  sanitizeTokenPaste(event: ClipboardEvent): void {
    const pasted = event.clipboardData?.getData('text') ?? '';
    const sanitized = sanitizePastedText(pasted, 4096);
    event.preventDefault();
    this.form.controls.token.setValue(sanitized);
    this.form.controls.token.markAsDirty();
  }

  private loadSettings(): void {
    this.loading = true;
    this.settingsService
      .loadCloudflareSettings()
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: (settings) => {
          this.configuredSettings = settings;
        },
        error: (error) => {
          this.feedback = { type: 'danger', message: extractErrorMessage(error, this.translate.t('networkSettings.errors.loadSettings')) };
        },
      });
  }

  save(): void {
    const token = this.form.controls.token.value.trim();

    if (!token) {
      this.form.controls.token.setErrors({ required: true });
      this.feedback = { type: 'info', message: this.translate.t('networkSettings.info.enterTokenToReplace') };
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving = true;
    this.settingsService
      .saveCloudflareToken(token)
      .pipe(finalize(() => (this.saving = false)))
      .subscribe({
        next: (settings) => {
          this.configuredSettings = settings;
          this.feedback = { type: 'success', message: settings.message ?? this.translate.t('networkSettings.toast.tokenSaved') };
          this.form.reset();
          this.toastService.success(this.translate.t('networkSettings.toast.tokenUpdated'));
        },
        error: (error) => {
          this.feedback = { type: 'danger', message: extractErrorMessage(error, this.translate.t('networkSettings.errors.saveToken')) };
        },
      });
  }

  testConnection(): void {
    const token = this.form.controls.token.value.trim();

    if (!token && !this.configuredSettings?.configured) {
      this.feedback = { type: 'info', message: this.translate.t('networkSettings.info.enterTokenToTest') };
      return;
    }

    this.testing = true;
    this.settingsService
      .testCloudflareToken(token || undefined)
      .pipe(finalize(() => (this.testing = false)))
      .subscribe({
        next: (response) => {
          // A multi-zone token still verifies fine — surface the scope
          // warning without calling the test a failure (§357 P9b).
          this.feedback = response.warning
            ? { type: 'info', message: `${response.message} ${response.warning}` }
            : { type: 'success', message: response.message };
          this.toastService.success(response.message);
        },
        error: (error) => {
          this.feedback = { type: 'danger', message: extractErrorMessage(error, this.translate.t('networkSettings.errors.testToken')) };
        },
      });
  }

  saveAccountModel(model: CloudflareAccountModel): void {
    if (!model || model === this.configuredSettings?.accountModel) {
      return;
    }
    this.savingAccountModel = true;
    this.settingsService
      .saveCloudflareAccountModel(model)
      .pipe(finalize(() => (this.savingAccountModel = false)))
      .subscribe({
        next: (response) => {
          if (this.configuredSettings) {
            this.configuredSettings.accountModel = response.accountModel;
          }
          this.toastService.success(response.message);
        },
        error: (error) => {
          this.feedback = { type: 'danger', message: extractErrorMessage(error, this.translate.t('networkSettings.errors.saveAccountModel')) };
        },
      });
  }

  validationMessage(): string | null {
    const control = this.form.controls.token;

    if (control.hasError('required')) {
      return this.translate.t('networkSettings.validation.tokenRequired');
    }

    if (control.hasError('minlength')) {
      return this.translate.t('networkSettings.validation.tokenTooShort');
    }
    if (control.hasError('maxlength')) {
      return this.translate.t('networkSettings.validation.tokenTooLong');
    }

    return null;
  }

  saveExposure(): void {
    if (this.exposureForm.invalid) {
      this.exposureForm.markAllAsTouched();
      this.exposureFeedback = {
        type: 'info',
        message: this.translate.t('networkSettings.info.completeExposureFields'),
      };
      return;
    }

    const value = this.exposureForm.getRawValue();
    if (!value.npmPassword && !this.exposureSettings?.npmPasswordConfigured) {
      this.exposureForm.controls.npmPassword.setErrors({ required: true });
      this.exposureForm.controls.npmPassword.markAsTouched();
      this.exposureFeedback = { type: 'info', message: this.translate.t('networkSettings.info.enterNpmPassword') };
      return;
    }

    this.savingExposure = true;
    const payload: ExposureSettingsInput = {
      baseDomain: value.baseDomain.trim(),
      npmEmail: value.npmEmail.trim(),
      cloudflareAccountId: value.cloudflareAccountId.trim(),
      cloudflareZoneId: value.cloudflareZoneId.trim(),
      cloudflareTunnelId: value.cloudflareTunnelId.trim(),
    };
    if (value.npmPassword) {
      payload.npmPassword = value.npmPassword;
    }

    this.settingsService
      .saveExposureSettings(payload)
      .pipe(finalize(() => (this.savingExposure = false)))
      .subscribe({
        next: (response) => {
          this.exposureFeedback = { type: 'success', message: response.message };
          this.toastService.success(this.translate.t('networkSettings.toast.exposureSaved'));
          this.exposureForm.controls.npmPassword.reset('');
          this.exposureTestResult = null;
          this.loadExposureSettings();
        },
        error: (error) => {
          this.exposureFeedback = { type: 'danger', message: extractErrorMessage(error, this.translate.t('networkSettings.errors.saveExposure')) };
        },
      });
  }

  testExposureConnection(): void {
    if (!this.exposureSettings?.configured) {
      this.exposureFeedback = { type: 'info', message: this.translate.t('networkSettings.testExposureTitleDisabled') };
      return;
    }

    this.testingExposure = true;
    this.exposureTestResult = null;
    this.settingsService
      .testExposureConnection()
      .pipe(finalize(() => (this.testingExposure = false)))
      .subscribe({
        next: (result) => {
          this.exposureTestResult = result;
          if (result.success) {
            this.toastService.success(this.translate.t('networkSettings.toast.bothReachable'));
          }
        },
        error: (error) => {
          this.exposureFeedback = { type: 'danger', message: extractErrorMessage(error, this.translate.t('networkSettings.errors.testExposure')) };
        },
      });
  }

  private loadExposureSettings(): void {
    this.exposureLoading = true;
    this.settingsService
      .loadExposureSettings()
      .pipe(finalize(() => (this.exposureLoading = false)))
      .subscribe({
        next: (settings) => {
          this.exposureSettings = settings;
          this.exposureForm.patchValue({
            baseDomain: settings.baseDomain ?? '',
            npmEmail: settings.npmEmail ?? '',
            cloudflareAccountId: settings.cloudflareAccountId ?? '',
            cloudflareZoneId: settings.cloudflareZoneId ?? '',
            cloudflareTunnelId: settings.cloudflareTunnelId ?? '',
          });
        },
        error: (error) => {
          this.exposureFeedback = { type: 'danger', message: extractErrorMessage(error, this.translate.t('networkSettings.errors.loadExposure')) };
        },
      });
  }

  exposureValidationMessage(
    controlName: keyof typeof this.exposureForm.controls,
    fieldName: string
  ): string | null {
    const control = this.exposureForm.controls[controlName];

    if (!control.touched || control.valid) {
      return null;
    }

    if (control.hasError('required')) {
      return this.translate.t('networkSettings.validation.required', { field: fieldName });
    }
    if (control.hasError('email')) {
      return this.translate.t('networkSettings.validation.email');
    }
    if (control.hasError('maxlength')) {
      return this.translate.t('networkSettings.validation.tooLong', { field: fieldName });
    }

    return this.translate.t('networkSettings.validation.invalid', { field: fieldName.toLowerCase() });
  }
}
