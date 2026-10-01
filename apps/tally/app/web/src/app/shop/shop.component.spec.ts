import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ShopComponent } from './shop.component';
import { ApiService } from '../api.service';
import { Overview } from '../models';

const overview = (extra: Partial<Overview> = {}): Overview =>
  ({
    asOf: '2026-10-03T14:30:00Z',
    businessDate: '2026-10-03',
    totals: { invoiced: 1200, open: 150 },
    tables: { free: 8, occupied: 3, awaitingPayment: 1 },
    clients: { present: 11 },
    staff: [],
    payments: [],
    hourly: [
      { hour: 9, total: 400 },
      { hour: 10, total: 800 },
    ],
    stats: { transactions: 40, discounts: 12, consumptions: 30, customers: 37 },
    ...extra,
  }) as Overview;

describe('ShopComponent', () => {
  let fixture: ComponentFixture<ShopComponent>;
  let element: HTMLElement;
  let api: jasmine.SpyObj<ApiService>;

  // Last week, by the same hour: 300 + 500 = 800 against today's 1200.
  const lastWeekDefault = overview({
    totals: { invoiced: 800, open: 0 },
    hourly: [
      { hour: 9, total: 300 },
      { hour: 10, total: 500 },
    ],
  });

  const build = async (today: Overview, lastWeek: Overview | 'fail' = lastWeekDefault) => {
    api = jasmine.createSpyObj('ApiService', ['listStores', 'agentPackage', 'overview', 'tables', 'soldItems']);
    api.listStores.and.returnValue(of([]));
    api.agentPackage.and.returnValue(of(null) as never);
    api.tables.and.returnValue(of({ tables: [] }) as never);
    api.soldItems.and.returnValue(of({ items: [] }) as never);
    api.overview.and.callFake((_id: string, date?: string) => {
      if (!date) return of(today) as never;
      return (lastWeek === 'fail' ? throwError(() => new Error('offline')) : of(lastWeek)) as never;
    });

    await TestBed.configureTestingModule({
      imports: [ShopComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'abc']]) } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ShopComponent);
    element = fixture.nativeElement;
    fixture.detectChanges();
  };

  // The page used to open with eleven identically-weighted tiles, so the
  // figure the owner came for was one cell in a grid (plan.md §806).
  it('gives the day’s takings a hero of its own', async () => {
    await build(overview());
    const hero = element.querySelector('.hero .hero-value') as HTMLElement;
    expect(hero).not.toBeNull();
    expect(hero.textContent).toContain('1,200');
  });

  it('says how the day compares, in words', async () => {
    await build(overview());
    const compare = element.querySelector('.hero-compare') as HTMLElement;
    expect(compare.textContent).toContain('more than last Saturday');
    expect(compare.classList).toContain('up');
  });

  // The trap the comparison exists to avoid: a running day's takings so far,
  // held against last week's whole day, reads as a collapse at 10am.
  it('compares a running day only as far as the hour it has reached', async () => {
    await build(
      overview(),
      overview({
        totals: { invoiced: 3000, open: 0 },
        hourly: [
          { hour: 9, total: 500 },
          { hour: 10, total: 500 },
          { hour: 19, total: 2000 },
        ],
      })
    );
    // 1200 today against 1000 by the same hour last week — not against 3000.
    expect((element.querySelector('.hero-compare') as HTMLElement).textContent).toContain('more than');
  });

  it('says there is nothing to compare rather than inventing a number', async () => {
    await build(overview(), 'fail');
    const compare = element.querySelector('.hero-compare') as HTMLElement;
    expect(compare.textContent).toContain('No figures for last Saturday');
    expect(compare.classList).not.toContain('up');
    expect(compare.classList).not.toContain('down');
  });

  it('folds the six Wintouch counters away, and opens them in one tap', async () => {
    await build(overview());
    const toggle = element.querySelector('.counters-toggle') as HTMLButtonElement;
    const panel = toggle.closest('h3')!.nextElementSibling as HTMLElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hidden).toBeTrue();

    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hidden).toBeFalse();
  });

  it('drops the running-moment row on a closed day', async () => {
    await build(overview({ archive: true }));
    expect(element.textContent).not.toContain('Open tabs');
    expect(element.querySelector('.hero-value')).not.toBeNull();
  });
});
