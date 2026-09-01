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

// Fixed display order for both the running-apps table and the full apps
// list, so the same category shows up in the same place in both.
const CATEGORY_DISPLAY_ORDER: readonly string[] = [...CATEGORY_ORDER, 'Other'];

function orderCategories(present: Iterable<string>): string[] {
  const seen = new Set(present);
  return CATEGORY_DISPLAY_ORDER.filter((category) => seen.has(category));
}

interface ServiceGroup {
  category: string;
  services: ServiceStatus[];
}

interface ServicePortRow {
  serviceName: string;
  label: string;
  url: string | null;
  ports: ServiceStatus['ports'];
}

interface ServicePortGroup {
  category: string;
  rows: ServicePortRow[];
}

// One row per running app for the "running apps" table — all of an app's
// published ports are listed together instead of one row each. The URL is the
// app's public hostname when it's exposed (no port — Cloudflare/NPM strip that
// away), otherwise a LAN link to its web-UI port on whatever host is serving
// this dashboard; either gets the registry's `webPath` appended when the UI
// isn't at the bare root (e.g. Pi-hole's `/admin`, NPM's admin panel on :81).
// Rows are grouped by the same category as the full apps list so the two views
// line up.
function buildRunningAppUrl(service: ServiceStatus): string | null {
  const suffix = service.webPath ?? '';
  if (service.exposedHostname) {
    return `https://${service.exposedHostname}${suffix}`;
  }
  if (service.webPort) {
    return `http://${window.location.hostname}:${service.webPort}${suffix}`;
  }
  return null;
}

function groupRunningPortsByCategory(services: ServiceStatus[]): ServicePortGroup[] {
  const byCategory = new Map<string, ServicePortRow[]>();
  for (const service of services) {
    if (service.state !== 'running' || !service.ports?.length) {
      continue;
    }
    const category = service.category ?? 'Other';
    const url = buildRunningAppUrl(service);
    const row: ServicePortRow = { serviceName: service.name, label: service.label, url, ports: service.ports };
    const bucket = byCategory.get(category);
    if (bucket) {
      bucket.push(row);
    } else {
      byCategory.set(category, [row]);
    }
  }

  for (const rows of byCategory.values()) {
    rows.sort((a, b) => a.label.localeCompare(b.label));
  }

  return orderCategories(byCategory.keys()).map((category) => ({ category, rows: byCategory.get(category)! }));
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

  return orderCategories(byCategory.keys()).map((category) => ({ category, services: byCategory.get(category)! }));
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

  private static readonly COLLAPSE_STORAGE_KEY = 'dashboard.collapsedSections';

  protected readonly user$ = this.authService.user$;
  protected readonly groupServicesByCategory = groupServicesByCategory;
  protected readonly groupRunningPortsByCategory = groupRunningPortsByCategory;
  protected readonly collapsedSections = new Set<string>(this.loadCollapsedSections());
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

  trackByCategory(_index: number, group: { category: string }): string {
    return group.category;
  }

  trackByPortRow(_index: number, row: { serviceName: string }): string {
    return row.serviceName;
  }

  isCollapsed(key: string): boolean {
    return this.collapsedSections.has(key);
  }

  toggleSection(key: string): void {
    if (this.collapsedSections.has(key)) {
      this.collapsedSections.delete(key);
    } else {
      this.collapsedSections.add(key);
    }
    this.persistCollapsedSections();
  }

  private loadCollapsedSections(): string[] {
    try {
      const raw = localStorage.getItem(DashboardComponent.COLLAPSE_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
    } catch {
      return [];
    }
  }

  private persistCollapsedSections(): void {
    try {
      localStorage.setItem(
        DashboardComponent.COLLAPSE_STORAGE_KEY,
        JSON.stringify([...this.collapsedSections]),
      );
    } catch {
      // Non-fatal: collapse state just won't survive a reload.
    }
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
        // Saving a lower retention count deletes the extra archives server-side,
        // so the list has to be re-read or it keeps showing what is gone.
        this.loadBackups();
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

  /**
   * Sizes are reported in bytes; show them in the unit a person would use.
   * Binary units (KiB steps) because that is what `df` and `os.totalmem()`
   * measure — labelling those as GB would overstate every figure by 7%.
   */
  protected formatBytes(bytes: number): string {
    if (!bytes || bytes < 0) {
      return '—';
    }
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    // One decimal is enough to distinguish 1.2 TiB from 1.9 TiB, and noise
    // below GiB scale doesn't help anyone.
    return `${value >= 10 || unit <= 1 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
  }

  protected metricLabel(metric: string): string {
    switch (metric) {
      case 'disk':
        return 'Disk usage';
      case 'memory':
        return 'Memory usage';
      case 'load':
        return 'Load per CPU';
      default:
        return metric;
    }
  }

  /** Load is a ratio, disk and memory are percentages — format accordingly. */
  protected formatMetric(metric: string, value: number): string {
    return metric === 'load' ? value.toFixed(2) : `${Math.round(value)}%`;
  }

  /**
   * "degraded" on its own says nothing actionable. The API already reports
   * which metric tripped and against what threshold, so spell that out.
   */
  protected degradedReason(health: HealthStatus): string {
    if (!health.alerts.length) {
      return 'A monitored metric is above its threshold.';
    }
    const parts = health.alerts.map(
      (alert) =>
        `${this.metricLabel(alert.metric).toLowerCase()} is ${this.formatMetric(alert.metric, alert.value)}, ` +
        `over its ${this.formatMetric(alert.metric, alert.threshold)} threshold`
    );
    return `${parts.join('; ')}.`;
  }

  protected isAlerting(health: HealthStatus, metric: string): boolean {
    return health.alerts.some((alert) => alert.metric === metric);
  }
}
