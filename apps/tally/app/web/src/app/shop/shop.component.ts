import { CommonModule, Location } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../api.service';
import { BarChartComponent, BarDatum } from '../charts/bar-chart.component';
import { HourlyChartComponent } from '../charts/hourly-chart.component';
import { TPipe, numberLocale, t } from '../i18n';
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
  error = '';
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
  browserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

  private readonly onOffline = () => (this.browserOffline = true);
  private readonly onOnline = () => {
    this.browserOffline = false;
    this.refresh(true);
  };

  private timer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.storeId = this.route.snapshot.paramMap.get('id') ?? '';
    this.readStateFromUrl();
    window.addEventListener('offline', this.onOffline);
    window.addEventListener('online', this.onOnline);
    this.api.listStores().subscribe({
      next: (stores) => (this.store = stores.find((s) => s.id === this.storeId) ?? null),
      error: () => undefined,
    });
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
    window.removeEventListener('offline', this.onOffline);
    window.removeEventListener('online', this.onOnline);
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
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
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
    const from = this.runningDate ? new Date(`${this.runningDate}T00:00:00Z`) : new Date();
    from.setUTCFullYear(from.getUTCFullYear() - 1);
    return from.toISOString().slice(0, 10);
  }

  /** A closed day: the live-only panels and the Tables tab have nothing to say about it. */
  get viewingArchive(): boolean {
    return !!this.date;
  }

  /** Picking the running day itself is not "another day" — it goes back to the live view. */
  pickDate(value: string): void {
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
    this.api.overview(this.storeId, this.date || undefined).subscribe({
      next: (overview) => {
        this.overview = overview;
        if (!overview.archive && overview.businessDate) this.runningDate = overview.businessDate;
        this.offline = false;
        this.error = '';
        this.loading = false;
        this.refreshing = false;
        if (!quiet) this.statusNote = t('Updated at {time}', { time: new Date().toLocaleTimeString(numberLocale) });
        this.loadComparison(overview);
      },
      error: (err) => {
        this.refreshing = false;
        this.fail(err);
      },
    });
    this.loadTab();
  }

  private loadTab(): void {
    if (this.tab === 'tables' && !this.date) {
      this.api.tables(this.storeId).subscribe({
        next: (tables) => (this.tables = tables),
        error: (err) => this.fail(err),
      });
    } else {
      this.api.soldItems(this.storeId, this.date || undefined).subscribe({
        next: (items) => (this.soldItems = items),
        error: (err) => this.fail(err),
      });
    }
  }

  /**
   * Fetch the same weekday a week back and phrase the difference.
   *
   * A running day is compared only up to the hour it has reached — holding a
   * morning's takings against last week's whole day reads as a collapse. A
   * failure here is silent on purpose: the comparison is an extra, and a shop
   * owner who cannot reach last week should still see today.
   */
  private loadComparison(today: Overview): void {
    const reference = comparisonDate(today.businessDate);
    if (!reference) {
      this.comparison = null;
      return;
    }
    const uptoHour = today.archive ? null : (today.hourly ?? []).reduce((max, h) => Math.max(max, h.hour), -1);
    this.api.overview(this.storeId, reference).subscribe({
      next: (past) => {
        this.comparison = describeComparison(
          today.totals.invoiced,
          comparableTotal(past, uptoHour !== null && uptoHour >= 0 ? uptoHour : null),
          reference,
          numberLocale
        );
      },
      error: () => {
        this.comparison = describeComparison(today.totals.invoiced, null, reference, numberLocale);
      },
    });
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

  /** Share of tables occupied right now; only meaningful for the running day. */
  get occupancy(): number {
    const t = this.overview?.tables;
    const total = t ? t.occupied + t.free + t.awaitingPayment : 0;
    return total ? (100 * (t?.occupied ?? 0)) / total : 0;
  }

  /** Top ten only — a long tail of one-offs buries the items that matter. */
  get itemBars(): BarDatum[] {
    return (this.soldItems?.items ?? [])
      .map((i) => ({ label: i.description, value: i.quantity }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }

  private fail(err: HttpErrorResponse): void {
    this.loading = false;
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
      this.error = t('Not signed in, and reloading did not help. The proxy may not be forwarding identity headers.');
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
      this.error = '';
      return;
    }
    this.offline = false;
    this.error = err.error?.error ?? t('Could not reach the shop ({status})', { status: err.status });
  }
}
