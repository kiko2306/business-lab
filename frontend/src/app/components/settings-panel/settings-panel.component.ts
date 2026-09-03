import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { extractErrorMessage } from '../../core/api';
import {
  MailSettings,
  MailSettingsInput,
  MailTestResponse,
  BackupTargetInput,
  BackupTargetKind,
  BackupTargetSettings,
  BackupTargetTestResponse,
  BackupJobProvisionResponse,
  GeneralSettings,
  AlertNotifySettings,
} from '../../core/models';
import { SettingsService } from '../../core/settings.service';
import { ToastService } from '../../core/toast.service';
import { PanelComponent } from '../panel/panel.component';

@Component({
  selector: 'app-settings-panel',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, PanelComponent],
  templateUrl: './settings-panel.component.html',
  styleUrl: './settings-panel.component.css'
})
export class SettingsPanelComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly settingsService = inject(SettingsService);
  private readonly toastService = inject(ToastService);

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

  protected generalSettings: GeneralSettings | null = null;
  protected generalLoading = true;
  protected savingGeneral = false;
  protected generalFeedback: { type: 'success' | 'danger' | 'info'; message: string } | null = null;
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

  ngOnInit(): void {
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

  toggleCrowdsecEnforcement(enabled: boolean): void {
    this.saveAlertSettings({ enforceNpm: enabled });
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

  private saveAlertSettings(input: { topic?: string; crowdsecEnabled?: boolean; enforceNpm?: boolean }): void {
    this.savingAlerts = true;
    this.alertsFeedback = null;
    this.settingsService
      .saveAlertSettings(input)
      .pipe(finalize(() => (this.savingAlerts = false)))
      .subscribe({
        next: (response) => {
          this.alertSettings = {
            topic: response.topic,
            crowdsecEnabled: response.crowdsecEnabled,
            enforceNpm: response.enforceNpm,
          };
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
}
