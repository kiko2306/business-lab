import { Injectable } from '@angular/core';

/**
 * Per-section collapsed/expanded state, persisted to localStorage and shared
 * by every collapsible panel across the app. Keys are namespaced by area
 * ("running:Media", "apps:Media", "backups", …) so nothing collides on the one
 * stored object.
 */
@Injectable({ providedIn: 'root' })
export class SectionCollapseService {
  // v2: every panel now starts collapsed, so state stored under the old key
  // ("dashboard.collapsedSections") — which recorded deliberate *expansions*
  // against the previous defaults — is stale and deliberately dropped.
  private static readonly STORAGE_KEY = 'panels.collapsed.v2';

  // Explicit user choices only, key -> collapsed. A key that is absent falls
  // back to the collapsed-by-default behaviour, so defaults can change without
  // stale localStorage pinning every existing browser to the old behaviour.
  private readonly state = new Map<string, boolean>(this.load());

  /**
   * Collapsed state for `key`. With no explicit user choice recorded it falls
   * back to collapsed (`true`) — a page opens as a list of titled panels the
   * user expands on demand rather than a wall of data.
   */
  isCollapsed(key: string): boolean {
    return this.state.get(key) ?? true;
  }

  toggle(key: string): void {
    this.state.set(key, !this.isCollapsed(key));
    this.persist();
  }

  private load(): [string, boolean][] {
    try {
      const raw = localStorage.getItem(SectionCollapseService.STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean');
      }
      return [];
    } catch {
      return [];
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(
        SectionCollapseService.STORAGE_KEY,
        JSON.stringify(Object.fromEntries(this.state)),
      );
    } catch {
      // Non-fatal: collapse state just won't survive a reload.
    }
  }
}
