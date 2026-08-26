import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { extractErrorMessage } from '../../core/api';
import { ServiceExposureConfig, ServiceStatus } from '../../core/models';
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
  protected exposure: ServiceExposureConfig | null = null;

  protected exposureEnabled = false;
  protected exposureUpstreamHost = '';
  protected exposureUpstreamPort: number | null = null;
  protected exposureUpstreamScheme: 'http' | 'https' = 'http';
  protected exposureWebsocket = false;

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
          this.exposureUpstreamHost = config.upstreamHost ?? '';
          this.exposureUpstreamPort = config.upstreamPort;
          this.exposureUpstreamScheme = config.upstreamScheme;
          this.exposureWebsocket = config.websocket;
        },
        error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to load exposure configuration.')),
      });
  }

  saveExposure(): void {
    if (this.exposureEnabled && (!this.exposureUpstreamHost.trim() || !this.exposureUpstreamPort)) {
      this.toast.error('Upstream host and port are required to enable exposure.');
      return;
    }

    this.exposureSaving = true;
    this.operations
      .updateServiceExposure(this.service.name, {
        enabled: this.exposureEnabled,
        upstreamScheme: this.exposureUpstreamScheme,
        upstreamHost: this.exposureUpstreamHost.trim(),
        upstreamPort: this.exposureUpstreamPort ?? 0,
        websocket: this.exposureWebsocket,
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
