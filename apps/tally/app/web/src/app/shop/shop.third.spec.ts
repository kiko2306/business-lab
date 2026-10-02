import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';
import { ShopComponent } from './shop.component';
import { ApiService } from '../api.service';
import { Clock } from '../clock';
import { Overview, Store } from '../models';

const overview = (extra: Partial<Overview> = {}): Overview =>
  ({
    asOf: '2026-10-03T14:30:00Z',
    businessDate: '2026-10-03',
    totals: { invoiced: 1300, open: 150 },
    tables: { free: 4, occupied: 6, awaitingPayment: 4 },
    clients: { present: 11 },
    staff: [{ code: '1', name: 'Ana', total: 900 }],
    payments: [{ method: 'MB', total: 900 }],
    hourly: [
      { hour: 9, total: 400 },
      { hour: 10, total: 800 },
      { hour: 14, total: 100 },
    ],
    stats: { transactions: 40, discounts: 12, consumptions: 30, customers: 37 },
    ...extra,
  }) as Overview;

const store = (extra: Partial<Store> = {}): Store => ({
  id: 'abc', name: 'Pastelaria Central', isActive: true, agentEnrolled: true, connected: true,
  lastSeenAt: new Date(2026, 9, 3, 8, 0).toISOString(), agentVersion: '1.4.0', ...extra,
});

/** §806.8: what the third critique found, each reproduced before it was fixed. */
describe('ShopComponent third pass (plan.md §806.8)', () => {
  let fixture: ComponentFixture<ShopComponent>;
  let element: HTMLElement;
  let api: jasmine.SpyObj<ApiService>;

  interface Options {
    today?: Observable<Overview> | Overview;
    reference?: Observable<Overview> | Overview;
    tables?: Observable<unknown>;
    stores?: Store[][];
    now?: Date;
    query?: Record<string, string>;
  }

  const build = async (o: Options = {}) => {
    const resolve = (v: Observable<Overview> | Overview | undefined, fallback: Overview) =>
      v === undefined ? of(fallback) : 'subscribe' in v ? v : of(v);
    api = jasmine.createSpyObj('ApiService', ['listStores', 'agentPackage', 'overview', 'tables', 'soldItems']);
    const lists = o.stores ?? [[store()]];
    let call = 0;
    api.listStores.and.callFake(() => of(lists[Math.min(call++, lists.length - 1)]) as never);
    api.agentPackage.and.returnValue(of(null) as never);
    api.overview.and.callFake(((_id: string, date?: string) =>
      date
        ? resolve(o.reference, overview({ totals: { invoiced: 800, open: 0 }, hourly: [{ hour: 9, total: 300 }, { hour: 10, total: 500 }, { hour: 14, total: 900 }] }))
        : resolve(o.today, overview())) as never);
    api.tables.and.returnValue((o.tables ?? of({ free: 4, tables: [] })) as never);
    api.soldItems.and.returnValue(of({ items: [], totalQuantity: 0, totalValue: 0 }) as never);
    await TestBed.configureTestingModule({
      imports: [ShopComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: Clock, useValue: { now: () => o.now ?? new Date(2026, 9, 3, 14, 30) } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'abc' }), queryParamMap: convertToParamMap(o.query ?? {}) } },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ShopComponent);
    element = fixture.nativeElement;
    fixture.detectChanges();
  };

  describe('last seen', () => {
    const offline = () => throwError(() => ({ status: 503, error: { offline: true } }));

    // `store` was loaded once at page open and never again, so the panel printed
    // the time the page opened, not the time the shop went dark.
    it('re-reads the shop when it goes offline, so the time is current', async () => {
      await build({
        today: offline(),
        stores: [[store({ lastSeenAt: new Date(2026, 9, 3, 8, 0).toISOString() })], [store({ lastSeenAt: new Date(2026, 9, 3, 11, 40).toISOString() })]],
      });
      fixture.detectChanges();
      expect(element.querySelector('.alert-warning')!.textContent).toContain('11:40');
    });

    it('says which day when it was not today', async () => {
      await build({ today: offline(), stores: [[store({ lastSeenAt: new Date(2026, 9, 2, 22, 10).toISOString() })]] });
      expect(element.querySelector('.alert-warning')!.textContent).toContain('02/10');
    });
  });

  describe('the hero names the day it is for', () => {
    // The agent's running day is the newest day in the sales table, not the
    // calendar day, so at 07:40 Monday "Taken today" can be Sunday night.
    it('says today when the business day is today', async () => {
      await build();
      expect(element.querySelector('.hero .stat-label')!.textContent).toContain('Taken today');
    });

    it('names the date when the business day is not today', async () => {
      await build({ now: new Date(2026, 9, 4, 7, 40) });
      const label = element.querySelector('.hero .stat-label')!.textContent!;
      expect(label).not.toContain('today');
      expect(label).toContain('03/10');
    });
  });

  describe('the comparison cut', () => {
    // Today by 14:00: 400 + 800 = 1200. Last Saturday by 14:00: 300 + 500 = 800.
    // Cutting at the last *sale* (hour 14) and including it whole made today's
    // partial hour read as a shortfall, and a lull read as a lead.
    it('compares complete hours up to the clock', async () => {
      await build();
      const text = element.querySelector('.hero-compare')!.textContent!;
      expect(text).toContain('€400.00 more');
      expect(text).toContain('by 14:00');
    });

    it('falls back to the last sale when the business day is not today', async () => {
      await build({ now: new Date(2026, 9, 4, 7, 40) });
      expect(element.querySelector('.hero-compare')!.textContent).toContain('by 15:00');
    });

    it('asks for the reference day once, not on every 30 s refresh', async () => {
      await build();
      fixture.componentInstance.refresh(true);
      fixture.componentInstance.refresh(true);
      const reference = api.overview.calls.allArgs().filter((a) => a[1] === '2026-09-26');
      expect(reference.length).toBe(1);
    });
  });

  describe('stale answers and bad dates', () => {
    it('does not let an older day overwrite the one now chosen', async () => {
      await build();
      const slow = new Subject<Overview>();
      api.overview.and.callFake(((_id: string, date?: string) =>
        date === '2026-09-20' ? slow : of(overview({ totals: { invoiced: 111, open: 0 }, businessDate: '2026-09-21', archive: true }))) as never);
      fixture.componentInstance.pickDate('2026-09-20');
      fixture.componentInstance.pickDate('2026-09-21');
      slow.next(overview({ totals: { invoiced: 999, open: 0 }, businessDate: '2026-09-20', archive: true }));
      fixture.detectChanges();
      expect(fixture.componentInstance.overview!.totals.invoiced).toBe(111);
    });

    it('ignores a typed day outside the picker’s range', async () => {
      await build();
      for (const bad of ['2020-01-01', '2099-01-01']) {
        fixture.componentInstance.pickDate(bad);
        expect(fixture.componentInstance.date).toBe('');
      }
    });

    it('ignores such a day in the URL', async () => {
      await build({ query: { date: '2099-01-01' } });
      expect(fixture.componentInstance.date).toBe('');
    });
  });

  describe('failure states', () => {
    // fail() cleared `loading` for a *tab* failure too, so with the overview
    // still pending the page was an alert over nothing.
    it('keeps saying it is loading while the overview is still on its way', async () => {
      await build({ today: new Subject<Overview>(), tables: throwError(() => ({ status: 500, error: {} })) });
      expect(element.querySelector('.alert-danger')).not.toBeNull();
      expect(element.textContent).toContain('Loading');
    });
  });

  describe('quiet and empty days', () => {
    const zero = (extra: Partial<Overview> = {}) =>
      overview({ totals: { invoiced: 0, open: 0 }, hourly: [], staff: [], payments: [], stats: undefined, clients: { present: 0 }, ...extra });

    it('says a closed day had no trade in one sentence', async () => {
      await build({ reference: zero({ archive: true, businessDate: '2026-09-13' }), query: { date: '2026-09-13' } });
      expect(element.textContent).toContain('No takings recorded on 13/09');
      expect(element.textContent).not.toContain('Nothing taken that day');
    });

    it('does not show a 0 / 0 tables tile for a shop with no tables', async () => {
      await build({ today: overview({ tables: { free: 0, occupied: 0, awaitingPayment: 0 } }) });
      expect(element.textContent).not.toContain('Tables in use');
      expect(element.textContent).not.toContain('0 / 0');
    });

    it('does not say "As of" beside a closed day', async () => {
      await build({ reference: overview({ archive: true, businessDate: '2026-09-26' }), query: { date: '2026-09-26' } });
      expect(element.querySelector('.small.text-body-secondary')!.textContent).not.toContain('As of');
    });
  });

  describe('structure', () => {
    it('has no heading level skipped', async () => {
      await build();
      expect(element.querySelectorAll('h3').length).toBe(0);
      expect(element.querySelectorAll('h2').length).toBeGreaterThan(0);
    });

    it('keeps list semantics on the view switch', async () => {
      await build();
      expect(element.querySelector('.nav-tabs')!.getAttribute('role')).toBeNull();
    });

    it('points the counters toggle at what it opens', async () => {
      await build();
      const toggle = element.querySelector('.counters-toggle') as HTMLButtonElement;
      expect(element.querySelector(`#${toggle.getAttribute('aria-controls')}`)).not.toBeNull();
    });
  });
});

describe('ShopComponent tiles on a phone (plan.md §806.8)', () => {
  // Three-up left ~67px of text per tile at 360px; an open-tabs figure of
  // €12,345.67 measured 132px and spilled out of its card. Measured in a real
  // browser; this pins the layout that fixed it.
  it('lays the running tiles out two-up on a phone and three-up from sm', async () => {
    const api = jasmine.createSpyObj('ApiService', ['listStores', 'agentPackage', 'overview', 'tables', 'soldItems']);
    api.listStores.and.returnValue(of([]));
    api.agentPackage.and.returnValue(of(null) as never);
    api.overview.and.returnValue(of(overview()) as never);
    api.tables.and.returnValue(of({ free: 1, tables: [] }) as never);
    api.soldItems.and.returnValue(of({ items: [], totalQuantity: 0, totalValue: 0 }) as never);
    await TestBed.configureTestingModule({
      imports: [ShopComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'abc' }), queryParamMap: convertToParamMap({}) } } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ShopComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.col-6.col-sm-4').length).toBe(3);
    expect(fixture.nativeElement.querySelectorAll('.col-4').length).toBe(0);
  });
});
