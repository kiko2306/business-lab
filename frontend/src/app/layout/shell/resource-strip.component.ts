import { NgFor, NgIf } from '@angular/common';
import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap, timer } from 'rxjs';
import { HealthStatus } from '../../core/models';
import { OperationsService } from '../../core/operations.service';

interface Meter {
  key: 'cpu' | 'memory' | 'disk';
  label: string;
  /** 0–100. */
  value: number;
  /** amber at/above this. */
  warn: number;
  /** red at/above this. */
  crit: number;
}

/**
 * A compact CPU / memory / disk read-out in the shell header — the same
 * glanceable "how loaded is the box" that gethomepage's resources widget gives
 * on the Home Page (§147.2). `/utils` keeps the detailed Health panel; this is
 * the always-visible summary. Best-effort: a failed poll just leaves the last
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
    // Poll on mount then every 30s; the backend returns the CPU average over
    // whatever gap elapsed, so a slower cadence is cheaper and still accurate.
    timer(0, 30_000)
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
    const worstDisk = health.disks.reduce((max, disk) => Math.max(max, disk.percentUsed), 0);
    return [
      { key: 'cpu', label: 'CPU', value: Math.round(health.cpu.percentUsed), warn: 75, crit: 90 },
      {
        key: 'memory',
        label: 'RAM',
        value: Math.round(health.memory.percentUsed),
        warn: Math.max(0, health.thresholds.memoryPercent - 15),
        crit: health.thresholds.memoryPercent,
      },
      {
        key: 'disk',
        label: 'DISK',
        value: Math.round(worstDisk),
        warn: Math.max(0, health.thresholds.diskPercent - 15),
        crit: health.thresholds.diskPercent,
      },
    ];
  }

  protected level(meter: Meter): 'ok' | 'warn' | 'crit' {
    if (meter.value >= meter.crit) {
      return 'crit';
    }
    return meter.value >= meter.warn ? 'warn' : 'ok';
  }
}
