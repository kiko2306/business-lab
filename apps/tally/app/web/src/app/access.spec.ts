import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { isSoleShopViewer } from './access';
import { ApiService } from './api.service';
import { Overview, Store } from './models';
import { ShopComponent } from './shop/shop.component';
import { StoresComponent } from './stores/stores.component';

const store = (id: string): Store =>
  ({ id, name: `Shop ${id}`, isActive: true, agentEnrolled: true, connected: true, lastSeenAt: null, agentVersion: '1.4.0' }) as Store;
const owner = { user: 'owner', isAdmin: false };
const admin = { user: 'admin', isAdmin: true };

describe('isSoleShopViewer (plan.md §809)', () => {
  it('is true for a non-admin with exactly one shop', () => {
    expect(isSoleShopViewer(owner, [store('a')])).toBeTrue();
  });

  it('is false for an admin, who manages the list', () => {
    expect(isSoleShopViewer(admin, [store('a')])).toBeFalse();
  });

  it('is false with two shops, which is a real choice', () => {
    expect(isSoleShopViewer(owner, [store('a'), store('b')])).toBeFalse();
  });

  // An empty list from a failed request is not "one shop", and a half-loaded
  // page must not redirect on what it has not learned yet.
  it('is false until both facts are known, and for an empty list', () => {
    expect(isSoleShopViewer(null, [store('a')])).toBeFalse();
    expect(isSoleShopViewer(owner, null)).toBeFalse();
    expect(isSoleShopViewer(owner, [])).toBeFalse();
  });
});

describe('the Shops page redirects a sole-shop viewer (plan.md §809)', () => {
  const build = async (me: unknown, list: unknown) => {
    const api = jasmine.createSpyObj('ApiService', ['listStores', 'me', 'agentPackage']);
    api.listStores.and.returnValue(list as never);
    api.me.and.returnValue(of(me) as never);
    api.agentPackage.and.returnValue(of(null) as never);
    await TestBed.configureTestingModule({
      imports: [StoresComponent],
      providers: [provideRouter([]), { provide: ApiService, useValue: api }],
    }).compileComponents();
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    TestBed.createComponent(StoresComponent).detectChanges();
    return navigate;
  };

  it('goes straight to the shop, replacing the list in history', async () => {
    const navigate = await build(owner, of([store('abc')]));
    expect(navigate).toHaveBeenCalledWith(['/shops', 'abc'], { replaceUrl: true });
  });

  it('leaves an admin on the list', async () => {
    expect(await build(admin, of([store('abc')]))).not.toHaveBeenCalled();
  });

  it('leaves a viewer with two shops on the list', async () => {
    expect(await build(owner, of([store('a'), store('b')]))).not.toHaveBeenCalled();
  });

  it('does not redirect on a failed request', async () => {
    expect(await build(owner, throwError(() => ({ status: 500, error: {} })))).not.toHaveBeenCalled();
  });
});

describe('the shop page and its way back (plan.md §809)', () => {
  const build = async (me: unknown, stores: Store[]) => {
    const api = jasmine.createSpyObj('ApiService', ['listStores', 'me', 'agentPackage', 'overview', 'tables', 'soldItems']);
    api.listStores.and.returnValue(of(stores));
    api.me.and.returnValue(of(me) as never);
    api.agentPackage.and.returnValue(of(null) as never);
    api.overview.and.returnValue(
      of({ asOf: '', totals: { invoiced: 1, open: 0 }, tables: { free: 1, occupied: 0, awaitingPayment: 0 },
           clients: { present: 0 }, staff: [], payments: [], hourly: [{ hour: 9, total: 1 }] } as unknown as Overview) as never
    );
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
    return fixture.nativeElement as HTMLElement;
  };

  // The redirect above would bounce them straight back, so offering the link
  // would be a loop with extra steps.
  it('drops "← All shops" for a viewer whose only shop this is', async () => {
    expect((await build(owner, [store('abc')])).textContent).not.toContain('All shops');
  });

  it('keeps it for an admin', async () => {
    expect((await build(admin, [store('abc')])).textContent).toContain('All shops');
  });

  it('keeps it for a viewer with more than one shop', async () => {
    expect((await build(owner, [store('abc'), store('def')])).textContent).toContain('All shops');
  });
});
