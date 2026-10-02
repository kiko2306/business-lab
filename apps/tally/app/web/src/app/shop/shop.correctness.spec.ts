import { Title } from '@angular/platform-browser';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';
import { ShopComponent } from './shop.component';
import { ApiService } from '../api.service';
import { Overview, Store } from '../models';

const overview = (extra: Partial<Overview> = {}): Overview =>
  ({
    asOf: '2026-10-03T14:30:00Z',
    businessDate: '2026-10-03',
    totals: { invoiced: 1200, open: 150 },
    tables: { free: 4, occupied: 6, awaitingPayment: 4 },
    clients: { present: 11 },
    staff: [],
    payments: [],
    hourly: [{ hour: 9, total: 1200 }],
    stats: { transactions: 40, discounts: 12, consumptions: 30, customers: 37 },
    ...extra,
  }) as Overview;

const store = (extra: Partial<Store> = {}): Store => ({
  id: 'abc',
  name: 'Pastelaria Central',
  isActive: true,
  agentEnrolled: true,
  connected: true,
  lastSeenAt: '2026-10-03T12:42:00Z',
  agentVersion: '1.4.0',
  ...extra,
});

/** §806.6: the defects the second critique found, each reproduced before it was fixed. */
describe('ShopComponent correctness (plan.md §806.6)', () => {
  let fixture: ComponentFixture<ShopComponent>;
  let element: HTMLElement;

  const build = async (
    over: Observable<Overview> | Overview = overview(),
    tables: Observable<unknown> = of({ free: 4, tables: [] }),
    stores: Store[] = [store()]
  ) => {
    const api = jasmine.createSpyObj('ApiService', ['listStores', 'me', 'agentPackage', 'overview', 'tables', 'soldItems']);
    api.listStores.and.returnValue(of(stores));
    api.agentPackage.and.returnValue(of(null) as never);
    api.me.and.returnValue(of({ user: 'owner', isAdmin: true }) as never);
    api.overview.and.callFake((_id: string, date?: string) =>
      date ? (of(overview({ totals: { invoiced: 800, open: 0 } })) as never) : (('subscribe' in over ? over : of(over)) as never)
    );
    api.tables.and.returnValue(tables as never);
    api.soldItems.and.returnValue(of({ items: [], totalQuantity: 0, totalValue: 0 }) as never);
    await TestBed.configureTestingModule({
      imports: [ShopComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'abc' }), queryParamMap: convertToParamMap({}) } },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ShopComponent);
    element = fixture.nativeElement;
    fixture.detectChanges();
  };

  describe('tables in use', () => {
    // "Occupied" is Wintouch estado 2 only; awaiting payment (estado 1) is a
    // disjoint count. A table waiting to pay still has people at it, so
    // 6 occupied + 4 waiting read as "6 / 14" and 43 % — understating the floor.
    it('counts a table waiting to pay as in use', async () => {
      await build();
      const tile = Array.from(element.querySelectorAll('.stat-card')).find((c) => c.textContent?.includes('Tables in use'))!;
      expect(tile.textContent).toContain('10');
      expect(tile.textContent).toContain('/ 14');
      expect(tile.textContent).toContain('4 waiting to pay');
    });

    it('computes occupancy from the same count', async () => {
      await build();
      expect(fixture.componentInstance.occupancy).toBeCloseTo((100 * 10) / 14, 5);
    });
  });

  describe('errors', () => {
    // A tab failure that landed before the overview was then wiped by the
    // overview's own success (`error = ''`), leaving the tab on "Loading…".
    it('keeps a tab failure when the overview succeeds afterwards', async () => {
      const pending = new Subject<Overview>();
      await build(pending, throwError(() => ({ status: 500, error: { error: 'Relay failed' } })));
      pending.next(overview());
      pending.complete();
      fixture.detectChanges();
      expect(element.querySelector('.alert-danger')?.textContent).toContain('did not answer');
    });

    it('clears that failure once the tab loads again', async () => {
      await build();
      fixture.componentInstance.setTab('items');
      fixture.detectChanges();
      expect(element.querySelector('.alert-danger')).toBeNull();
    });

    // The browser being offline is already said by its own banner; the next
    // 30 s tick used to add a second red alert for the same cause.
    it('does not stack a second alert on the offline banner', async () => {
      await build();
      window.dispatchEvent(new Event('offline'));
      fixture.detectChanges();
      (fixture.componentInstance as unknown as { fail: (e: unknown) => void }).fail({ status: 0, error: null });
      fixture.detectChanges();
      expect(element.querySelectorAll('[role="alert"]').length).toBe(1);
      window.dispatchEvent(new Event('online'));
    });

    for (const status of [0, 500, 502, 504]) {
      it(`writes status ${status} for the reader, not as a code`, async () => {
        await build(throwError(() => ({ status, error: { error: 'ECONNRESET at relay' } })));
        const text = element.querySelector('.alert-danger')?.textContent ?? '';
        expect(text).not.toContain(`(${status})`);
        expect(text).not.toContain('ECONNRESET');
        expect(text.length).toBeGreaterThan(10);
      });
    }

    it('says when the shop was last seen, and in the shop’s words', async () => {
      await build(throwError(() => ({ status: 503, error: { offline: true } })));
      const panel = element.querySelector('.alert-warning')!.textContent!;
      expect(panel).toContain('Last seen');
      expect(panel).not.toContain('agent');
      expect(panel).toContain('on their own');
    });

    it('does not claim a last-seen time it does not have', async () => {
      await build(throwError(() => ({ status: 503, error: { offline: true } })), of({ free: 0, tables: [] }), [
        store({ lastSeenAt: null }),
      ]);
      expect(element.querySelector('.alert-warning')!.textContent).not.toContain('Last seen');
    });
  });

  describe('structure', () => {
    // §806.2 said both pages gained an <h1>; the edit on this one silently did
    // not apply (wrong indentation in a string replace) and nothing checked.
    it('has exactly one <h1>, and it names the shop', async () => {
      await build();
      const h1 = element.querySelectorAll('h1');
      expect(h1.length).toBe(1);
      expect(h1[0].textContent).toContain('Pastelaria Central');
    });

    it('titles the document with the shop, not the bare product name', async () => {
      await build();
      expect(TestBed.inject(Title).getTitle()).toBe('Pastelaria Central · Tally');
    });
  });
});
