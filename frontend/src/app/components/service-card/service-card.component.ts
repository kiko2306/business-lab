import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { extractErrorMessage } from '../../core/api';
import { ServiceEnvStatus, ServiceExposureConfig, ServiceStatus } from '../../core/models';
import { OperationsService } from '../../core/operations.service';
import { ToastService } from '../../core/toast.service';

@Component({
  selector: 'app-service-card',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './service-card.component.html',
  styleUrl: './service-card.component.css'
})
export class ServiceCardComponent {
  private readonly operations = inject(OperationsService);
  private readonly toast = inject(ToastService);

  @Input({ required: true }) service!: ServiceStatus;
  @Input() loadingAction: 'start' | 'stop' | null = null;

  @Output() actionRequested = new EventEmitter<'start' | 'stop'>();

  protected exposurePanelOpen = false;
  protected exposureLoading = false;
  protected exposureSaving = false;
  protected exposureVerifying = false;
  protected exposure: ServiceExposureConfig | null = null;

  protected exposureEnabled = false;

  protected envPanelOpen = false;
  protected envLoading = false;
  protected envSaving = false;
  protected env: ServiceEnvStatus | null = null;
  protected envValues: Record<string, string> = {};

  requestAction(action: 'start' | 'stop'): void {
    this.actionRequested.emit(action);
  }

  toggleExposurePanel(): void {
    this.exposurePanelOpen = !this.exposurePanelOpen;
    if (this.exposurePanelOpen && !this.exposure) {
      this.loadExposure();
    }
  }

  loadExposure(): void {
    this.exposureLoading = true;
    this.operations
      .getServiceExposure(this.service.name)
      .pipe(finalize(() => (this.exposureLoading = false)))
      .subscribe({
        next: (config) => {
          this.exposure = config;
          this.exposureEnabled = config.enabled;
        },
        error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to load exposure configuration.')),
      });
  }

  saveExposure(): void {
    this.exposureSaving = true;
    this.operations
      .updateServiceExposure(this.service.name, {
        enabled: this.exposureEnabled,
      })
      .pipe(finalize(() => (this.exposureSaving = false)))
      .subscribe({
        next: (response) => {
          this.toast.success(response.message);
          this.loadExposure();
        },
        error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to save exposure configuration.')),
      });
  }

  verifyExposure(): void {
    this.exposureVerifying = true;
    this.operations
      .verifyServiceExposure(this.service.name)
      .pipe(finalize(() => (this.exposureVerifying = false)))
      .subscribe({
        next: (result) => {
          if (result.success) {
            this.toast.success(`Exposure verified — reconciled with the live NPM/Cloudflare state.`);
          } else if (result.warning) {
            this.toast.error(result.warning);
          }
          this.loadExposure();
        },
        error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to verify exposure configuration.')),
      });
  }

  toggleEnvPanel(): void {
    this.envPanelOpen = !this.envPanelOpen;
    if (this.envPanelOpen && !this.env) {
      this.loadEnv();
    }
  }

  loadEnv(): void {
    this.envLoading = true;
    this.operations
      .getServiceEnv(this.service.name)
      .pipe(finalize(() => (this.envLoading = false)))
      .subscribe({
        next: (env) => {
          this.env = env;
          this.envValues = {};
          for (const field of env.fields) {
            if (!field.secret) {
              this.envValues[field.key] = field.value ?? '';
            }
          }
        },
        error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to load configuration.')),
      });
  }

  missingRequiredCount(): number {
    return this.env?.fields.filter((field) => field.required && !field.isSet).length ?? 0;
  }

  saveEnv(): void {
    this.envSaving = true;
    this.operations
      .updateServiceEnv(this.service.name, this.envValues)
      .pipe(finalize(() => (this.envSaving = false)))
      .subscribe({
        next: (response) => {
          this.toast.success(response.message);
          this.loadEnv();
        },
        error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to save configuration.')),
      });
  }

  serviceIcon(icon: string): string {
    const icons: Record<string, string> = {
      nginx: '🌐',
      vpn: '🔐',
      home: '🏠',
      cloud: '☁️',
      code: '💻',
      book: '📚',
      folder: '🗂️',
      dashboard: '🧭',
      workflow: '🔁',
      document: '📄',
      shield: '🛡️',
      speed: '⚡',
      lock: '🔒',
      pulse: '📈',
      key: '🔑',
      backup: '💾',
      photo: '📷',
      media: '🎬',
      tasks: '✅',
      update: '🔄',
    };

    return icons[icon] ?? '🖥️';
  }

  stateBadge(state: ServiceStatus['state']): string {
    switch (state) {
      case 'running':
        return 'success';
      case 'starting':
        return 'warning';
      case 'error':
        return 'danger';
      case 'stopped':
        return 'secondary';
      default:
        return 'dark';
    }
  }

  healthLabel(): string {
    if (this.service.state !== 'running') {
      return 'inactive';
    }

    return this.service.healthy ? 'healthy' : 'check failed';
  }

  healthClass(): string {
    return this.service.healthy ? 'text-success border-success-subtle' : 'text-secondary';
  }
}
