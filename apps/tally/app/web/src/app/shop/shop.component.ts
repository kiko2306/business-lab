import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../api.service';
import { BarChartComponent, BarDatum } from '../charts/bar-chart.component';
import { HourlyChartComponent } from '../charts/hourly-chart.component';
import { AgentPackage, Overview, ShopTable, SoldItemsView, Store, TablesView } from '../models';

type Tab = 'tables' | 'items';

@Component({
  selector: 'app-shop',
  standalone: true,
  imports: [CommonModule, RouterLink, BarChartComponent, HourlyChartComponent],
  templateUrl: './shop.component.html',
  styleUrl: './shop.component.css',
})
export class ShopComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);

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

  private timer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.storeId = this.route.snapshot.paramMap.get('id') ?? '';
    this.api.listStores().subscribe({
      next: (stores) => (this.store = stores.find((s) => s.id === this.storeId) ?? null),
      error: () => undefined,
    });
    this.api.agentPackage().subscribe({ next: (pkg) => (this.agentPackage = pkg), error: () => undefined });
    this.refresh();
    // A floor dashboard is left open on a screen, so it refreshes itself. The
    // figures are read live from the shop on every call — there is no cache to
    // go stale, only this interval.
    // A closed day cannot change, so only the running day is re-read.
    this.timer = setInterval(() => { if (!this.date) this.refresh(true); }, 30_000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  setTab(tab: Tab): void {
    this.tab = tab;
    this.refresh(true);
  }

  toggleTable(table: number): void {
    this.openTable = this.openTable === table ? null : table;
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
    this.refresh();
  }

  /** `quiet` keeps the current figures on screen while re-fetching. */
  refresh(quiet = false): void {
    if (!quiet) this.loading = true;
    this.api.overview(this.storeId, this.date || undefined).subscribe({
      next: (overview) => {
        this.overview = overview;
        if (!overview.archive && overview.businessDate) this.runningDate = overview.businessDate;
        this.offline = false;
        this.error = '';
        this.loading = false;
      },
      error: (err) => this.fail(err),
    });

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

  /** Top ten only — a long tail of one-offs buries the items that matter. */
  get itemBars(): BarDatum[] {
    return (this.soldItems?.items ?? [])
      .map((i) => ({ label: i.description, value: i.quantity }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }

  tablesInState(state: ShopTable['state']): ShopTable[] {
    return (this.tables?.tables ?? []).filter((t) => t.state === state);
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
      this.error = 'Not signed in, and reloading did not help. The proxy may not be forwarding identity headers.';
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
    this.error = err.error?.error ?? `Could not reach the shop (${err.status})`;
  }
}
