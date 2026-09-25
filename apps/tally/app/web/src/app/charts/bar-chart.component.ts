import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { numberLocale, t } from '../i18n';

export interface BarDatum {
  label: string;
  value: number;
}

/**
 * A horizontal bar chart for one measure across categories — staff takings,
 * payment methods, top items.
 *
 * Inline SVG rather than a charting library: bars are rectangles, and a
 * dependency for that would be larger than the component. Horizontal, not
 * vertical, because the categories are names of arbitrary length and vertical
 * columns would either clip them or turn them on their side.
 *
 * One series, so one colour and no legend — the heading names it. Colour is
 * not carrying identity here; the labels are. Both steps are validated against
 * this app's light and dark surfaces (plan.md §635).
 */
@Component({
  selector: 'app-bar-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (!data.length) {
      <p class="text-secondary small mb-0">{{ emptyText }}</p>
    } @else {
      <div class="bar-chart">
        @for (d of data; track d.label) {
          <div class="bar-row">
            <span class="bar-label text-body-secondary" [title]="d.label">{{ d.label }}</span>
            <span class="bar-track">
              <span
                class="bar-fill"
                [style.width.%]="percent(d.value)"
                [attr.title]="d.label + ': ' + format(d.value)"
                role="img"
                [attr.aria-label]="d.label + ': ' + format(d.value)"></span>
            </span>
            <span class="bar-value text-body num">{{ format(d.value) }}</span>
          </div>
        }
      </div>
    }
  `,
  styleUrl: './bar-chart.component.css',
})
export class BarChartComponent {
  @Input() data: BarDatum[] = [];
  @Input() emptyText = t('Nothing to show yet.');
  /** Rendered as money unless told otherwise — most of these are totals. */
  @Input() unit: 'currency' | 'count' = 'currency';

  /**
   * Scaled to the largest bar, not to a round number: this is a comparison
   * between categories, and a zero-based scale to the max is what keeps the
   * lengths honest.
   */
  percent(value: number): number {
    const max = Math.max(...this.data.map((d) => d.value), 0);
    if (max <= 0) return 0;
    // A floor so a tiny non-zero value is still visibly a bar rather than
    // nothing at all.
    return Math.max((value / max) * 100, value > 0 ? 1.5 : 0);
  }

  format(value: number): string {
    return this.unit === 'currency'
      ? new Intl.NumberFormat(numberLocale, { style: 'currency', currency: 'EUR' }).format(value)
      : new Intl.NumberFormat(numberLocale).format(value);
  }
}
