import { NgFor, NgIf } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

interface MenuTile {
  title: string;
  description: string;
  /** Router path the tile links to. */
  link: string;
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
  imports: [NgFor, NgIf, RouterLink],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
})
export class HomeComponent {
  protected readonly tiles: MenuTile[] = [
    {
      title: 'Apps',
      description: 'The service registry — start, stop, and configure every managed app.',
      link: '/apps',
      wide: true,
    },
    {
      title: 'Exposure & networking',
      description: 'The Cloudflare Tunnel token and first-start provisioning for Nginx Proxy Manager.',
      link: '/exposure',
    },
    {
      title: 'Backups & restore',
      description: 'Backup schedule, on-demand runs, and restoring from a snapshot.',
      link: '/backups',
      wide: true,
    },
    {
      title: 'Updates & version control',
      description: 'Per-app image updates and the deployed Business Lab version.',
      link: '/apps',
      pending: true,
    },
    {
      title: 'Users & roles',
      description: 'Administrator accounts and, ahead, named roles and per-app access.',
      link: '/users',
    },
    {
      title: 'Settings',
      description: 'The timezone, ntfy alert pushes, the shared mailbox, and the backup destination.',
      link: '/settings',
    },
    {
      title: 'Utils',
      description: 'Stack health checks and one-off tools such as the LAN device scan.',
      link: '/utils',
    },
    {
      title: 'Audit logs',
      description: 'A record of user actions and system operations, exportable as CSV.',
      link: '/audit-logs',
    },
    {
      title: 'Account security',
      description: 'Two-factor authentication for your own sign-in.',
      link: '/account',
      wide: true,
    },
  ];
}
