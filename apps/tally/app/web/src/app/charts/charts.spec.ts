import { TestBed } from '@angular/core/testing';
import { BarChartComponent } from './bar-chart.component';
import { HourlyChartComponent } from './hourly-chart.component';

function luminance(colour: string): number {
  const [r, g, b] = colour.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
  const c = (v: number) => ((v / 255) <= 0.03928 ? v / 255 / 12.92 : (((v / 255) + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('charts (plan.md §806.5)', () => {
  afterEach(() => document.documentElement.removeAttribute('data-bs-theme'));

  describe('bar chart', () => {
    it('is announced once per bar, not twice', () => {
      // Every bar rendered its value as text *and* as a role="img" label, so a
      // screen reader read each one twice.
      const fixture = TestBed.createComponent(BarChartComponent);
      fixture.componentInstance.data = [{ label: 'Ana', value: 900 }];
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[role="img"]')).toBeNull();
      expect(el.querySelector('.bar-track')!.getAttribute('aria-hidden')).toBe('true');
      expect(el.textContent).toContain('Ana');
    });

    for (const theme of ['light', 'dark']) {
      it(`keeps the bar distinguishable from its track in ${theme} mode (3:1 for graphics)`, () => {
        document.documentElement.setAttribute('data-bs-theme', theme);
        const fixture = TestBed.createComponent(BarChartComponent);
        fixture.componentInstance.data = [{ label: 'Ana', value: 900 }];
        document.body.appendChild(fixture.nativeElement);
        fixture.detectChanges();
        const fill = getComputedStyle(fixture.nativeElement.querySelector('.bar-fill')).backgroundColor;
        const track = getComputedStyle(fixture.nativeElement.querySelector('.bar-track')).backgroundColor;
        expect(ratio(fill, track)).toBeGreaterThanOrEqual(3);
        fixture.nativeElement.remove();
      });
    }
  });

  describe('hourly chart', () => {
    const data = [
      { hour: 9, total: 400 },
      { hour: 10, total: 800 },
    ];

    it('is one named graphic, not twenty-four anonymous images', () => {
      const fixture = TestBed.createComponent(HourlyChartComponent);
      fixture.componentInstance.data = data;
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelectorAll('[role="img"]').length).toBe(1);
      expect(el.querySelector('[role="img"]')!.getAttribute('aria-label')).toContain('10:00');
    });

    it('offers the exact figures as a table', () => {
      const fixture = TestBed.createComponent(HourlyChartComponent);
      fixture.componentInstance.data = data;
      fixture.detectChanges();
      const rows = fixture.nativeElement.querySelectorAll('table.visually-hidden tbody tr');
      expect(rows.length).toBe(2);
    });
  });
});
