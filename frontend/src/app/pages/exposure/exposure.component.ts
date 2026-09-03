import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { extractErrorMessage } from '../../core/api';
import { sanitizePastedText } from '../../core/input-sanitize';
import {
  CloudflareSettings,
  ExposureSettings,
  ExposureSettingsInput,
  ExposureTestResponse,
} from '../../core/models';
import { SettingsService } from '../../core/settings.service';
import { ToastService } from '../../core/toast.service';
import { PanelComponent } from '../../components/panel/panel.component';

/**
 * Exposure & networking on its own route (§131.1): the Cloudflare Tunnel token
 * and the first-start exposure-provisioning settings (base domain, tunnel/zone
 * IDs, Nginx Proxy Manager credentials). Lifted out of the Settings panel
 * (§136.4) — the two panels were always the networking half of that stack, and
 * they share the same token. Per-service exposure stays on each service card
 * on the Apps page.
 */
@Component({
  selector: 'app-exposure',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, PanelComponent],
  templateUrl: './exposure.component.html',
  styleUrl: './exposure.component.css',
})
export class ExposureComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly settingsService = inject(SettingsService);
  private readonly toastService = inject(ToastService);

  protected readonly form = this.formBuilder.nonNullable.group({
    token: ['', [Validators.minLength(20), Validators.maxLength(4096)]],
  });

  protected readonly exposureForm = this.formBuilder.nonNullable.group({
    baseDomain: ['', [Validators.required, Validators.maxLength(255)]],
    npmApiUrl: ['', [Validators.required, Validators.maxLength(500)]],
    npmEmail: ['', [Validators.required, Validators.email, Validators.maxLength(255)]],
    npmPassword: ['', [Validators.maxLength(255)]],
    cloudflareAccountId: ['', [Validators.required, Validators.maxLength(32)]],
    cloudflareZoneId: ['', [Validators.required, Validators.maxLength(32)]],
    cloudflareTunnelId: ['', [Validators.required, Validators.maxLength(255)]],
  });

  protected configuredSettings: CloudflareSettings | null = null;
  protected exposureSettings: ExposureSettings | null = null;
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
          this.feedback = { type: 'danger', message: extractErrorMessage(error, 'Unable to load settings.') };
        },
      });
  }

  save(): void {
    const token = this.form.controls.token.value.trim();

    if (!token) {
      this.form.controls.token.setErrors({ required: true });
      this.feedback = { type: 'info', message: 'Enter a new token to replace the saved value.' };
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
          this.feedback = { type: 'success', message: settings.message ?? 'Cloudflare token saved successfully.' };
          this.form.reset();
          this.toastService.success('Cloudflare token updated.');
        },
        error: (error) => {
          this.feedback = { type: 'danger', message: extractErrorMessage(error, 'Unable to save token.') };
        },
      });
  }

  testConnection(): void {
    const token = this.form.controls.token.value.trim();

    if (!token && !this.configuredSettings?.configured) {
      this.feedback = { type: 'info', message: 'Enter a token first so the connection can be tested.' };
      return;
    }

    this.testing = true;
    this.settingsService
      .testCloudflareToken(token || undefined)
      .pipe(finalize(() => (this.testing = false)))
      .subscribe({
        next: (response) => {
          this.feedback = { type: 'success', message: response.message };
          this.toastService.success(response.message);
        },
        error: (error) => {
          this.feedback = { type: 'danger', message: extractErrorMessage(error, 'Unable to test token.') };
        },
      });
  }

  validationMessage(): string | null {
    const control = this.form.controls.token;

    if (control.hasError('required')) {
      return 'A token is required to save changes.';
    }

    if (control.hasError('minlength')) {
      return 'Use the full Cloudflare API token.';
    }
    if (control.hasError('maxlength')) {
      return 'Token is too long.';
    }

    return null;
  }

  saveExposure(): void {
    if (this.exposureForm.invalid) {
      this.exposureForm.markAllAsTouched();
      this.exposureFeedback = {
        type: 'info',
        message: 'Complete all required exposure settings with valid values before saving.',
      };
      return;
    }

    const value = this.exposureForm.getRawValue();
    if (!value.npmPassword && !this.exposureSettings?.npmPasswordConfigured) {
      this.exposureForm.controls.npmPassword.setErrors({ required: true });
      this.exposureForm.controls.npmPassword.markAsTouched();
      this.exposureFeedback = { type: 'info', message: 'Enter the Nginx Proxy Manager admin password.' };
      return;
    }

    this.savingExposure = true;
    const payload: ExposureSettingsInput = {
      baseDomain: value.baseDomain.trim(),
      npmApiUrl: value.npmApiUrl.trim(),
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
          this.toastService.success('Exposure settings saved.');
          this.exposureForm.controls.npmPassword.reset('');
          this.exposureTestResult = null;
          this.loadExposureSettings();
        },
        error: (error) => {
          this.exposureFeedback = { type: 'danger', message: extractErrorMessage(error, 'Unable to save exposure settings.') };
        },
      });
  }

  testExposureConnection(): void {
    if (!this.exposureSettings?.configured) {
      this.exposureFeedback = { type: 'info', message: 'Save exposure settings before testing the connection.' };
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
            this.toastService.success('Nginx Proxy Manager and Cloudflare are both reachable.');
          }
        },
        error: (error) => {
          this.exposureFeedback = { type: 'danger', message: extractErrorMessage(error, 'Unable to test exposure connection.') };
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
            npmApiUrl: settings.npmApiUrl ?? '',
            npmEmail: settings.npmEmail ?? '',
            cloudflareAccountId: settings.cloudflareAccountId ?? '',
            cloudflareZoneId: settings.cloudflareZoneId ?? '',
            cloudflareTunnelId: settings.cloudflareTunnelId ?? '',
          });
        },
        error: (error) => {
          this.exposureFeedback = { type: 'danger', message: extractErrorMessage(error, 'Unable to load exposure settings.') };
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
      return `${fieldName} is required.`;
    }
    if (control.hasError('email')) {
      return 'Enter a valid email address.';
    }
    if (control.hasError('maxlength')) {
      return `${fieldName} is too long.`;
    }

    return `Enter a valid ${fieldName.toLowerCase()}.`;
  }
}
