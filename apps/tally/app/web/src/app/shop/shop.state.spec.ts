import { Location } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';
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
    hourly: [{ hour: 9, total: 1200 }],
    stats: { transactions: 40, discounts: 12, consumptions: 30, customers: 37 },
    ...extra,
  }) as Overview;

describe('ShopComponent state, feedback and announcements (plan.md §806.5)', () => {
  let fixture: ComponentFixture<ShopComponent>;
  let element: HTMLElement;
  let api: jasmine.SpyObj<ApiService>;
  let location: Location;

  const build = async (query: Record<string, string> = {}) => {
    api = jasmine.createSpyObj('ApiService', ['listStores', 'agentPackage', 'overview', 'tables', 'soldItems']);
    api.listStores.and.returnValue(of([]));
    api.agentPackage.and.returnValue(of(null) as never);
    api.overview.and.returnValue(of(overview()) as never);
    api.tables.and.returnValue(of({ free: 8, tables: [] }) as never);
    api.soldItems.and.returnValue(of({ items: [], totalQuantity: 0, totalValue: 0 }) as never);

    await TestBed.configureTestingModule({
      imports: [ShopComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'abc' }), queryParamMap: convertToParamMap(query) } },
        },
      ],
    }).compileComponents();
    location = TestBed.inject(Location);
    spyOn(location, 'replaceState');
    fixture = TestBed.createComponent(ShopComponent);
    element = fixture.nativeElement;
    fixture.detectChanges();
  };

  describe('the day and tab survive a reload or a link', () => {
    it('opens on the day in the URL', async () => {
      await build({ date: '2026-09-26' });
      expect(api.overview).toHaveBeenCalledWith('abc', '2026-09-26');
      expect(fixture.componentInstance.date).toBe('2026-09-26');
    });

    it('opens on the tab in the URL', async () => {
      await build({ tab: 'items' });
      expect(fixture.componentInstance.tab).toBe('items');
    });

    it('ignores a date that is not a date, rather than relaying it to the shop', async () => {
      await build({ date: '../../etc' });
      expect(fixture.componentInstance.date).toBe('');
    });

    it('never opens Tables on a closed day', async () => {
      await build({ date: '2026-09-26', tab: 'tables' });
      expect(fixture.componentInstance.tab).toBe('items');
    });

    it('writes the chosen day to the URL without adding a history entry', async () => {
      await build();
      fixture.componentInstance.pickDate('2026-09-26');
      expect(location.replaceState).toHaveBeenCalledWith('', jasmine.stringMatching(/date=2026-09-26/));
    });

    it('writes the tab to the URL', async () => {
      await build();
      fixture.componentInstance.setTab('items');
      expect(location.replaceState).toHaveBeenCalledWith('', jasmine.stringMatching(/tab=items/));
    });
  });

  describe('switching tab', () => {
    // setTab() used to call refresh(), which re-fetched the overview too — a
    // relay to a Windows box in a shop, for figures already on screen.
    it('fetches the tab, not the overview again', async () => {
      await build();
      api.overview.calls.reset();
      fixture.componentInstance.setTab('items');
      expect(api.soldItems).toHaveBeenCalled();
      expect(api.overview).not.toHaveBeenCalled();
    });
  });

  describe('Refresh', () => {
    it('shows that it is working, and cannot be pressed twice', async () => {
      await build();
      const pending = new Subject<Overview>();
      api.overview.and.returnValue(pending as never);
      const button = element.querySelector('button.refresh') as HTMLButtonElement;

      button.click();
      fixture.detectChanges();
      expect(button.disabled).toBeTrue();
      expect(button.textContent).toContain('Refreshing');

      pending.next(overview());
      pending.complete();
      fixture.detectChanges();
      expect(button.disabled).toBeFalse();
      expect(button.textContent).not.toContain('Refreshing');
    });

    it('says when it finished, for a screen reader', async () => {
      await build();
      (element.querySelector('button.refresh') as HTMLButtonElement).click();
      fixture.detectChanges();
      const status = element.querySelector('[role="status"]') as HTMLElement;
      expect(status.textContent).toContain('Updated');
    });

    it('does not announce the silent 30 second refresh', async () => {
      await build();
      fixture.componentInstance.refresh(true);
      fixture.detectChanges();
      expect((element.querySelector('[role="status"]') as HTMLElement).textContent?.trim()).toBe('');
    });
  });

  describe('the Tables / Items switch', () => {
    // A tablist promises arrow-key navigation this does not implement; these
    // are two buttons that switch a view, so they say which one is pressed.
    it('reports which view is showing', async () => {
      await build();
      const [tables, items] = Array.from(element.querySelectorAll('.nav-tabs button')) as HTMLButtonElement[];
      expect(tables.getAttribute('aria-pressed')).toBe('true');
      expect(items.getAttribute('aria-pressed')).toBe('false');
      items.click();
      fixture.detectChanges();
      expect(items.getAttribute('aria-pressed')).toBe('true');
    });
  });

  describe('offline', () => {
    // The service worker is deliberately a no-op, so an installed app with no
    // connectivity otherwise gets only a failed-request error.
    it('says so when the browser loses its connection', async () => {
      await build();
      window.dispatchEvent(new Event('offline'));
      fixture.detectChanges();
      expect(element.textContent).toContain('You are offline');
      window.dispatchEvent(new Event('online'));
      fixture.detectChanges();
      expect(element.textContent).not.toContain('You are offline');
    });
  });

  describe('labels', () => {
    // "Guests in" and "Customers" both read as "Clientes" two tiles apart, and
    // they are different figures (people in the shop now vs invoices today).
    it('does not give two different figures the same Portuguese name', async () => {
      const { PT } = await import('../i18n');
      expect(PT['Here now']).toBeDefined();
      expect(PT['Here now']).not.toBe(PT['Customers']);
    });
  });
});
