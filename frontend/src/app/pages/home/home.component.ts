import { AsyncPipe, NgFor, NgIf } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { Capability } from '../../core/capabilities';
import { ServiceStateService } from '../../core/service-state.service';
import { TranslatePipe } from '../../i18n/translate.pipe';

interface MenuTile {
  /** Translation keys, not literal text — resolved by the `t` pipe in the template so a language switch re-renders the tile. */
  titleKey: string;
  descriptionKey: string;
  /** Router path the tile links to. */
  link: string;
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
  protected readonly serviceState = inject(ServiceStateService);

  /** Only a role that can control apps sees the box's state, and only then is the poll worth running. */
  protected readonly showStatus = this.auth.hasCapability('apps:control');

  // Ordered so each row of three is one wide tile and one single.
  private readonly tiles: MenuTile[] = [
    { titleKey: 'home.tiles.apps.title', descriptionKey: 'home.tiles.apps.description', link: '/apps', capability: 'apps:control', wide: true },
    { titleKey: 'home.tiles.updates.title', descriptionKey: 'home.tiles.updates.description', link: '/updates', capability: 'system:update' },
    { titleKey: 'home.tiles.backups.title', descriptionKey: 'home.tiles.backups.description', link: '/backups', capability: 'backups:manage', wide: true },
    { titleKey: 'home.tiles.users.title', descriptionKey: 'home.tiles.users.description', link: '/users', capability: 'users:manage' },
    // Networking used to be its own tile onto the same /settings page; one tile now, gated like the route.
    { titleKey: 'home.tiles.settings.title', descriptionKey: 'home.tiles.settings.description', link: '/settings', anyCapability: ['settings:manage', 'exposure:settings'], wide: true },
    { titleKey: 'home.tiles.utils.title', descriptionKey: 'home.tiles.utils.description', link: '/utils', capability: 'apps:control' },
    { titleKey: 'home.tiles.account.title', descriptionKey: 'home.tiles.account.description', link: '/account', wide: true },
    { titleKey: 'home.tiles.auditLogs.title', descriptionKey: 'home.tiles.auditLogs.description', link: '/audit-logs', capability: 'audit:view' },
  ];

  ngOnInit(): void {
    if (this.showStatus) this.serviceState.startPolling();
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
