import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ServiceStatus } from '../../core/models';

@Component({
  selector: 'app-service-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './service-card.component.html',
  styleUrl: './service-card.component.css'
})
export class ServiceCardComponent {
  @Input({ required: true }) service!: ServiceStatus;
  @Input() loadingAction: 'start' | 'stop' | null = null;

  @Output() actionRequested = new EventEmitter<'start' | 'stop'>();

  requestAction(action: 'start' | 'stop'): void {
    this.actionRequested.emit(action);
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
