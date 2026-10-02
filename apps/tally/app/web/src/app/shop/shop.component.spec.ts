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

  // A request that failed is not "that day was empty": telling a network blip
  // as "No figures for last Saturday" was a small lie (plan.md §806.8).
  it('hides the sentence when last week cannot be fetched, rather than blaming last week', async () => {
    await build(overview(), 'fail');
    expect(element.querySelector('.hero-compare')).toBeNull();
  });

  it('folds the six Wintouch counters away, and opens them in one tap', async () => {
    await build(overview());
    const toggle = element.querySelector('.counters-toggle') as HTMLButtonElement;
    const panel = toggle.closest('h2')!.nextElementSibling as HTMLElement;
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

// The Tables tab's drill-down was `<tr role="button">`: not focusable, no key
// handler, no expanded state, and `role="button"` overrode `role="row"` so the
// six cells stopped being announced against their headers (plan.md §806).
describe('ShopComponent table drill-down', () => {
  let fixture: ComponentFixture<ShopComponent>;
  let element: HTMLElement;

  beforeEach(async () => {
    const api = jasmine.createSpyObj('ApiService', ['listStores', 'agentPackage', 'overview', 'tables', 'soldItems']);
    api.listStores.and.returnValue(of([]));
    api.agentPackage.and.returnValue(of(null) as never);
    api.overview.and.returnValue(of(overview()) as never);
    api.soldItems.and.returnValue(of({ items: [] }) as never);
    api.tables.and.returnValue(
      of({
        free: 8,
        tables: [
          {
            table: 7,
            state: 'occupied',
            staff: 'Ana',
            guests: 2,
            openedAt: '2026-10-03T12:00:00Z',
            total: 48.6,
            lines: [{ quantity: 2, description: 'Café', total: 1.6 }],
          },
        ],
      }) as never
    );

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
  });

  it('leaves the row a row', () => {
    const row = element.querySelector('tbody tr') as HTMLElement;
    expect(row.getAttribute('role')).toBeNull();
  });

  it('opens from a real button that reports its state', () => {
    const toggle = element.querySelector('tbody tr button') as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe('table-7-lines');

    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(element.querySelector('#table-7-lines')).not.toBeNull();
  });

  it('labels the columns of the line-items table it opens', () => {
    (element.querySelector('tbody tr button') as HTMLButtonElement).click();
    fixture.detectChanges();
    const headers = Array.from(element.querySelectorAll('#table-7-lines th')).map((h) => h.getAttribute('scope'));
    expect(headers.length).toBe(3);
    expect(headers.every((s) => s === 'col')).toBeTrue();
  });

  it('renders no empty tab slot on a closed day', () => {
    const empty = Array.from(element.querySelectorAll('.nav-tabs .nav-item')).filter(
      (li) => !li.querySelector('button')
    );
    expect(empty.length).toBe(0);
  });
});

// A day that has not started yet used to render eleven zeroes and four
// differently-worded empty strings, which reads as broken rather than early
// (plan.md §806). One sentence replaces the figures until the first sale.
describe('ShopComponent before the first sale', () => {
  let fixture: ComponentFixture<ShopComponent>;
  let element: HTMLElement;

  const build = async (today: Overview) => {
    const api = jasmine.createSpyObj('ApiService', ['listStores', 'agentPackage', 'overview', 'tables', 'soldItems']);
    api.listStores.and.returnValue(of([]));
    api.agentPackage.and.returnValue(of(null) as never);
    api.overview.and.returnValue(of(today) as never);
    api.tables.and.returnValue(of({ free: 12, tables: [] }) as never);
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
    element = fixture.nativeElement;
    fixture.detectChanges();
  };

  const quietDay = () =>
    overview({ totals: { invoiced: 0, open: 0 }, hourly: [], stats: undefined, clients: { present: 0 } });

  it('says the day has not started rather than showing a wall of zeroes', async () => {
    await build(quietDay());
    expect(element.textContent).toContain('Nothing rung up yet today');
    expect(element.querySelector('.hero-value')).toBeNull();
  });

  it('still shows what is meaningful at zero', async () => {
    await build(quietDay());
    expect(element.textContent).toContain('Tables in use');
  });

  it('shows the figures as soon as there is one sale', async () => {
    await build(overview({ totals: { invoiced: 12.5, open: 0 }, hourly: [{ hour: 9, total: 12.5 }] }));
    expect(element.textContent).not.toContain('Nothing rung up yet today');
    expect(element.querySelector('.hero-value')).not.toBeNull();
  });

  it('does not claim a quiet day on a closed one', async () => {
    await build(overview({ archive: true, totals: { invoiced: 0, open: 0 }, hourly: [] }));
    expect(element.textContent).not.toContain('Nothing rung up yet today');
  });

  it('caps the day picker to real trading days', async () => {
    await build(overview());
    const picker = element.querySelector('input[type="date"]') as HTMLInputElement;
    expect(picker.getAttribute('max')).toBe('2026-10-03');
    expect(picker.getAttribute('min')).toBeTruthy();
  });
});

describe('ShopComponent polish', () => {
  let element: HTMLElement;

  beforeEach(async () => {
    const api = jasmine.createSpyObj('ApiService', ['listStores', 'agentPackage', 'overview', 'tables', 'soldItems']);
    api.listStores.and.returnValue(
      of([{ id: 'abc', name: 'Pastelaria Central', isActive: true, agentVersion: '1.3.0' }]) as never
    );
    api.agentPackage.and.returnValue(of({ version: '1.4.0' }) as never);
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
    const fixture = TestBed.createComponent(ShopComponent);
    element = fixture.nativeElement;
    fixture.detectChanges();
  });

  // The agent version was the loudest colour on an otherwise-healthy screen,
  // on a non-technical reader's page, about something they cannot act on. It
  // lives on the Shops list, with a tooltip, for the person who can.
  it('keeps the agent version off the owner’s page', () => {
    expect(element.textContent).not.toContain('1.3.0');
    expect(element.querySelector('.text-danger')).toBeNull();
  });
});

describe('ShopComponent clarity (plan.md §806.7)', () => {
  let element: HTMLElement;

  const build = async (today: Overview) => {
    const api = jasmine.createSpyObj('ApiService', ['listStores', 'agentPackage', 'overview', 'tables', 'soldItems']);
    api.listStores.and.returnValue(of([]));
    api.agentPackage.and.returnValue(of(null) as never);
    api.overview.and.callFake((_id: string, date?: string) =>
      of(date ? overview({ totals: { invoiced: 800, open: 0 }, archive: true }) : today) as never
    );
    api.tables.and.returnValue(of({ free: 12, tables: [] }) as never);
    api.soldItems.and.returnValue(of({ items: [], totalQuantity: 0, totalValue: 0 }) as never);
    await TestBed.configureTestingModule({
      imports: [ShopComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'abc']]) } } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ShopComponent);
    element = fixture.nativeElement;
    fixture.detectChanges();
  };

  const quiet = () =>
    overview({ totals: { invoiced: 0, open: 0 }, hourly: [], stats: undefined, clients: { present: 0 } });

  it('says the comparison is by this hour on a running day', async () => {
    await build(overview());
    expect(element.querySelector('.hero-compare')!.textContent).toMatch(/by \d\d:00/);
  });

  // The one-sentence card exists to stop "broken" reading as "early"; the three
  // empty chart strings under it undid that.
  it('drops the empty charts before the first sale, and keeps the tab bar', async () => {
    await build(quiet());
    expect(element.textContent).not.toContain('No takings yet today');
    expect(element.textContent).not.toContain('Nothing taken yet');
    expect(element.textContent).not.toContain('No payments yet');
    expect(element.querySelector('app-hourly-chart')).toBeNull();
    expect(element.querySelector('.nav-tabs')).not.toBeNull();
  });

  it('still shows the charts once there is a sale', async () => {
    await build(overview());
    expect(element.querySelector('app-hourly-chart')).not.toBeNull();
  });

  it('explains Forecast and Open tabs in the shop’s words', async () => {
    await build(overview());
    const text = element.textContent!;
    expect(text).toContain('Taken plus open tabs');
    expect(text).toContain('Not paid yet');
  });

  // "yet" and "today" on a closed day suggest the day is still going.
  it('does not say "yet" or "today" about a closed day', async () => {
    await build(overview({ archive: true, totals: { invoiced: 0, open: 0 }, staff: [], payments: [], hourly: [] }));
    expect(element.textContent).not.toContain('No takings yet today');
    expect(element.textContent).not.toContain('Nothing taken yet');
    expect(element.textContent).not.toContain('No payments yet');
    // The one-sentence closed-day card replaces the empty charts entirely (§806.8).
    expect(element.textContent).toContain('No takings recorded on');
  });
});
