import { NgFor, NgIf } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

interface MenuTile {
  title: string;
  description: string;
  /** Router path the tile links to. */
  link: string;
  /** Optional in-page anchor on the target route. */
  fragment?: string;
  /**
   * True while the area still lives inside the one-page dashboard and this
   * tile only deep-links into it. Cleared as each area moves onto its own
   * route in later §131.1 slices.
   */
  pending?: boolean;
}

/**
 * The post-login landing view (§131.1): a menu of the dashboard's areas. Apps
 * has its own route; the remaining areas still live in the single `/dashboard`
 * page, so their tiles deep-link into it with a fragment for now and carry an
 * "Opens in …" badge. Each is repointed when its area gets its own route.
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
    },
    {
      title: 'Exposure & networking',
      description: 'Public exposure through Cloudflare and Nginx Proxy Manager, per app.',
      link: '/apps',
      pending: true,
    },
    {
      title: 'Backups & restore',
      description: 'Backup schedule, on-demand runs, and restoring from a snapshot.',
      link: '/dashboard',
      fragment: 'backups',
      pending: true,
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
      description: 'Third-party tokens, the shared mailbox, and other stack-wide settings.',
      link: '/dashboard',
      fragment: 'settings',
      pending: true,
    },
    {
      title: 'Utils',
      description: 'One-off tools such as the LAN device scan and health checks.',
      link: '/dashboard',
      fragment: 'utils',
      pending: true,
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
    },
  ];
}
