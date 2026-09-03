import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SettingsPanelComponent } from '../../components/settings-panel/settings-panel.component';
import { PanelComponent } from '../../components/panel/panel.component';
import { OperationsService } from '../../core/operations.service';
import { ConfirmService } from '../../core/confirm.service';
import {
  BackupFile,
  BackupScheduleConfig,
  BackupStatusResponse,
  DiscoveredHost,
  DiskUsage,
  HealthStatus,
} from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { extractErrorMessage } from '../../core/api';

/**
 * What is left of the single-page dashboard after the Apps area moved onto its
 * own route (§131.1): the stack-wide sections — Settings, Backups, Health
 * checks, Utils. Each is slated to get its own route in a later slice, at which
 * point this component goes away.
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, SettingsPanelComponent, PanelComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit {
  private readonly operations = inject(OperationsService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  protected backups: BackupFile[] = [];
  protected health: HealthStatus | null = null;
  protected schedule: BackupScheduleConfig = {
    enabled: false,
    frequency: 'daily',
    retentionCount: 14,
    lastRunAt: null,
    lastOutcome: null,
    lastSuccessAt: null,
    consecutiveFailures: 0,
  };
  protected savingSchedule = false;
  protected runningAppDataBackup = false;
  protected backupStatus: BackupStatusResponse | null = null;
  protected discoveredHosts: DiscoveredHost[] | null = null;
  protected scanningNetwork = false;

  ngOnInit(): void {
    this.loadBackups();
    this.loadHealth();
    this.loadSchedule();
    this.loadBackupStatus();
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
    void this.confirm
      .ask({
        title: 'Restore backup',
        message: `Restore backup "${fileName}"?\nThis overwrites the current state.`,
        confirmText: 'Restore',
        danger: true,
      })
      .then((confirmed) => {
        if (!confirmed) {
          return;
        }
        this.operations.restoreBackup(fileName).subscribe({
          next: (response) => this.toast.success(response.message),
          error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to restore backup.')),
        });
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

  loadBackupStatus(): void {
    // Best-effort: this panel is extra detail, not the reason the page exists.
    // A Duplicati that is down or unprovisioned is a state the card renders,
    // not a toast.
    this.operations.getBackupStatus().subscribe({
      next: (response) => {
        this.backupStatus = response;
      },
      error: () => {
        this.backupStatus = null;
      },
    });
  }

  runAppDataBackup(): void {
    // Dumps every app database then triggers Duplicati — the same path the
    // scheduler takes, so a manual run is never a generation stale (§74.6).
    // The dump is synchronous, so this request runs ~20s.
    this.runningAppDataBackup = true;
    this.operations.runAppDataBackup().subscribe({
      next: (response) => {
        this.runningAppDataBackup = false;
        this.toast.success(response.message);
        this.loadBackupStatus();
      },
      error: (error) => {
        this.runningAppDataBackup = false;
        this.toast.error(extractErrorMessage(error, 'Unable to run the app data backup.'));
        // Even a run that "did not start" dumped databases and wrote an audit
        // row — refresh the card so any dump failures show.
        this.loadBackupStatus();
      },
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
        this.loadBackupStatus();
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

  // Not run on init like loadHealth() — a LAN sweep takes ~10s and sends
  // traffic to every device on the network, so it only runs when asked for.
  scanNetwork(): void {
    this.scanningNetwork = true;
    this.operations.scanNetwork().subscribe({
      next: (response) => {
        this.discoveredHosts = response.hosts;
        this.scanningNetwork = false;
      },
      error: (error) => {
        this.toast.error(extractErrorMessage(error, 'Unable to scan the network.'));
        this.scanningNetwork = false;
      },
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

  /** "docker" -> "Docker storage", for the disk rows and their alerts. */
  protected diskLabel(name: string): string {
    return name === 'docker' ? 'Docker storage' : 'System root';
  }

  protected metricLabel(metric: string): string {
    if (metric.startsWith('disk:')) {
      return `${this.diskLabel(metric.slice('disk:'.length))} usage`;
    }
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

  /** True while both rows are the same filesystem — before a data-root move. */
  protected isAlertingDisk(health: HealthStatus, disk: DiskUsage): boolean {
    return health.alerts.some((alert) => alert.metric === 'disk' || alert.metric === `disk:${disk.name}`);
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
