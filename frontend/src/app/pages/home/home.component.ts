import { AsyncPipe, NgFor, NgIf } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { Capability } from '../../core/capabilities';
import { OperationsService } from '../../core/operations.service';
import { ServiceStateService } from '../../core/service-state.service';
import { TranslatePipe } from '../../i18n/translate.pipe';

interface MenuTile {
  /** Translation keys, not literal text — resolved by the `t` pipe in the template so a language switch re-renders the tile. */
  titleKey: string;
  descriptionKey: string;
  /** Router path the tile links to. */
  link: string;
  /** Decorative — the compact tile layout (plan.md §781) always shows the title too. */
  icon: string;
  /** Hidden unless the signed-in user's role grants this (plan.md §149). */
  capability?: Capability;
  /** Like `capability`, but any one of these is enough (the page's own route guard is any-of). */
  anyCapability?: Capability[];
  /**
   * Spans two columns in the bento grid (§141.2). Reserved for the tiles a
   * user reaches most often, plus one on the closing row so the grid divides
   * evenly (4 doubles + 4 singles = 12 = four clean rows of three).
   */
  wide?: boolean;
  /** Which of the two cheap status reads (plan.md §781) badges this tile, if any. */
  badgeFor?: 'updates' | 'backups';
}

/**
 * The post-login landing view (§131.1): how the box is doing, then a bento menu
 * of the app's areas, each its own route (plan.md §781).
 */
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [AsyncPipe, NgFor, NgIf, RouterLink, TranslatePipe],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
})
export class HomeComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly operations = inject(OperationsService);
  protected readonly serviceState = inject(ServiceStateService);

  /** Only a role that can control apps sees the box's state, and only then is the poll worth running. */
  protected readonly showStatus = this.auth.hasCapability('apps:control');

  /** True once a self-update check has found the box behind its tracked branch. */
  protected updateAvailable = false;
  /** Age in whole days of the last *successful* app-data backup; null until one has ever run. */
  protected lastBackupDaysAgo: number | null = null;

  // Ordered so each row of three is one wide tile and one single.
  private readonly tiles: MenuTile[] = [
    { titleKey: 'home.tiles.apps.title', descriptionKey: 'home.tiles.apps.description', link: '/apps', icon: '🧩', capability: 'apps:control', wide: true },
    { titleKey: 'home.tiles.updates.title', descriptionKey: 'home.tiles.updates.description', link: '/updates', icon: '🔄', capability: 'system:update', badgeFor: 'updates' },
    { titleKey: 'home.tiles.backups.title', descriptionKey: 'home.tiles.backups.description', link: '/backups', icon: '💾', capability: 'backups:manage', wide: true, badgeFor: 'backups' },
    { titleKey: 'home.tiles.users.title', descriptionKey: 'home.tiles.users.description', link: '/users', icon: '👥', capability: 'users:manage' },
    // Networking used to be its own tile onto the same /settings page; one tile now, gated like the route.
    { titleKey: 'home.tiles.settings.title', descriptionKey: 'home.tiles.settings.description', link: '/settings', icon: '⚙️', anyCapability: ['settings:manage', 'exposure:settings'], wide: true },
    { titleKey: 'home.tiles.utils.title', descriptionKey: 'home.tiles.utils.description', link: '/utils', icon: '🧰', capability: 'apps:control' },
    { titleKey: 'home.tiles.account.title', descriptionKey: 'home.tiles.account.description', link: '/account', icon: '👤', wide: true },
    { titleKey: 'home.tiles.auditLogs.title', descriptionKey: 'home.tiles.auditLogs.description', link: '/audit-logs', icon: '📜', capability: 'audit:view' },
  ];

  ngOnInit(): void {
    if (this.showStatus) this.serviceState.startPolling();

    // One-off reads, not polled — these change rarely, unlike app state
    // (plan.md §781). Each is cheap enough to run on every visit: the update
    // check is a cached value refreshed every 6h, not a live fetch, and the
    // backup one is a single indexed query with no Kopia round trip.
    if (this.auth.hasCapability('system:update')) {
      this.operations.getSelfUpdateStatus().subscribe({
        next: (status) => (this.updateAvailable = (status.check?.commitsBehind ?? 0) > 0),
        // Non-fatal: the tile just shows no badge.
        error: () => {},
      });
    }
    if (this.auth.hasCapability('backups:manage')) {
      this.operations.getLastSuccessfulBackup().subscribe({
        next: ({ lastSuccessfulAppData }) => {
          this.lastBackupDaysAgo = lastSuccessfulAppData
            ? Math.floor((Date.now() - new Date(lastSuccessfulAppData.at).getTime()) / (24 * 60 * 60 * 1000))
            : null;
        },
        error: () => {},
      });
    }
  }

  ngOnDestroy(): void {
    if (this.showStatus) this.serviceState.stopPolling();
  }

  /** Tiles the current role can reach. */
  protected get visibleTiles(): MenuTile[] {
    return this.tiles.filter((tile) => {
      if (tile.anyCapability) return tile.anyCapability.some((c) => this.auth.hasCapability(c));
      return !tile.capability || this.auth.hasCapability(tile.capability);
    });
  }

  /**
   * The bento spans (§141.2) only divide evenly with the full eight tiles.
   * Once the list is filtered for a lesser role, drop back to a plain grid.
   */
  protected get useBento(): boolean {
    return this.visibleTiles.length === this.tiles.length;
  }
}
