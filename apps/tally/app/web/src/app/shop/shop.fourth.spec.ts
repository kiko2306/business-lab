import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';
import { ShopComponent } from './shop.component';
import { ApiService } from '../api.service';
import { Clock } from '../clock';
import { Identity, Overview, SoldItemsView, Store } from '../models';

const overview = (extra: Partial<Overview> = {}): Overview =>
  ({
    asOf: '2026-10-03T14:30:00Z', businessDate: '2026-10-03',
    totals: { invoiced: 1300, open: 150 }, tables: { free: 4, occupied: 6, awaitingPayment: 4 },
    clients: { present: 11 }, staff: [{ code: '1', name: 'Ana', total: 900 }], payments: [{ method: 'MB', total: 900 }],
    hourly: [{ hour: 9, total: 400 }, { hour: 10, total: 800 }, { hour: 14, total: 100 }],
    stats: { transactions: 40, discounts: 12, consumptions: 30, customers: 37 }, ...extra,
  }) as Overview;

const store = (extra: Partial<Store> = {}): Store => ({
  id: 'abc', name: 'Pastelaria Central', isActive: true, agentEnrolled: true, connected: true,
  lastSeenAt: new Date(2026, 9, 3, 11, 40).toISOString(), agentVersion: '1.4.0', ...extra,
});

/** §810: what the fourth critique found. */
describe('ShopComponent fourth pass (plan.md §810)', () => {
  let fixture: ComponentFixture<ShopComponent>;
  let element: HTMLElement;
  let api: jasmine.SpyObj<ApiService>;
  const poll = () => (fixture.componentInstance as unknown as { poll(): void }).poll();

  interface Options {
    today?: Observable<Overview> | Overview;
    reference?: Observable<Overview> | Overview;
    tables?: Observable<unknown>;
    items?: SoldItemsView;
    me?: Observable<Identity>;
    query?: Record<string, string>;
  }

  const build = async (o: Options = {}) => {
    const resolve = (v: Observable<Overview> | Overview | undefined, fallback: Overview) =>
      v === undefined ? of(fallback) : 'subscribe' in v ? v : of(v);
    api = jasmine.createSpyObj('ApiService', ['listStores', 'me', 'agentPackage', 'overview', 'tables', 'soldItems']);
    api.listStores.and.returnValue(of([store()]));
    api.me.and.returnValue((o.me ?? of({ user: 'admin', isAdmin: true })) as never);
    api.agentPackage.and.returnValue(of(null) as never);
    api.overview.and.callFake(((_id: string, date?: string) =>
      date ? resolve(o.reference, overview({ totals: { invoiced: 800, open: 0 }, hourly: [{ hour: 9, total: 300 }, { hour: 10, total: 500 }, { hour: 14, total: 900 }] }))
           : resolve(o.today, overview())) as never);
    api.tables.and.returnValue((o.tables ?? of({ free: 4, tables: [] })) as never);
    api.soldItems.and.returnValue(of(o.items ?? { items: [], totalQuantity: 0, totalValue: 0 }) as never);
    await TestBed.configureTestingModule({
      imports: [ShopComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: Clock, useValue: { now: () => new Date(2026, 9, 3, 14, 30) } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'abc' }), queryParamMap: convertToParamMap(o.query ?? {}) } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ShopComponent);
    element = fixture.nativeElement;
    fixture.detectChanges();
  };

  describe('coming back to the app', () => {
    // A standalone phone app has no pull-to-refresh, and the hero can be an
    // hour old with only 13px grey text saying so.
    it('re-reads when the page becomes visible again', async () => {
      await build();
      api.overview.calls.reset();
      document.dispatchEvent(new Event('visibilitychange'));
      expect(api.overview).toHaveBeenCalled();
    });

    it('re-reads when restored from the back-forward cache', async () => {
      await build();
      api.overview.calls.reset();
      window.dispatchEvent(new Event('pageshow'));
      expect(api.overview).toHaveBeenCalled();
    });

    it('does not poll the shop while the page is hidden', async () => {
      await build();
      api.overview.calls.reset();
      spyOnProperty(document, 'hidden', 'get').and.returnValue(true);
      poll();
      expect(api.overview).not.toHaveBeenCalled();
    });

    // The timer only re-read the running day, so an offline agent on a closed
    // day stayed on its panel while the copy said it reconnects by itself.
    it('keeps polling a dated view while the shop is offline', async () => {
      await build({ reference: throwError(() => ({ status: 503, error: { offline: true } })), query: { date: '2026-09-26' } });
      api.overview.calls.reset();
      poll();
      expect(api.overview).toHaveBeenCalled();
    });
  });

  describe('the way back to the list', () => {
    it('reserves the link’s space until it is known whether to show it', async () => {
      const me = new Subject<Identity>();
      await build({ me });
      const link = element.querySelector('a[href="/"]')!;
      expect(link.classList).toContain('invisible');
      me.next({ user: 'admin', isAdmin: true });
      fixture.detectChanges();
      expect(element.querySelector('a[href="/"]')!.classList).not.toContain('invisible');
    });
  });

  describe('naming the day', () => {
    it('says which day a closed day’s figure is for', async () => {
      await build({ reference: overview({ archive: true, businessDate: '2026-09-26' }), query: { date: '2026-09-26' } });
      expect(element.querySelector('.hero .stat-label')!.textContent).toContain('26/09');
    });

    it('rejects a day that does not exist, which Date.parse would roll forward', async () => {
      await build();
      fixture.componentInstance.pickDate('2026-02-30');
      expect(fixture.componentInstance.date).toBe('');
    });

    it('puts the reader back on the tab they left when returning to the running day', async () => {
      await build();
      fixture.componentInstance.pickDate('2026-09-26');
      expect(fixture.componentInstance.tab).toBe('items');
      fixture.componentInstance.pickDate('');
      expect(fixture.componentInstance.tab).toBe('tables');
    });

    it('puts a typed day outside the range back in the picker', async () => {
      await build();
      const input = element.querySelector('input[type="date"]') as HTMLInputElement;
      input.value = '2099-01-01';
      input.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(input.value).toBe('2026-10-03');
    });
  });

  describe('a shop with no tables', () => {
    const noTables = () => overview({ tables: { free: 0, occupied: 0, awaitingPayment: 0 }, clients: { present: 0 } });

    it('does not show guests-in-the-shop, which is 0 forever without tables', async () => {
      await build({ today: noTables() });
      expect(element.textContent).not.toContain('Here now');
    });

    it('opens on Items and offers no empty Tables tab', async () => {
      await build({ today: noTables() });
      expect(fixture.componentInstance.tab).toBe('items');
      const labels = Array.from(element.querySelectorAll('.nav-tabs button')).map((b) => b.textContent?.trim());
      expect(labels).toEqual(['Items sold']);
    });

    it('still honours a tab asked for in the URL', async () => {
      await build({ today: noTables(), query: { tab: 'items' } });
      expect(fixture.componentInstance.tab).toBe('items');
    });
  });

  describe('the items table', () => {
    const items = (n: number): SoldItemsView => ({
      totalQuantity: n, totalValue: n,
      items: Array.from({ length: n }, (_, i) => ({ description: `Item ${i}`, family: 'F', code: String(i), quantity: n - i, total: n - i })),
    }) as unknown as SoldItemsView;

    // With stacked phone cards, an unbounded list is an endless scroll for one
    // question; the chart above it already shows the top ten.
    it('shows ten rows and offers the rest', async () => {
      await build({ items: items(25), query: { tab: 'items' } });
      expect(element.querySelectorAll('.table-stack tbody tr').length).toBe(10);
      const more = Array.from(element.querySelectorAll('button')).find((b) => /Show all 25/.test(b.textContent ?? ''))!;
      expect(more).toBeDefined();
      more.click();
      fixture.detectChanges();
      expect(element.querySelectorAll('.table-stack tbody tr').length).toBe(25);
    });

    it('offers nothing to expand when there are ten or fewer', async () => {
      await build({ items: items(10), query: { tab: 'items' } });
      expect(Array.from(element.querySelectorAll('button')).some((b) => /Show all/.test(b.textContent ?? ''))).toBeFalse();
    });
  });

  describe('the offline panel', () => {
    it('says what to do, not why the product works this way', async () => {
      await build({ today: throwError(() => ({ status: 503, error: { offline: true } })) });
      const text = element.querySelector('.alert-warning')!.textContent!;
      expect(text).toContain('Check that the till computer is switched on');
      expect(text).toContain('on their own');
      expect(text).not.toContain('Nothing is displayed rather');
    });
  });

  describe('a tab that cannot load', () => {
    it('says so, and offers to try again', async () => {
      await build({ tables: throwError(() => ({ status: 500, error: {} })) });
      expect(element.textContent).not.toMatch(/Loading…\s*$/);
      const retry = Array.from(element.querySelectorAll('button')).find((b) => /Try again/.test(b.textContent ?? ''))!;
      expect(retry).toBeDefined();
      api.tables.calls.reset();
      retry.click();
      expect(api.tables).toHaveBeenCalled();
    });
  });

  describe('structure', () => {
    it('only points aria-controls at a row that exists', async () => {
      await build({ tables: of({ free: 1, tables: [{ table: 7, state: 'occupied', staff: 'A', guests: 1, openedAt: null, total: 1, lines: [] }] }) });
      const toggle = element.querySelector('.table-toggle') as HTMLButtonElement;
      expect(toggle.getAttribute('aria-controls')).toBeNull();
      toggle.click();
      fixture.detectChanges();
      expect(element.querySelector(`#${toggle.getAttribute('aria-controls')}`)).not.toBeNull();
    });
  });

  describe('Portuguese', () => {
    it('says "até às", not "às", for the cut hour', async () => {
      const { PT } = await import('../i18n');
      expect(PT['{amount} more than last {weekday} by {hour}:00']).toContain('até às');
      expect(PT['{amount} less than last {weekday} by {hour}:00']).toContain('até às');
      expect(PT['The same as last {weekday} by {hour}:00']).toContain('até às');
    });
  });
});
