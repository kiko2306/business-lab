import { AsyncPipe, CommonModule } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ServiceStateService } from '../../core/service-state.service';
import { ServiceCardComponent } from '../../components/service-card/service-card.component';
import { PanelComponent } from '../../components/panel/panel.component';
import { SectionCollapseService } from '../../core/section-collapse.service';
import { ServiceAction, ServiceCategory, ServiceStatus } from '../../core/models';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { TranslateService } from '../../i18n/translate.service';

// Fixed display order; anything without a recognized category (or an older
// cached API response predating this field) falls back to "Other" at the end.
const CATEGORY_ORDER: ServiceCategory[] = [
  'Networking & Security',
  'Monitoring & Management',
  'Media',
  'Backup & Storage',
  'Productivity',
  'Home Automation',
  'Development',
  'Wintouch Interop',
];

// Fixed display order for the apps list's category groups.
export const CATEGORY_DISPLAY_ORDER: readonly string[] = [...CATEGORY_ORDER, 'Other'];

function orderCategories(present: Iterable<string>): string[] {
  const seen = new Set(present);
  return CATEGORY_DISPLAY_ORDER.filter((category) => seen.has(category));
}

export interface ServiceGroup {
  category: string;
  services: ServiceStatus[];
}

// Free-text filter for the "All apps" list. Matches a space-separated query
// against name/label/description/category so "media jelly" narrows the same
// way typing either word alone would. Empty query returns everything.
export function filterServices(
  services: ServiceStatus[],
  query: string,
  state: ServiceStatus['state'] | null = null,
): ServiceStatus[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length && !state) {
    return services;
  }
  return services.filter((service) => {
    if (state && service.state !== state) {
      return false;
    }
    const haystack = [service.name, service.label, service.description, service.category ?? '']
      .join(' ')
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export const hasIssue = (services: ServiceStatus[]): boolean => services.some((s) => s.state === 'error');

function groupServicesByCategory(services: ServiceStatus[]): ServiceGroup[] {
  const byCategory = new Map<string, ServiceStatus[]>();
  for (const service of services) {
    const category = service.category ?? 'Other';
    const bucket = byCategory.get(category);
    if (bucket) {
      bucket.push(service);
    } else {
      byCategory.set(category, [service]);
    }
  }

  return orderCategories(byCategory.keys()).map((category) => ({ category, services: byCategory.get(category)! }));
}

/**
 * The Apps area (§131.1): the service registry — summary counts, the
 * running-apps port table, and the full start/stop/configure list. The first
 * area split off the single-page dashboard onto its own route (§136); the
 * one-page `DashboardComponent` is gone entirely as of §145.
 */
@Component({
    selector: 'app-apps',
    imports: [CommonModule, AsyncPipe, FormsModule, ServiceCardComponent, PanelComponent, TranslatePipe],
    templateUrl: './apps.component.html',
    styleUrl: './apps.component.css'
})
export class AppsComponent implements OnInit, OnDestroy {
  protected readonly serviceState = inject(ServiceStateService);
  protected readonly collapse = inject(SectionCollapseService);
  protected readonly translate = inject(TranslateService);

  protected readonly hasIssue = hasIssue;

  // Bound to the "All apps" search box. While it is non-empty every category
  // is force-expanded (isAppGroupCollapsed), so a match is never hidden inside
  // a collapsed section.
  readonly appFilter = signal('');
  // Set by the Issues/Stopped summary tiles; click the active tile again to clear.
  readonly stateFilter = signal<ServiceStatus['state'] | null>(null);

  private readonly services = toSignal(this.serviceState.services$, { initialValue: [] as ServiceStatus[] });

  /**
   * The list the template renders. Filtering and grouping used to be two
   * function calls *in* the template, so ~50 services were re-filtered,
   * re-bucketed and re-ordered on every change-detection pass — every
   * keystroke and every click anywhere on the page — rather than when the data
   * or the filter actually moved. As a computed it runs once per real change
   * and hands back the same arrays until then.
   */
  readonly groups = computed<ServiceGroup[]>(() =>
    groupServicesByCategory(filterServices(this.services() ?? [], this.appFilter(), this.stateFilter()))
  );

  readonly matchCount = computed(() => this.groups().reduce((total, group) => total + group.services.length, 0));

  ngOnInit(): void {
    this.serviceState.startPolling();
  }

  ngOnDestroy(): void {
    this.serviceState.stopPolling();
  }

  refresh(): void {
    this.serviceState.refresh();
  }

  handleAction(serviceName: string, action: ServiceAction): void {
    if (action === 'start') {
      void this.serviceState.startService(serviceName);
      return;
    }

    this.serviceState.stopService(serviceName);
  }

  async startWithNeeds(serviceName: string): Promise<void> {
    const services = (await firstValueFrom(this.serviceState.services$)) ?? [];
    await this.serviceState.startWithDependencies(serviceName, services);
  }

  trackByService(_index: number, service: { name: string }): string {
    return service.name;
  }

  trackByCategory(_index: number, group: { category: string }): string {
    return group.category;
  }

  trackByPortRow(_index: number, row: { serviceName: string }): string {
    return row.serviceName;
  }

  // Each "All apps" category group starts collapsed like everything else; an
  // active search forces them open so a match is never hidden in a collapsed
  // group.
  isAppGroupCollapsed(key: string, services: ServiceStatus[] = []): boolean {
    // A failed app is what the owner most needs to see: never hide it.
    return this.appFilter().trim() || this.stateFilter() || hasIssue(services)
      ? false
      : this.collapse.isCollapsed(key);
  }

  toggleStateFilter(state: 'running' | 'error' | 'stopped'): void {
    this.stateFilter.update((current) => (current === state ? null : state));
  }

  toggleAppGroup(key: string): void {
    this.collapse.toggle(key);
  }

  clearAppFilter(): void {
    this.appFilter.set('');
    this.stateFilter.set(null);
  }
}
