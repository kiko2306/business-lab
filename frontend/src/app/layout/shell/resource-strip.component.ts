import { NgFor, NgIf } from '@angular/common';
import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap, timer } from 'rxjs';
import { DiskUsage, HealthStatus } from '../../core/models';
import { OperationsService } from '../../core/operations.service';

interface Meter {
  key: 'cpu' | 'memory' | 'disk';
  icon: string;
  /** The headline number, e.g. "13%" or "8.7 GiB". */
  primary: string;
  /** What the headline number is, e.g. "CPU" or "Free". */
  label: string;
  title: string;
  /** 0–100 utilisation — drives the bar fill and the warn/crit colour, even
   *  when `primary` shows free space rather than percent used. */
  percent: number;
  /** amber at/above this. */
  warn: number;
  /** red at/above this. */
  crit: number;
}

/** Binary GiB, one decimal — matches gethomepage's own memory widget. */
function formatGiB(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

/** Decimal GB, whole number — matches gethomepage's own disk widget. */
function formatGB(bytes: number): string {
  return `${Math.round(bytes / 1000 ** 3)} GB`;
}

/** The fullest filesystem — the one worth surfacing if only one can be shown. */
function worstDisk(disks: DiskUsage[]): DiskUsage | null {
  return disks.reduce<DiskUsage | null>(
    (worst, disk) => (worst === null || disk.percentUsed > worst.percentUsed ? disk : worst),
    null
  );
}

/**
 * A compact CPU / memory / disk read-out in the shell header — visually and
 * functionally matched to gethomepage's own `resources` widget on the Home
 * Page (§147.2, §455): an icon, the headline number gethomepage itself would
 * show (percent for CPU, free space for memory/disk), and a utilisation bar
 * underneath. `/utils` keeps the detailed Health panel; this is the
 * always-visible summary. Best-effort: a failed poll just leaves the last
 * numbers up, and nothing renders until the first success.
 */
@Component({
  selector: 'app-resource-strip',
  standalone: true,
  imports: [NgFor, NgIf],
  templateUrl: './resource-strip.component.html',
  styleUrl: './resource-strip.component.css',
})
export class ResourceStripComponent implements OnInit {
  private readonly operations = inject(OperationsService);
  private readonly destroyRef = inject(DestroyRef);

  protected meters: Meter[] | null = null;

  ngOnInit(): void {
    // Poll on mount then every 5s — matching gethomepage's own widget cadence
    // (§455: 30s read as stale next to it). Cheap either way: the backend's
    // CPU read is a running tick-counter diff, and `df` is fast.
    timer(0, 5_000)
      .pipe(
        switchMap(() => this.operations.getHealth()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (health) => (this.meters = this.toMeters(health)),
        // Keep whatever is on screen; a transient failure shouldn't blank it.
        error: () => undefined,
      });
  }

  private toMeters(health: HealthStatus): Meter[] {
    const disk = worstDisk(health.disks);
    const diskPercent = Math.round(disk?.percentUsed ?? 0);
    const cpuPercent = Math.round(health.cpu.percentUsed);
    const memoryPercent = Math.round(health.memory.percentUsed);
    const memoryFreeBytes = health.memory.totalBytes - health.memory.usedBytes;

    return [
      {
        key: 'cpu',
        icon: '🖥️',
        primary: `${cpuPercent}%`,
        label: 'CPU',
        title: `CPU ${cpuPercent}%`,
        percent: cpuPercent,
        warn: 75,
        crit: 90,
      },
      {
        key: 'memory',
        icon: '🧠',
        primary: formatGiB(memoryFreeBytes),
        label: 'Free',
        title: `Memory ${memoryPercent}% used, ${formatGiB(memoryFreeBytes)} free`,
        percent: memoryPercent,
        warn: Math.max(0, health.thresholds.memoryPercent - 15),
        crit: health.thresholds.memoryPercent,
      },
      {
        key: 'disk',
        icon: '💽',
        primary: disk ? formatGB(disk.availableBytes) : '—',
        label: 'Free',
        title: disk ? `Disk ${diskPercent}% used, ${formatGB(disk.availableBytes)} free` : 'Disk usage unavailable',
        percent: diskPercent,
        warn: Math.max(0, health.thresholds.diskPercent - 15),
        crit: health.thresholds.diskPercent,
      },
    ];
  }

  protected level(meter: Meter): 'ok' | 'warn' | 'crit' {
    if (meter.percent >= meter.crit) {
      return 'crit';
    }
    return meter.percent >= meter.warn ? 'warn' : 'ok';
  }
}
