import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PanelComponent } from '../../components/panel/panel.component';
import { OperationsService } from '../../core/operations.service';
import { DiscoveredHost, DiskUsage, HealthStatus } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { extractErrorMessage } from '../../core/api';

/**
 * What is left of the single-page dashboard after the Apps (§136), Backups
 * (§140), Exposure (§143) and Settings (§144) areas moved onto their own
 * routes: Health checks and Utils. Both are slated to get their own route in a
 * later slice, at which point this component goes away.
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, PanelComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit {
  private readonly operations = inject(OperationsService);
  private readonly toast = inject(ToastService);

  protected health: HealthStatus | null = null;
  protected discoveredHosts: DiscoveredHost[] | null = null;
  protected scanningNetwork = false;

  ngOnInit(): void {
    this.loadHealth();
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
