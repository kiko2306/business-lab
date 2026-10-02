import { CommonModule, Location } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../api.service';
import { BarChartComponent, BarDatum } from '../charts/bar-chart.component';
import { HourlyChartComponent } from '../charts/hourly-chart.component';
import { TPipe, numberLocale, t } from '../i18n';
import { Clock, localDay } from '../clock';
import { ConnectionService } from '../connection';
import { describeFailure } from '../errors';
import { Comparison, comparableTotal, comparisonDate, describeComparison } from './comparison';
import { AgentPackage, Overview, SoldItemsView, Store, TablesView } from '../models';

type Tab = 'tables' | 'items';

@Component({
  selector: 'app-shop',
  standalone: true,
  imports: [CommonModule, RouterLink, BarChartComponent, HourlyChartComponent, TPipe],
  templateUrl: './shop.component.html',
  styleUrl: './shop.component.css',
})
export class ShopComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private url = inject(Location);
  private title = inject(Title);
  private clock = inject(Clock);
  private connection = inject(ConnectionService);

  storeId = '';
  store: Store | null = null;
  /** What the current agent build is, so the shown version can be coloured against it (§670). */
  agentPackage: AgentPackage | null = null;

  overview: Overview | null = null;
  tables: TablesView | null = null;
  soldItems: SoldItemsView | null = null;

  tab: Tab = 'tables';
  /**
   * The day being looked at, yyyy-MM-dd. Empty means the running day — the one
   * Wintouch has open — which is what a floor screen wants and refreshes on its
   * own. Any other day is read from Wintouch's archive of closed days (§682).
   */
  date = '';
  /** The running day, learned from the first response for it; also the latest day the picker allows. */
  runningDate: string | null = null;
  loading = true;
  /** Set when the shop's agent is not connected — a distinct state from an error. */
  offline = false;
  /**
   * Kept per source: the overview's success used to clear any error, so a tab
   * request that failed first was wiped by the overview landing afterwards,
   * leaving the tab on "Loading…" with nothing said.
   */
  private overviewError = '';
  private tabError = '';
  get error(): string {
    return this.overviewError || this.tabError;
  }
  openTable: number | null = null;
  /** "€412 more than last Saturday", or null until the reference day resolves. */
  comparison: Comparison | null = null;
  /** The six Wintouch counters: reference, not the answer, so they start folded. */
  countersOpen = false;
  /** A user-requested re-read is in flight over figures already on screen. */
  refreshing = false;
  /** Read aloud when a user-requested refresh lands; the silent 30 s one never touches it. */
  statusNote = '';
  /** The browser itself has no connection — distinct from the shop's agent being away. */
  get browserOffline(): boolean {
    return this.connection.offline();
  }

  private readonly onOnline = () => this.refresh(true);
  /** The reference day never changes once read, so it is read once per day, not every 30 s. */
  private readonly referenceDays = new Map<string, Overview>();

  private timer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.storeId = this.route.snapshot.paramMap.get('id') ?? '';
    this.readStateFromUrl();
    this.title.setTitle(`${t('Shop')} · Tally`);
    window.addEventListener('online', this.onOnline);
    this.loadStore();
    this.api.agentPackage().subscribe({ next: (pkg) => (this.agentPackage = pkg), error: () => undefined });
    // Quiet: the first paint is not something to announce as an "update".
    this.refresh(true);
    // A floor dashboard is left open on a screen, so it refreshes itself. The
    // figures are read live from the shop on every call — there is no cache to
    // go stale, only this interval.
    // A closed day cannot change, so only the running day is re-read.
    this.timer = setInterval(() => { if (!this.date) this.refresh(true); }, 30_000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    window.removeEventListener('online', this.onOnline);
  }

  private loadStore(): void {
    this.api.listStores().subscribe({
      next: (stores) => {
        this.store = stores.find((s) => s.id === this.storeId) ?? null;
        if (this.store) this.title.setTitle(`${this.store.name} · Tally`);
      },
      error: () => undefined,
    });
  }

  /** The shop's wall-clock day, from the clock seam. */
  private get today(): string {
    return localDay(this.clock.now());
  }

  /** dd/MM — the weekday-free short date used in labels. */
  private shortDate(day: string): string {
    return new Intl.DateTimeFormat(numberLocale, { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(
      new Date(`${day}T00:00:00Z`)
    );
  }

  /**
   * The picker's bounds, enforced rather than advised: `min`/`max` only stop the
   * widget, so a typed 2020 date, or `?date=2099-01-01`, was relayed to a
   * Windows machine in the shop to come back empty.
   */
  private dayAllowed(day: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return false;
    const tomorrow = new Date(this.clock.now());
    tomorrow.setDate(tomorrow.getDate() + 1);
    return day >= this.earliestDate && day <= (this.runningDate ?? localDay(tomorrow));
  }

  /**
   * The day and the tab live in the query string, so a reload, a bookmark, a
   * shared link and the back button all land where the reader was — they used
   * to be component fields, and iOS discarding a background tab silently
   * returned the running day. Validated before use: `date` is relayed to a
   * Windows machine in a shop, so only a real-looking day gets through.
   */
  private readStateFromUrl(): void {
    const query = this.route.snapshot.queryParamMap;
    const date = query?.get('date') ?? '';
    if (this.dayAllowed(date)) {
      this.date = date;
    }
    const tab = query?.get('tab');
    if (tab === 'tables' || tab === 'items') this.tab = tab;
    // Open tables are the running moment; a closed day has none to show.
    if (this.date && this.tab === 'tables') this.tab = 'items';
  }

  /** `replaceState`, not a navigation: choosing a day is not a page the back button should return to. */
  private writeStateToUrl(): void {
    const params = new URLSearchParams();
    if (this.date) params.set('date', this.date);
    if (this.tab !== 'tables') params.set('tab', this.tab);
    this.url.replaceState(this.url.path().split('?')[0] ?? '', params.toString());
  }

  /** Only the tab's own payload: the overview on screen is already current. */
  setTab(tab: Tab): void {
    this.tab = tab;
    this.writeStateToUrl();
    this.loadTab();
  }

  toggleTable(table: number): void {
    this.openTable = this.openTable === table ? null : table;
  }

  /**
   * A running day that has not started: no takings, nothing on the hourly
   * track. Eleven zero tiles and four differently-worded empty strings read as
   * "broken" at 07:40, not as "early" (plan.md §806), so the figures wait for
   * the first sale and one sentence stands in. Tables and guests are left
   * showing, because they are meaningful at zero.
   */
  get beforeFirstSale(): boolean {
    const o = this.overview;
    return !!o && !o.archive && o.totals.invoiced === 0 && o.totals.open === 0 && !(o.hourly ?? []).length;
  }

  /**
   * The earliest day the picker offers. Wintouch keeps its archive, but a date
   * from before this shop existed costs a relay to a Windows machine to come
   * back empty, so the floor is a year back from the running day.
   */
  get earliestDate(): string {
    const from = this.runningDate ? new Date(`${this.runningDate}T00:00:00Z`) : new Date(`${this.today}T00:00:00Z`);
    from.setUTCFullYear(from.getUTCFullYear() - 1);
    return from.toISOString().slice(0, 10);
  }

  /** A closed day: the live-only panels and the Tables tab have nothing to say about it. */
  get viewingArchive(): boolean {
    return !!this.date;
  }

  /** Picking the running day itself is not "another day" — it goes back to the live view. */
  pickDate(value: string): void {
    if (value && !this.dayAllowed(value)) return;
    this.date = !value || value === this.runningDate ? '' : value;
    // Open tables are the running moment; a closed day has none to show.
    if (this.date && this.tab === 'tables') this.tab = 'items';
    this.overview = null;
    this.soldItems = null;
    this.comparison = null;
    this.writeStateToUrl();
    this.refresh();
  }

  /** `quiet` keeps the current figures on screen while re-fetching, and says nothing. */
  refresh(quiet = false): void {
    if (!quiet) {
      this.loading = true;
      this.refreshing = true;
    }
    // An answer for a day that is no longer the chosen one is dropped: picking
    // A then B quickly, or a day while the 30 s refresh is in flight, let the
    // older response land last and put one day's figures under another's picker.
    const day = this.date;
    this.api.overview(this.storeId, day || undefined).subscribe({
      next: (overview) => {
        if (day !== this.date) return;
        this.overview = overview;
        if (!overview.archive && overview.businessDate) this.runningDate = overview.businessDate;
        this.offline = false;
        this.overviewError = '';
        this.loading = false;
        this.refreshing = false;
        if (!quiet) this.statusNote = t('Updated at {time}', { time: this.clock.now().toLocaleTimeString(numberLocale) });
        this.loadComparison(overview);
      },
      error: (err) => {
        if (day !== this.date) return;
        this.refreshing = false;
        this.fail(err, 'overview');
      },
    });
    this.loadTab();
  }

  private loadTab(): void {
    const day = this.date;
    const tab = this.tab;
    const stale = () => day !== this.date || tab !== this.tab;
    if (tab === 'tables' && !day) {
      this.api.tables(this.storeId).subscribe({
        next: (tables) => {
          if (stale()) return;
          this.tables = tables;
          this.tabError = '';
        },
        error: (err) => !stale() && this.fail(err, 'tab'),
      });
    } else {
      this.api.soldItems(this.storeId, day || undefined).subscribe({
        next: (items) => {
          if (stale()) return;
          this.soldItems = items;
          this.tabError = '';
        },
        error: (err) => !stale() && this.fail(err, 'tab'),
      });
    }
  }

  /**
   * The last hour both sides are compared through, or null to compare whole days.
   *
   * A running day is cut to the *complete* hours on the clock — the hour in
   * progress is a partial against last week's full one, which read as a
   * shortfall. When the agent's business day is not today's calendar day (just
   * after midnight) the clock says nothing about it, so it falls back to the
   * last hour with a sale. A day with no hourly breakdown cannot be cut.
   */
  private comparisonCutoff(today: Overview): number | null {
    if (today.archive || !(today.hourly ?? []).length) return null;
    if (today.businessDate === this.today) {
      const complete = this.clock.now().getHours() - 1;
      if (complete >= 0) return complete;
    }
    return today.hourly.reduce((max, h) => Math.max(max, h.hour), -1);
  }

  /**
   * Fetch the same weekday a week back and phrase the difference. A failure is
   * silent on purpose — the comparison is an extra, and an owner who cannot
   * reach last week should still see today — and it hides the line rather than
   * saying "no figures", which would blame last week for a network blip.
   */
  private loadComparison(today: Overview): void {
    const reference = comparisonDate(today.businessDate);
    if (!reference) {
      this.comparison = null;
      return;
    }
    const upto = this.comparisonCutoff(today);
    const render = (past: Overview) => {
      if (this.overview !== today) return;
      this.comparison = describeComparison(
        comparableTotal(today, upto) ?? today.totals.invoiced,
        comparableTotal(past, upto),
        reference,
        numberLocale,
        upto === null ? null : upto + 1
      );
    };
    const known = this.referenceDays.get(reference);
    if (known) {
      render(known);
      return;
    }
    this.api.overview(this.storeId, reference).subscribe({
      next: (past) => {
        this.referenceDays.set(reference, past);
        render(past);
      },
      error: () => {
        if (this.overview === today) this.comparison = null;
      },
    });
  }

  /** What the hero says its figure is — and when the agent's day is not today, which day. */
  get heroLabel(): string {
    const o = this.overview;
    if (o?.archive) return t('Invoiced');
    if (o?.businessDate && o.businessDate !== this.today) {
      return t('Taken on {date}', { date: this.shortDate(o.businessDate) });
    }
    return t('Taken today');
  }

  /** A closed day nothing was rung up on: one sentence, as the running day gets. */
  get emptyClosedDay(): boolean {
    const o = this.overview;
    return !!o?.archive && o.totals.invoiced === 0 && o.totals.open === 0 && !(o.hourly ?? []).length && !(o.staff ?? []).length;
  }

  get emptyClosedDayText(): string {
    return t('No takings recorded on {date}.', { date: this.shortDate(this.overview?.businessDate ?? this.date) });
  }

  /** "Last seen at 11:40", or with the day when it was not today — an outage from last night reads ambiguous as a bare time. */
  get lastSeenText(): string {
    const seen = this.store?.lastSeenAt ? new Date(this.store.lastSeenAt) : null;
    if (!seen || Number.isNaN(seen.getTime())) return '';
    const time = new Intl.DateTimeFormat(numberLocale, { hour: '2-digit', minute: '2-digit' }).format(seen);
    return localDay(seen) === this.today
      ? t('Last seen at {time}', { time })
      : t('Last seen {date} at {time}', { date: this.shortDate(localDay(seen)), time });
  }

  /** Largest first: the comparison is the point, so rank carries it. */
  get staffBars(): BarDatum[] {
    return (this.overview?.staff ?? [])
      .map((p) => ({ label: p.name, value: p.total }))
      .sort((a, b) => b.value - a.value);
  }

  get paymentBars(): BarDatum[] {
    return (this.overview?.payments ?? [])
      .map((p) => ({ label: p.method, value: p.total }))
      .sort((a, b) => b.value - a.value);
  }

  /** Takings per invoice — Wintouch's "talão médio". */
  get averageTicket(): number {
    const n = this.overview?.stats?.transactions ?? 0;
    return n ? (this.overview?.totals.invoiced ?? 0) / n : 0;
  }

  /** Invoiced plus what is still open on tables — Wintouch's "previsto". */
  get forecast(): number {
    return (this.overview?.totals.invoiced ?? 0) + (this.overview?.totals.open ?? 0);
  }

  /**
   * Tables with people at them. Wintouch's `occupied` is estado 2 only and
   * `awaitingPayment` (estado 1) is a disjoint count, so a table waiting to pay
   * was left out: 6 occupied + 4 waiting read as "6 / 14" and 43 % when ten
   * tables had customers (plan.md §806.6).
   */
  get tablesInUse(): number {
    const t = this.overview?.tables;
    return t ? t.occupied + t.awaitingPayment : 0;
  }

  get tablesTotal(): number {
    const t = this.overview?.tables;
    return t ? t.occupied + t.free + t.awaitingPayment : 0;
  }

  /** Share of tables with customers right now; only meaningful for the running day. */
  get occupancy(): number {
    return this.tablesTotal ? (100 * this.tablesInUse) / this.tablesTotal : 0;
  }

  /** Top ten only — a long tail of one-offs buries the items that matter. */
  get itemBars(): BarDatum[] {
    return (this.soldItems?.items ?? [])
      .map((i) => ({ label: i.description, value: i.quantity }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }

  private fail(err: HttpErrorResponse, source: 'overview' | 'tab' = 'overview'): void {
    // Only the overview ends "loading": a tab failing first used to blank the
    // page to an alert over nothing while the overview was still on its way.
    if (source === 'overview') this.loading = false;
    const set = (message: string) => {
      if (source === 'overview') this.overviewError = message;
      else this.tabError = message;
    };
    if (err.status === 401) {
      // The Authelia session lapsed: a reload goes back through the gate and
      // returns here signed in. Guarded, because if the identity headers are
      // missing entirely — a proxy misconfiguration rather than an expiry —
      // reloading would loop forever instead of showing anything.
      if (!sessionStorage.getItem('tally-reauth')) {
        sessionStorage.setItem('tally-reauth', '1');
        location.reload();
        return;
      }
      set(t('Not signed in, and reloading did not help. The proxy may not be forwarding identity headers.'));
      return;
    }
    sessionStorage.removeItem('tally-reauth');
    // 503 is the agent being away, which is ordinary and temporary — it gets
    // its own panel rather than a red error, and the figures already on screen
    // are cleared so nothing stale is read as current.
    if (err.status === 503 && err.error?.offline) {
      this.offline = true;
      this.overview = null;
      this.tables = null;
      this.soldItems = null;
      this.overviewError = '';
      this.tabError = '';
      // `store` was read once when the page opened, so the "last seen" it
      // prints would be the time the page opened, not the time the shop went dark.
      this.loadStore();
      return;
    }
    this.offline = false;
    // The browser having no connection is already said by its own banner; a
    // second red alert for the same cause only made it look like two problems.
    if (this.browserOffline) return;
    set(describeFailure(err, t('Could not reach the shop ({status})', { status: err.status })));
  }
}
