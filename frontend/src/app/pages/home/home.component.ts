import { NgFor, NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { Capability } from '../../core/capabilities';
import { TranslatePipe } from '../../i18n/translate.pipe';

interface MenuTile {
  /** Translation keys, not literal text — resolved by the `t` pipe in the template so a language switch re-renders the tile. */
  titleKey: string;
  descriptionKey: string;
  /** Router path the tile links to. */
  link: string;
  /** Hidden unless the signed-in user's role grants this (plan.md §149). */
  capability?: Capability;
  /**
   * True while the area has no page of its own yet — the tile deep-links to a
   * stand-in (`/apps`) and shows an "Opens in Apps" badge. Only "Updates &
   * version control" (§131.4) is still pending; cleared when it is built.
   */
  pending?: boolean;
  /**
   * Spans two columns in the bento grid (§141.2). Reserved for the tiles a
   * user reaches most often, plus one on the closing row so the grid divides
   * evenly (3 doubles + 6 singles = 12 = four clean rows of three).
   */
  wide?: boolean;
}

/**
 * The post-login landing view (§131.1): a bento menu of the app's areas, each
 * its own route. "Updates & version control" is the last `pending` tile — the
 * feature is unbuilt (§131.4), so it deep-links to `/apps` with an "Opens in …"
 * badge until it exists.
 */
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [NgFor, NgIf, RouterLink, TranslatePipe],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
})
export class HomeComponent {
  private readonly auth = inject(AuthService);

  private readonly tiles: MenuTile[] = [
    {
      titleKey: 'home.tiles.apps.title',
      descriptionKey: 'home.tiles.apps.description',
      link: '/apps',
      capability: 'apps:control',
      wide: true,
    },
    {
      titleKey: 'home.tiles.networking.title',
      descriptionKey: 'home.tiles.networking.description',
      link: '/settings',
      capability: 'exposure:settings',
    },
    {
      titleKey: 'home.tiles.backups.title',
      descriptionKey: 'home.tiles.backups.description',
      link: '/backups',
      capability: 'backups:manage',
      wide: true,
    },
    {
      titleKey: 'home.tiles.updates.title',
      descriptionKey: 'home.tiles.updates.description',
      link: '/apps',
      capability: 'apps:control',
      pending: true,
    },
    {
      titleKey: 'home.tiles.users.title',
      descriptionKey: 'home.tiles.users.description',
      link: '/users',
      capability: 'users:manage',
    },
    {
      titleKey: 'home.tiles.settings.title',
      descriptionKey: 'home.tiles.settings.description',
      link: '/settings',
      capability: 'settings:manage',
    },
    {
      titleKey: 'home.tiles.utils.title',
      descriptionKey: 'home.tiles.utils.description',
      link: '/utils',
      capability: 'apps:control',
    },
    {
      titleKey: 'home.tiles.auditLogs.title',
      descriptionKey: 'home.tiles.auditLogs.description',
      link: '/audit-logs',
      capability: 'audit:view',
    },
    {
      titleKey: 'home.tiles.account.title',
      descriptionKey: 'home.tiles.account.description',
      link: '/account',
      wide: true,
    },
  ];

  /** Tiles the current role can reach. */
  protected get visibleTiles(): MenuTile[] {
    return this.tiles.filter((tile) => !tile.capability || this.auth.hasCapability(tile.capability));
  }

  /**
   * The bento spans (§141.2) only divide evenly with the full nine tiles.
   * Once the list is filtered for a lesser role, drop back to a plain grid.
   */
  protected get useBento(): boolean {
    return this.visibleTiles.length === this.tiles.length;
  }
}
