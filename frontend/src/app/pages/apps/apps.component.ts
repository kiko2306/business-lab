import { AsyncPipe, CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ServiceStateService } from '../../core/service-state.service';
import { ServiceCardComponent } from '../../components/service-card/service-card.component';
import { PanelComponent } from '../../components/panel/panel.component';
import { SectionCollapseService } from '../../core/section-collapse.service';
import { ServiceAction, ServiceCategory, ServiceStatus } from '../../core/models';

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
];

// Fixed display order for both the running-apps table and the full apps
// list, so the same category shows up in the same place in both.
const CATEGORY_DISPLAY_ORDER: readonly string[] = [...CATEGORY_ORDER, 'Other'];

function orderCategories(present: Iterable<string>): string[] {
  const seen = new Set(present);
  return CATEGORY_DISPLAY_ORDER.filter((category) => seen.has(category));
}

interface ServiceGroup {
  category: string;
  services: ServiceStatus[];
}

interface ServicePortRow {
  serviceName: string;
  label: string;
  url: string | null;
  ports: ServiceStatus['ports'];
}

interface ServicePortGroup {
  category: string;
  rows: ServicePortRow[];
}

// One row per running app for the "running apps" table — all of an app's
// published ports are listed together instead of one row each. The URL is the
// app's public hostname when it's exposed (no port — Cloudflare/NPM strip that
// away), otherwise a LAN link to its web-UI port on whatever host is serving
// this dashboard; either gets the registry's `webPath` appended when the UI
// isn't at the bare root (e.g. Pi-hole's `/admin`, NPM's admin panel on :81).
// Rows are grouped by the same category as the full apps list so the two views
// line up.
function buildRunningAppUrl(service: ServiceStatus): string | null {
  const suffix = service.webPath ?? '';
  if (service.exposedHostname) {
    return `https://${service.exposedHostname}${suffix}`;
  }
  if (service.webPort) {
    return `http://${window.location.hostname}:${service.webPort}${suffix}`;
  }
  return null;
}

function groupRunningPortsByCategory(services: ServiceStatus[]): ServicePortGroup[] {
  const byCategory = new Map<string, ServicePortRow[]>();
  for (const service of services) {
    if (service.state !== 'running' || !service.ports?.length) {
      continue;
    }
    const category = service.category ?? 'Other';
    const url = buildRunningAppUrl(service);
    const row: ServicePortRow = { serviceName: service.name, label: service.label, url, ports: service.ports };
    const bucket = byCategory.get(category);
    if (bucket) {
      bucket.push(row);
    } else {
      byCategory.set(category, [row]);
    }
  }

  for (const rows of byCategory.values()) {
    rows.sort((a, b) => a.label.localeCompare(b.label));
  }

  return orderCategories(byCategory.keys()).map((category) => ({ category, rows: byCategory.get(category)! }));
}

// Free-text filter for the "All apps" list. Matches a space-separated query
// against name/label/description/category so "media jelly" narrows the same
// way typing either word alone would. Empty query returns everything.
export function filterServices(services: ServiceStatus[], query: string): ServiceStatus[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) {
    return services;
  }
  return services.filter((service) => {
    const haystack = [service.name, service.label, service.description, service.category ?? '']
      .join(' ')
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

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
  standalone: true,
  imports: [CommonModule, AsyncPipe, FormsModule, ServiceCardComponent, PanelComponent],
  templateUrl: './apps.component.html',
  styleUrl: './apps.component.css',
})
export class AppsComponent implements OnInit, OnDestroy {
  protected readonly serviceState = inject(ServiceStateService);
  protected readonly collapse = inject(SectionCollapseService);

  protected readonly groupServicesByCategory = groupServicesByCategory;
  protected readonly groupRunningPortsByCategory = groupRunningPortsByCategory;
  protected readonly filterServices = filterServices;

  // Bound to the "All apps" search box. While it is non-empty every category
  // is force-expanded (isAppGroupCollapsed), so a match is never hidden inside
  // a collapsed section.
  protected appFilter = '';

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
      this.serviceState.startService(serviceName);
      return;
    }
    if (action === 'update') {
      this.serviceState.updateService(serviceName);
      return;
    }

    this.serviceState.stopService(serviceName);
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
  isAppGroupCollapsed(key: string): boolean {
    return this.appFilter.trim() ? false : this.collapse.isCollapsed(key);
  }

  toggleAppGroup(key: string): void {
    this.collapse.toggle(key);
  }

  clearAppFilter(): void {
    this.appFilter = '';
  }
}
