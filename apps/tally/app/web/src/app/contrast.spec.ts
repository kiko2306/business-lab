import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ShopComponent } from './shop/shop.component';
import { ApiService } from './api.service';
import { Overview } from './models';

/**
 * Contrast measured in the browser that renders it, rather than asserted from
 * the stylesheet. The critique found `.text-secondary` resolving to #6c757d in
 * *both* colour modes — Bootstrap 5.3 reads it from `--bs-secondary-rgb`, which
 * the theme never overrides — giving 2.84:1 on the dark card across ~35
 * occurrences, every stat-card label among them (plan.md §806).
 */
function luminance(colour: string): number {
  const [r, g, b] = colour.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(foreground: string, background: string): number {
  const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

/** The painted background behind an element — walks up past transparent ones. */
function backgroundOf(element: Element): string {
  let node: Element | null = element;
  while (node) {
    const colour = getComputedStyle(node).backgroundColor;
    if (colour && !/rgba\(0, 0, 0, 0\)|transparent/.test(colour)) return colour;
    node = node.parentElement;
  }
  return getComputedStyle(document.body).backgroundColor || 'rgb(255, 255, 255)';
}

const overview = (): Overview =>
  ({
    asOf: '2026-10-03T14:30:00Z',
    businessDate: '2026-10-03',
    totals: { invoiced: 1200, open: 150 },
    tables: { free: 8, occupied: 3, awaitingPayment: 1 },
    clients: { present: 11 },
    staff: [{ code: '1', name: 'Ana', total: 900 }],
    payments: [{ method: 'Multibanco', total: 900 }],
    hourly: [{ hour: 9, total: 1200 }],
    stats: { transactions: 40, discounts: 12, consumptions: 30, customers: 37 },
  }) as Overview;

describe('shop day view contrast', () => {
  let fixture: ComponentFixture<ShopComponent>;

  const render = async (theme: 'light' | 'dark') => {
    document.documentElement.setAttribute('data-bs-theme', theme);
    const api = jasmine.createSpyObj('ApiService', ['listStores', 'me', 'agentPackage', 'overview', 'tables', 'soldItems']);
    api.listStores.and.returnValue(of([]));
    api.agentPackage.and.returnValue(of(null) as never);
    api.me.and.returnValue(of({ user: 'owner', isAdmin: true }) as never);
    api.overview.and.returnValue(of(overview()) as never);
    api.tables.and.returnValue(of({ free: 8, tables: [] }) as never);
    api.soldItems.and.returnValue(of({ items: [], totalQuantity: 0, totalValue: 0 }) as never);

    await TestBed.configureTestingModule({
      imports: [ShopComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'abc']]) } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ShopComponent);
    document.body.appendChild(fixture.nativeElement); // computed styles need a painted tree
    fixture.detectChanges();
  };

  afterEach(() => {
    fixture?.nativeElement.remove();
    document.documentElement.removeAttribute('data-bs-theme');
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`keeps every label readable in ${theme} mode`, async () => {
      await render(theme);
      const failures: string[] = [];
      for (const element of Array.from(fixture.nativeElement.querySelectorAll('p, span, td, th, a, button, h1, h2, h3'))) {
        const node = element as HTMLElement;
        const text = Array.from(node.childNodes)
          .filter((c) => c.nodeType === Node.TEXT_NODE)
          .map((c) => c.textContent?.trim())
          .join('');
        if (!text) continue;
        const styles = getComputedStyle(node);
        if (styles.visibility === 'hidden' || styles.display === 'none') continue;
        const measured = ratio(styles.color, backgroundOf(node));
        // 4.5:1 is the AA floor for body text; these are all under 24px.
        if (measured < 4.5) failures.push(`${text.slice(0, 24)} — ${measured.toFixed(2)}:1`);
      }
      expect(failures).toEqual([]);
    });
  }
});
