import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { extractErrorMessage } from '../../core/api';
import { CloudflareSettings } from '../../core/models';
import { SettingsService } from '../../core/settings.service';
import { ToastService } from '../../core/toast.service';

@Component({
  selector: 'app-settings-panel',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './settings-panel.component.html',
  styleUrl: './settings-panel.component.css'
})
export class SettingsPanelComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly settingsService = inject(SettingsService);
  private readonly toastService = inject(ToastService);

  protected readonly form = this.formBuilder.nonNullable.group({
    token: ['', [Validators.minLength(20)]],
  });

  protected configuredSettings: CloudflareSettings | null = null;
  protected showToken = false;
  protected loading = true;
  protected saving = false;
  protected testing = false;
  protected feedback: { type: 'success' | 'danger' | 'info'; message: string } | null = null;

  ngOnInit(): void {
    this.loadSettings();
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
