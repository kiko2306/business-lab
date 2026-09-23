import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { extractErrorMessage } from '../../core/api';
import {
  MailSettings,
  MailSettingsInput,
  MailTestResponse,
  GeneralSettings,
  AlertNotifySettings,
  AlertCategory,
  ClaudeKeySettings,
  DeploymentStatus,
} from '../../core/models';
import { SettingsService } from '../../core/settings.service';
import { ToastService } from '../../core/toast.service';
import { AuthService } from '../../core/auth.service';
import { PanelComponent } from '../../components/panel/panel.component';
import { NetworkSettingsComponent } from './network-settings.component';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { TranslateService } from '../../i18n/translate.service';

/**
 * Stack-wide settings on its own route (§131.1): networking (the Cloudflare
 * token + first-start provisioning, `<app-network-settings>`, folded back in
 * from the old `/exposure` route — §331 slice 4), the timezone, ntfy alert
 * pushes and the shared mailbox.
 */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, PanelComponent, NetworkSettingsComponent, TranslatePipe],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css'
})
export class SettingsComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly settingsService = inject(SettingsService);
  private readonly toastService = inject(ToastService);
  protected readonly translate = inject(TranslateService);

  // Networking (Cloudflare token + tunnel provisioning) is the webmaster's
  // remit — `exposure:settings`, distinct from the `settings:manage` that
  // gates the rest of this page (§149).
  protected readonly canManageNetworking = inject(AuthService).hasCapability('exposure:settings');

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

  protected readonly generalForm = this.formBuilder.nonNullable.group({
    timezone: ['', [Validators.required]],
    // Base URL for links the dashboard emails (invites, §158). Blank = use the
    // derived guess.
    dashboardUrl: ['', [Validators.maxLength(255), Validators.pattern(/^$|^https?:\/\/[^\s/]+\/?$/)]],
    // Branch the Update page's self-update panel tracks. Blank = 'main'.
    updateBranch: ['', [Validators.maxLength(120), Validators.pattern(/^$|^[A-Za-z0-9._/-]+$/)]],
  });

  protected deployment: DeploymentStatus | null = null;
  protected deploymentLoading = true;
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
  protected claudeKey: ClaudeKeySettings | null = null;
  protected claudeKeyLoading = true;
  protected savingClaudeKey = false;
  protected testingClaudeKey = false;
  // Editable copy of the key; only sent on Save, and never populated from the
  // server (which only ever returns a mask).
  protected claudeKeyDraft = '';
  protected claudeKeyFeedback: { type: 'success' | 'danger' | 'info'; message: string } | null = null;
  protected alertSettings: AlertNotifySettings | null = null;
  protected alertsLoading = true;
  protected savingAlerts = false;
  protected alertsFeedback: { type: 'success' | 'danger' | 'info' | 'warning'; message: string } | null = null;
  // Editable copy of the ntfy topic; committed on "Save topic".
  protected alertTopicDraft = '';
  protected readonly alertTopicPattern = /^[A-Za-z0-9_-]{1,64}$/;
  protected testingAlertSource: string | null = null;

  // Per-category ntfy channels (§553): one optional topic override per
  // source, collapsed by default since a single shared topic is enough for
  // most installs. Empty in the draft means "no override — falls back to
  // the default topic above", indistinguishable from an override that
  // happens to equal the default (harmless: the two behave identically).
  protected readonly alertCategories: { key: AlertCategory }[] = [
    { key: 'crowdsec' },
    { key: 'critical-service' },
    { key: 'netbird' },
    { key: 'backup' },
  ];
  protected perCategoryOpen = false;
  protected categoryTopicDrafts: Record<AlertCategory, string> = this.emptyCategoryTopics();
  private categoryTopicSaved: Record<AlertCategory, string> = this.emptyCategoryTopics();

  ngOnInit(): void {
    this.loadDeployment();
    this.loadGeneralSettings();
    this.loadMailSettings();
    this.loadAlertSettings();
    this.loadClaudeKey();
  }

  private loadDeployment(): void {
    this.deploymentLoading = true;
    this.settingsService
      .loadDeploymentStatus()
      .pipe(finalize(() => (this.deploymentLoading = false)))
      .subscribe({
        next: (status) => (this.deployment = status),
        // Non-fatal: the rest of the page is still usable without the checklist.
        error: () => (this.deployment = null),
      });
  }

  private loadClaudeKey(): void {
    this.claudeKeyLoading = true;
    this.settingsService
      .loadClaudeKey()
      .pipe(finalize(() => (this.claudeKeyLoading = false)))
      .subscribe({
        next: (settings) => (this.claudeKey = settings),
        error: (error) =>
          (this.claudeKeyFeedback = {
            type: 'danger',
            message: extractErrorMessage(error, this.translate.t('settings.errors.loadClaudeKey')),
          }),
      });
  }

  saveClaudeKey(): void {
    const key = this.claudeKeyDraft.trim();
    if (!key) {
      this.claudeKeyFeedback = { type: 'info', message: this.translate.t('settings.validation.enterKeyToSave') };
      return;
    }
    this.savingClaudeKey = true;
    this.settingsService
      .saveClaudeKey(key)
      .pipe(finalize(() => (this.savingClaudeKey = false)))
      .subscribe({
        next: (settings) => {
          this.claudeKey = settings;
          this.claudeKeyDraft = '';
          this.claudeKeyFeedback = { type: 'success', message: settings.message ?? this.translate.t('settings.toast.claudeKeySaved') };
          this.toastService.success(this.translate.t('settings.toast.claudeKeySaved'));
        },
        error: (error) =>
          (this.claudeKeyFeedback = {
            type: 'danger',
            message: extractErrorMessage(error, this.translate.t('settings.errors.saveClaudeKey')),
          }),
      });
  }

  testClaudeKey(): void {
    const key = this.claudeKeyDraft.trim();
    if (!key && !this.claudeKey?.configured) {
      this.claudeKeyFeedback = { type: 'info', message: this.translate.t('settings.validation.saveKeyFirstOrEnter') };
      return;
    }
    this.testingClaudeKey = true;
    this.settingsService
      .testClaudeKey(key || undefined)
      .pipe(finalize(() => (this.testingClaudeKey = false)))
      .subscribe({
        next: (result) =>
          (this.claudeKeyFeedback = { type: result.success ? 'success' : 'danger', message: result.message }),
        error: (error) =>
          (this.claudeKeyFeedback = {
            type: 'danger',
            message: extractErrorMessage(error, this.translate.t('settings.errors.testClaudeKey')),
          }),
      });
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
          this.categoryTopicSaved = this.normalizeCategoryTopics(settings);
          this.categoryTopicDrafts = { ...this.categoryTopicSaved };
        },
        error: (error) => {
          this.alertsFeedback = {
            type: 'danger',
            message: extractErrorMessage(error, this.translate.t('settings.errors.loadAlerts')),
          };
        },
      });
  }

  private emptyCategoryTopics(): Record<AlertCategory, string> {
    return { crowdsec: '', 'critical-service': '', netbird: '', backup: '' };
  }

  /** A category's resolved topic that equals the default reads as "no override" (blank). */
  private normalizeCategoryTopics(settings: AlertNotifySettings): Record<AlertCategory, string> {
    return Object.fromEntries(
      this.alertCategories.map(({ key }) => [key, settings.topics[key] === settings.topic ? '' : settings.topics[key]])
    ) as Record<AlertCategory, string>;
  }

  protected categoryTopicValid(key: AlertCategory): boolean {
    const value = this.categoryTopicDrafts[key].trim();
    return value === '' || this.alertTopicPattern.test(value);
  }

  protected get categoryTopicsDirty(): boolean {
    return this.alertCategories.some(({ key }) => this.categoryTopicDrafts[key].trim() !== this.categoryTopicSaved[key]);
  }

  protected get categoryTopicsAllValid(): boolean {
    return this.alertCategories.every(({ key }) => this.categoryTopicValid(key));
  }

  saveCategoryTopics(): void {
    if (!this.categoryTopicsAllValid) {
      return;
    }
    const topics: Partial<Record<AlertCategory, string>> = {};
    for (const { key } of this.alertCategories) {
      const draft = this.categoryTopicDrafts[key].trim();
      if (draft !== this.categoryTopicSaved[key]) {
        topics[key] = draft;
      }
    }
    if (!Object.keys(topics).length) {
      return;
    }
    this.saveAlertSettings({ topics });
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
            message: extractErrorMessage(error, this.translate.t('settings.errors.testFailed')),
          };
        },
      });
  }

  private saveAlertSettings(input: {
    topic?: string;
    crowdsecEnabled?: boolean;
    enforceNpm?: boolean;
    topics?: Partial<Record<AlertCategory, string>>;
  }): void {
    this.savingAlerts = true;
    this.alertsFeedback = null;
    this.settingsService
      .saveAlertSettings(input)
      .pipe(finalize(() => (this.savingAlerts = false)))
      .subscribe({
        next: (response) => {
          this.alertSettings = {
            topic: response.topic,
            topics: response.topics,
            crowdsecEnabled: response.crowdsecEnabled,
            enforceNpm: response.enforceNpm,
          };
          this.alertTopicDraft = response.topic;
          this.categoryTopicSaved = this.normalizeCategoryTopics(response);
          this.categoryTopicDrafts = { ...this.categoryTopicSaved };
          // Saved either way; `applied: false` means a restart that makes it
          // take effect failed, which is worth more than a green tick (§532).
          this.alertsFeedback = { type: response.applied === false ? 'warning' : 'success', message: response.message };
        },
        error: (error) => {
          this.alertsFeedback = {
            type: 'danger',
            message: extractErrorMessage(error, this.translate.t('settings.errors.saveAlerts')),
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
          this.generalForm.controls.dashboardUrl.setValue(settings.dashboardUrl ?? '');
          this.generalForm.controls.updateBranch.setValue(settings.updateBranch ?? '');
        },
        error: (error) => {
          this.generalFeedback = { type: 'danger', message: extractErrorMessage(error, this.translate.t('settings.errors.loadGeneral')) };
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
      .saveGeneralSettings(
        this.generalForm.controls.timezone.value,
        this.generalForm.controls.dashboardUrl.value.trim(),
        this.generalForm.controls.updateBranch.value.trim()
      )
      .pipe(finalize(() => (this.savingGeneral = false)))
      .subscribe({
        next: (response) => {
          this.generalFeedback = { type: 'success', message: response.message };
          this.toastService.success(this.translate.t('settings.toast.settingsSaved'));
          this.loadGeneralSettings();
        },
        error: (error) => {
          this.generalFeedback = { type: 'danger', message: extractErrorMessage(error, this.translate.t('settings.errors.saveTimezone')) };
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
        error: () => (this.mailFeedback = { type: 'danger', message: this.translate.t('settings.errors.loadMail') }),
      });
  }

  saveMail(): void {
    if (this.mailForm.invalid) {
      this.mailForm.markAllAsTouched();
      this.mailFeedback = { type: 'info', message: this.translate.t('settings.validation.fillSendingFields') };
      return;
    }

    const value = this.mailForm.getRawValue();
    // A username with no password and none stored would save a login that
    // cannot work — catch it here rather than at the first failed send.
    if (value.smtpUser && !value.smtpPassword && !this.mailSettings?.smtpPasswordConfigured) {
      this.mailForm.controls.smtpPassword.setErrors({ required: true });
      this.mailForm.controls.smtpPassword.markAsTouched();
      this.mailFeedback = { type: 'info', message: this.translate.t('settings.validation.enterMailboxPassword') };
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
        error: (error) => (this.mailFeedback = { type: 'danger', message: extractErrorMessage(error, this.translate.t('settings.errors.saveMail')) }),
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
          this.mailFeedback = { type: 'danger', message: extractErrorMessage(error, this.translate.t('settings.errors.mailTestFailed')) };
        },
      });
  }
}
