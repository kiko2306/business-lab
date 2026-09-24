import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

export interface HourlyDatum {
  hour: number;
  total: number;
}

/**
 * Takings by hour of the current trading day.
 *
 * The one genuine time series on this page, so the one place a chart beats a
 * figure: the shape is the information — where the lunch and dinner peaks are,
 * and whether the current hour is tracking with them. Columns rather than a
 * line because the hours are discrete buckets, not a continuous signal.
 *
 * Empty hours are rendered as gaps rather than dropped, or the spacing would
 * imply trade that did not happen.
 */
@Component({
  selector: 'app-hourly-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (!data.length) {
      <p class="text-secondary small mb-0">No takings yet today.</p>
    } @else {
      <div class="hourly">
        @for (d of data; track d.hour) {
          <div class="hourly-col" [attr.title]="label(d)" role="img" [attr.aria-label]="label(d)">
            <div class="hourly-track">
              <div class="hourly-fill" [style.height.%]="percent(d.total)"></div>
            </div>
            <!-- Every other hour, so labels never collide on a phone. -->
            <span class="hourly-hour text-body-secondary">
              {{ d.hour % 2 === 0 ? pad(d.hour) : '' }}
            </span>
          </div>
        }
      </div>
      <p class="small text-secondary mt-2 mb-0">
        Peak {{ format(peak) }} at {{ pad(peakHour) }}:00
      </p>
    }
  `,
  styleUrl: './hourly-chart.component.css',
})
export class HourlyChartComponent {
  @Input() data: HourlyDatum[] = [];

  get peak(): number {
    return Math.max(...this.data.map((d) => d.total), 0);
  }

  get peakHour(): number {
    return this.data.reduce((best, d) => (d.total > best.total ? d : best), this.data[0]).hour;
  }

  percent(total: number): number {
    const max = this.peak;
    if (max <= 0) return 0;
    return Math.max((total / max) * 100, total > 0 ? 2 : 0);
  }

  pad(hour: number): string {
    return hour.toString().padStart(2, '0');
  }

  format(total: number): string {
    return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(total);
  }

  label(d: HourlyDatum): string {
    return `${this.pad(d.hour)}:00 — ${this.format(d.total)}`;
  }
}
