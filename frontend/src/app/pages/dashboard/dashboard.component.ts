import { AsyncPipe, CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ServiceStateService } from '../../core/service-state.service';
import { ServiceCardComponent } from '../../components/service-card/service-card.component';
import { SettingsPanelComponent } from '../../components/settings-panel/settings-panel.component';
import { OperationsService } from '../../core/operations.service';
import { BackupFile, BackupScheduleConfig, HealthStatus, ServiceCategory, ServiceStatus } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { extractErrorMessage } from '../../core/api';

// Fixed display order; anything without a recognized category (or an older
// cached API response predating this field) falls back to "Other" at the end.
const CATEGORY_ORDER: ServiceCategory[] = [
  'Networking & Security',
  'Monitoring & Management',
  'Media',
  'Backup & Storage',
  'Productivity',
  'Home Automation',
  'Development',
];

interface ServiceGroup {
  category: string;
  services: ServiceStatus[];
}

function groupServicesByCategory(services: ServiceStatus[]): ServiceGroup[] {
  const byCategory = new Map<string, ServiceStatus[]>();
  for (const service of services) {
    const category = service.category ?? 'Other';
    const bucket = byCategory.get(category);
    if (bucket) {
      bucket.push(service);
    } else {
      byCategory.set(category, [service]);
    }
  }

  const orderedCategories = [...CATEGORY_ORDER, 'Other'].filter((category) => byCategory.has(category));
  return orderedCategories.map((category) => ({ category, services: byCategory.get(category)! }));
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, AsyncPipe, FormsModule, RouterLink, ServiceCardComponent, SettingsPanelComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly authService = inject(AuthService);
  protected readonly serviceState = inject(ServiceStateService);
  private readonly operations = inject(OperationsService);
  private readonly toast = inject(ToastService);

  protected readonly user$ = this.authService.user$;
  protected readonly groupServicesByCategory = groupServicesByCategory;
  protected backups: BackupFile[] = [];
  protected health: HealthStatus | null = null;
  protected schedule: BackupScheduleConfig = { enabled: false, frequency: 'daily', retentionCount: 14, lastRunAt: null };
  protected savingSchedule = false;

  ngOnInit(): void {
    this.serviceState.startPolling();
    this.loadBackups();
    this.loadHealth();
    this.loadSchedule();
  }

  ngOnDestroy(): void {
    this.serviceState.stopPolling();
  }

  logout(): void {
    this.authService.logout();
  }

  refresh(): void {
    this.serviceState.refresh();
  }

  handleAction(serviceName: string, action: 'start' | 'stop'): void {
    if (action === 'start') {
      this.serviceState.startService(serviceName);
      return;
    }

    this.serviceState.stopService(serviceName);
  }

  trackByService(_index: number, service: { name: string }): string {
    return service.name;
  }

  loadBackups(): void {
    this.operations.listBackups().subscribe({
      next: (response) => {
        this.backups = response.items;
      },
      error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to load backups.')),
    });
  }

  createBackup(): void {
    this.operations.createBackup().subscribe({
      next: (response) => {
        this.toast.success(response.message);
        this.loadBackups();
      },
      error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to create backup.')),
    });
  }

  restoreBackup(fileName: string): void {
    if (!confirm(`Restore backup "${fileName}"? This will overwrite current state.`)) {
      return;
    }
    this.operations.restoreBackup(fileName).subscribe({
      next: (response) => this.toast.success(response.message),
      error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to restore backup.')),
    });
  }

  downloadBackup(fileName: string): void {
    this.operations.downloadBackup(fileName).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to download backup.')),
    });
  }

  loadSchedule(): void {
    this.operations.getBackupSchedule().subscribe({
      next: (response) => {
        this.schedule = response;
      },
      error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to load backup schedule.')),
    });
  }

  saveSchedule(): void {
    this.savingSchedule = true;
    const { enabled, frequency, retentionCount } = this.schedule;
    this.operations.updateBackupSchedule({ enabled, frequency, retentionCount }).subscribe({
      next: (response) => {
        this.toast.success(response.message);
        this.savingSchedule = false;
        this.loadSchedule();
      },
      error: (error) => {
        this.toast.error(extractErrorMessage(error, 'Unable to update backup schedule.'));
        this.savingSchedule = false;
      },
    });
  }

  loadHealth(): void {
    this.operations.getHealth().subscribe({
      next: (response) => {
        this.health = response;
      },
      error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to load health checks.')),
    });
  }
}
