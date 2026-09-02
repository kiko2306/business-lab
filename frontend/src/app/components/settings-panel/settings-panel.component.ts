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
  MailSettings,
  MailSettingsInput,
  MailTestResponse,
  BackupTargetInput,
  BackupTargetKind,
  BackupTargetSettings,
  BackupTargetTestResponse,
  BackupJobProvisionResponse,
  ExposureTestResponse,
  GeneralSettings,
  AlertNotifySettings,
} from '../../core/models';
import { SettingsService } from '../../core/settings.service';
import { ToastService } from '../../core/toast.service';

@Component({
  selector: 'app-settings-panel',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  templateUrl: './settings-panel.component.html',
  styleUrl: './settings-panel.component.css'
})
export class SettingsPanelComponent implements OnInit {
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

  // Sending is required as a set; receiving is entirely optional, so only
  // the SMTP half carries validators. Clearing imapHost turns receiving off.
  protected readonly mailForm = this.formBuilder.nonNullable.group({
    smtpHost: ['', [Validators.required, Validators.maxLength(255)]],
    smtpPort: [587, [Validators.required, Validators.min(1), Validators.max(65535)]],
    smtpUser: ['', [Validators.maxLength(255)]],
    smtpPassword: ['', [Validators.maxLength(255)]],
    smtpEncryption: ['tls', [Validators.required]],
    fromAddress: ['', [Validators.required, Validators.email, Validators.maxLength(255)]],
    fromName: ['', [Validators.maxLength(255)]],
    imapHost: ['', [Validators.maxLength(255)]],
    imapPort: [993, [Validators.min(1), Validators.max(65535)]],
    imapUser: ['', [Validators.maxLength(255)]],
    imapPassword: ['', [Validators.maxLength(255)]],
    imapEncryption: ['ssl'],
  });

  // One form for all destination types; which controls matter depends on
  // `kind`, and the template shows only the relevant ones. Validation is done
  // server-side because the rules differ per kind and duplicating them here
  // would be two places to keep in step.
  protected readonly backupTargetForm = this.formBuilder.nonNullable.group({
    kind: ['disk' as BackupTargetKind],
    path: [''],
    server: [''],
    share: [''],
    username: [''],
    password: [''],
    options: [''],
    authId: [''],
    folder: [''],
  });

  protected readonly generalForm = this.formBuilder.nonNullable.group({
    timezone: ['', [Validators.required]],
  });

  protected configuredSettings: CloudflareSettings | null = null;
  protected exposureSettings: ExposureSettings | null = null;
  protected generalSettings: GeneralSettings | null = null;
  protected generalLoading = true;
  protected savingGeneral = false;
  protected generalFeedback: { type: 'success' | 'danger' | 'info'; message: string } | null = null;
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
  protected mailSettings: MailSettings | null = null;
  protected mailLoading = true;
  protected savingMail = false;
  protected testingMail = false;
  protected mailFeedback: { type: 'success' | 'danger' | 'info'; message: string } | null = null;
  protected mailTestResult: MailTestResponse | null = null;
  protected backupTarget: BackupTargetSettings | null = null;
  protected backupTargetLoading = true;
  protected savingBackupTarget = false;
  protected testingBackupTarget = false;
  protected backupTargetFeedback: { type: 'success' | 'danger' | 'info'; message: string } | null = null;
  protected backupTargetTestResult: BackupTargetTestResponse | null = null;
  protected provisioningJob = false;
  protected backupJob: BackupJobProvisionResponse | null = null;
  protected alertSettings: AlertNotifySettings | null = null;
  protected alertsLoading = true;
  protected savingAlerts = false;
  protected alertsFeedback: { type: 'success' | 'danger' | 'info'; message: string } | null = null;
  // Editable copy of the ntfy topic; committed on "Save topic".
  protected alertTopicDraft = '';
  protected readonly alertTopicPattern = /^[A-Za-z0-9_-]{1,64}$/;
  protected testingAlertSource: string | null = null;

  sanitizeTokenPaste(event: ClipboardEvent): void {
    const pasted = event.clipboardData?.getData('text') ?? '';
    const sanitized = sanitizePastedText(pasted, 4096);
    event.preventDefault();
    this.form.controls.token.setValue(sanitized);
    this.form.controls.token.markAsDirty();
  }

  ngOnInit(): void {
    this.loadSettings();
    this.loadExposureSettings();
    this.loadGeneralSettings();
    this.loadMailSettings();
    this.loadBackupTarget();
    this.loadAlertSettings();
  }

  private loadAlertSettings(): void {
    this.alertsLoading = true;
    this.settingsService
      .loadAlertSettings()
      .pipe(finalize(() => (this.alertsLoading = false)))
      .subscribe({
        next: (settings) => {
          this.alertSettings = settings;
          this.alertTopicDraft = settings.topic;
        },
        error: (error) => {
          this.alertsFeedback = {
            type: 'danger',
            message: extractErrorMessage(error, 'Unable to load alert settings.'),
          };
        },
      });
  }

  protected get alertTopicDirty(): boolean {
    return !!this.alertSettings && this.alertTopicDraft.trim() !== this.alertSettings.topic;
  }

  protected get alertTopicValid(): boolean {
    return this.alertTopicPattern.test(this.alertTopicDraft.trim());
  }

  toggleCrowdsecAlerts(enabled: boolean): void {
    this.saveAlertSettings({ crowdsecEnabled: enabled });
  }

  saveAlertTopic(): void {
    if (!this.alertTopicValid) {
      return;
    }
    this.saveAlertSettings({ topic: this.alertTopicDraft.trim() });
  }

  testAlertSource(source: string): void {
    this.testingAlertSource = source;
    this.alertsFeedback = null;
    this.settingsService
      .testAlertSource(source)
      .pipe(finalize(() => (this.testingAlertSource = null)))
      .subscribe({
        next: (res) => {
          this.alertsFeedback = { type: res.ok ? 'success' : 'danger', message: res.message };
        },
        error: (error) => {
          this.alertsFeedback = {
            type: 'danger',
            message: extractErrorMessage(error, 'Test failed.'),
          };
        },
      });
  }

  private saveAlertSettings(input: { topic?: string; crowdsecEnabled?: boolean }): void {
    this.savingAlerts = true;
    this.alertsFeedback = null;
    this.settingsService
      .saveAlertSettings(input)
      .pipe(finalize(() => (this.savingAlerts = false)))
      .subscribe({
        next: (response) => {
          this.alertSettings = { topic: response.topic, crowdsecEnabled: response.crowdsecEnabled };
          this.alertTopicDraft = response.topic;
          this.alertsFeedback = { type: 'success', message: response.message };
        },
        error: (error) => {
          this.alertsFeedback = {
            type: 'danger',
            message: extractErrorMessage(error, 'Unable to save alert settings.'),
          };
        },
      });
  }

  private loadGeneralSettings(): void {
    this.generalLoading = true;
    this.settingsService
      .loadGeneralSettings()
      .pipe(finalize(() => (this.generalLoading = false)))
      .subscribe({
        next: (settings) => {
          this.generalSettings = settings;
          this.generalForm.controls.timezone.setValue(settings.timezone);
        },
        error: (error) => {
          this.generalFeedback = { type: 'danger', message: extractErrorMessage(error, 'Unable to load general settings.') };
        },
      });
  }

  saveGeneral(): void {
    if (this.generalForm.invalid) {
      this.generalForm.markAllAsTouched();
      return;
    }
    this.savingGeneral = true;
    this.settingsService
      .saveGeneralSettings(this.generalForm.controls.timezone.value)
      .pipe(finalize(() => (this.savingGeneral = false)))
      .subscribe({
        next: (response) => {
          this.generalFeedback = { type: 'success', message: response.message };
          this.toastService.success('Timezone saved.');
          if (this.generalSettings) {
            this.generalSettings = { ...this.generalSettings, timezone: response.timezone };
          }
        },
        error: (error) => {
          this.generalFeedback = { type: 'danger', message: extractErrorMessage(error, 'Unable to save timezone.') };
        },
      });
  }

  /** Port that matches the chosen encryption, offered as the user switches. */
  protected onMailEncryptionChange(protocol: 'smtp' | 'imap'): void {
    const control = protocol === 'smtp' ? this.mailForm.controls.smtpPort : this.mailForm.controls.imapPort;
    const encryption = protocol === 'smtp'
      ? this.mailForm.controls.smtpEncryption.value
      : this.mailForm.controls.imapEncryption.value;
    const suggested = protocol === 'smtp'
      ? encryption === 'ssl' ? 465 : encryption === 'tls' ? 587 : 25
      : encryption === 'none' ? 143 : 993;
    // Only overwrite a port the user hasn't deliberately customised — the
    // suggestion is a convenience, not a correction.
    const standard = protocol === 'smtp' ? [25, 465, 587] : [143, 993];
    if (standard.includes(control.value)) {
      control.setValue(suggested);
    }
  }

  /** Google Drive is reached by Duplicati itself, so there is no mount. */
  protected get backupTargetIsMounted(): boolean {
    return this.backupTargetForm.controls.kind.value !== 'googledrive';
  }

  /**
   * Create the backup job in Duplicati from the saved destination. Until this
   * runs there is no job, so nothing is ever backed up however the schedule is
   * configured.
   */
  provisionBackupJob(): void {
    this.provisioningJob = true;
    this.settingsService
      .provisionBackupJob()
      .pipe(finalize(() => (this.provisioningJob = false)))
      .subscribe({
        next: (result) => {
          this.backupJob = result;
          this.backupTargetFeedback = { type: 'success', message: result.message };
        },
        error: (error) =>
          (this.backupTargetFeedback = {
            type: 'danger',
            message: extractErrorMessage(error, 'Could not create the backup job.'),
          }),
      });
  }

  loadBackupTarget(): void {
    this.backupTargetLoading = true;
    this.settingsService
      .getBackupTarget()
      .pipe(finalize(() => (this.backupTargetLoading = false)))
      .subscribe({
        next: (settings) => {
          this.backupTarget = settings;
          this.backupTargetForm.patchValue({
            kind: settings.kind,
            path: settings.path ?? '',
            server: settings.server ?? '',
            share: settings.share ?? '',
            username: settings.username ?? '',
            options: settings.options ?? '',
            folder: settings.folder ?? '',
          });
        },
        error: () =>
          (this.backupTargetFeedback = { type: 'danger', message: 'Unable to load the backup destination.' }),
      });
  }

  saveBackupTarget(): void {
    const value = this.backupTargetForm.getRawValue();
    const payload: BackupTargetInput = { kind: value.kind };

    if (value.kind === 'googledrive') {
      payload.folder = value.folder.trim();
      if (value.authId) payload.authId = value.authId.trim();
    } else if (value.kind === 'disk') {
      payload.path = value.path.trim();
    } else {
      payload.server = value.server.trim();
      payload.share = value.share.trim();
      payload.username = value.username.trim();
      payload.options = value.options.trim();
      if (value.password) payload.password = value.password;
    }

    this.savingBackupTarget = true;
    this.backupTargetTestResult = null;
    this.settingsService
      .saveBackupTarget(payload)
      .pipe(finalize(() => (this.savingBackupTarget = false)))
      .subscribe({
        next: (response) => {
          this.backupTargetFeedback = { type: 'success', message: response.message };
          this.backupTargetForm.controls.password.reset('');
          this.backupTargetForm.controls.authId.reset('');
          this.loadBackupTarget();
        },
        error: (error) =>
          (this.backupTargetFeedback = {
            type: 'danger',
            message: extractErrorMessage(error, 'Unable to save the backup destination.'),
          }),
      });
  }

  testBackupTarget(): void {
    this.testingBackupTarget = true;
    this.backupTargetTestResult = null;
    this.settingsService
      .testBackupTarget()
      .pipe(finalize(() => (this.testingBackupTarget = false)))
      .subscribe({
        next: (result) => {
          this.backupTargetTestResult = result;
          this.backupTargetFeedback = {
            type: result.success ? 'success' : 'danger',
            message: result.message,
          };
        },
        error: (error) =>
          (this.backupTargetFeedback = {
            type: 'danger',
            message: extractErrorMessage(error, 'Could not test the destination.'),
          }),
      });
  }

  loadMailSettings(): void {
    this.mailLoading = true;
    this.settingsService
      .getMailSettings()
      .pipe(finalize(() => (this.mailLoading = false)))
      .subscribe({
        next: (settings) => {
          this.mailSettings = settings;
          this.mailForm.patchValue({
            smtpHost: settings.smtpHost ?? '',
            smtpPort: Number(settings.smtpPort ?? 587),
            smtpUser: settings.smtpUser ?? '',
            smtpEncryption: settings.smtpEncryption,
            fromAddress: settings.fromAddress ?? '',
            fromName: settings.fromName ?? '',
            imapHost: settings.imapHost ?? '',
            imapPort: Number(settings.imapPort ?? 993),
            imapUser: settings.imapUser ?? '',
            imapEncryption: settings.imapEncryption,
          });
        },
        error: () => (this.mailFeedback = { type: 'danger', message: 'Unable to load mail settings.' }),
      });
  }

  saveMail(): void {
    if (this.mailForm.invalid) {
      this.mailForm.markAllAsTouched();
      this.mailFeedback = { type: 'info', message: 'Fill in the sending fields with valid values before saving.' };
      return;
    }

    const value = this.mailForm.getRawValue();
    // A username with no password and none stored would save a login that
    // cannot work — catch it here rather than at the first failed send.
    if (value.smtpUser && !value.smtpPassword && !this.mailSettings?.smtpPasswordConfigured) {
      this.mailForm.controls.smtpPassword.setErrors({ required: true });
      this.mailForm.controls.smtpPassword.markAsTouched();
      this.mailFeedback = { type: 'info', message: 'Enter the mailbox password.' };
      return;
    }

    const imapHost = value.imapHost.trim();
    const payload: MailSettingsInput = {
      smtpHost: value.smtpHost.trim(),
      smtpPort: value.smtpPort,
      smtpUser: value.smtpUser.trim(),
      smtpEncryption: value.smtpEncryption as MailSettingsInput['smtpEncryption'],
      fromAddress: value.fromAddress.trim(),
      fromName: value.fromName.trim(),
      imapHost,
      imapPort: imapHost ? value.imapPort : null,
      imapUser: imapHost ? value.imapUser.trim() : '',
      imapEncryption: value.imapEncryption as MailSettingsInput['imapEncryption'],
    };
    if (value.smtpPassword) payload.smtpPassword = value.smtpPassword;
    if (imapHost && value.imapPassword) payload.imapPassword = value.imapPassword;

    this.savingMail = true;
    this.mailTestResult = null;
    this.settingsService
      .saveMailSettings(payload)
      .pipe(finalize(() => (this.savingMail = false)))
      .subscribe({
        next: (response) => {
          this.mailFeedback = { type: 'success', message: response.message };
          this.mailForm.controls.smtpPassword.reset('');
          this.mailForm.controls.imapPassword.reset('');
          this.loadMailSettings();
        },
        error: (error) => (this.mailFeedback = { type: 'danger', message: extractErrorMessage(error, 'Unable to save mail settings.') }),
      });
  }

  testMail(): void {
    this.testingMail = true;
    this.mailTestResult = null;
    this.settingsService
      .testMailSettings()
      .pipe(finalize(() => (this.testingMail = false)))
      .subscribe({
        next: (result) => {
          this.mailTestResult = result;
          this.mailFeedback = { type: result.success ? 'success' : 'danger', message: result.message };
        },
        error: (error) => {
          this.mailFeedback = { type: 'danger', message: extractErrorMessage(error, 'Mail test failed.') };
        },
      });
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
}
