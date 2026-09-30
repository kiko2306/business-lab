import { Routes } from '@angular/router';
import { ShellComponent } from './layout/shell/shell.component';
import { authGuard } from './guards/auth.guard';
import { guestGuard } from './guards/guest.guard';
import { requireCapability, requireAnyCapability } from './guards/capability.guard';

// Every page loads on demand (plan.md §789 — the audit's bundle-budget
// finding): each was a static import, so a fresh session downloaded all 18
// pages' code before it could show one. Only the shell (header/nav, always
// needed) and the guards stay eager.
export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent),
    canActivate: [guestGuard],
  },
  {
    path: 'setup',
    loadComponent: () => import('./pages/setup/setup.component').then((m) => m.SetupComponent),
    canActivate: [guestGuard],
  },
  {
    // Recovery is reached while locked out, so it stays outside the shell.
    path: 'recovery',
    loadComponent: () => import('./pages/recovery/recovery.component').then((m) => m.RecoveryComponent),
  },
  {
    // Public invite landing (plan.md §158): reachable signed out, no guard.
    path: 'set-password',
    loadComponent: () => import('./pages/set-password/set-password.component').then((m) => m.SetPasswordComponent),
  },
  {
    // Where a group-denied (403) Authelia request now 302s (plan.md §463):
    // reachable signed out, no guard.
    path: 'access-denied',
    loadComponent: () => import('./pages/access-denied/access-denied.component').then((m) => m.AccessDeniedComponent),
  },
  {
    // The unsubscribe link riding in every sent advert email's footer
    // (plan.md §612): reachable signed out, no guard.
    path: 'unsubscribe/:token',
    loadComponent: () => import('./pages/unsubscribe/unsubscribe.component').then((m) => m.UnsubscribeComponent),
  },
  {
    // The authenticated shell: one header/footer around every signed-in page.
    // The guard runs once here rather than on each child.
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'home',
      },
      {
        path: 'home',
        loadComponent: () => import('./pages/home/home.component').then((m) => m.HomeComponent),
      },
      {
        path: 'apps',
        loadComponent: () => import('./pages/apps/apps.component').then((m) => m.AppsComponent),
        canActivate: [requireCapability('apps:control')],
      },
      {
        path: 'backups',
        loadComponent: () => import('./pages/backups/backups.component').then((m) => m.BackupsComponent),
        canActivate: [requireCapability('backups:manage')],
      },
      {
        path: 'settings',
        loadComponent: () => import('./pages/settings/settings.component').then((m) => m.SettingsComponent),
        canActivate: [requireAnyCapability('settings:manage', 'exposure:settings')],
      },
      {
        // Content generation (plan.md §254 P2). Same capability as Settings —
        // it's the operator driving the product, not a separate grant yet.
        path: 'content',
        loadComponent: () => import('./pages/social/social.component').then((m) => m.SocialComponent),
        canActivate: [requireCapability('settings:manage')],
      },
      {
        path: 'utils',
        loadComponent: () => import('./pages/utils/utils.component').then((m) => m.UtilsComponent),
        canActivate: [requireCapability('apps:control')],
      },
      {
        path: 'audit-logs',
        loadComponent: () => import('./pages/audit-logs/audit-logs.component').then((m) => m.AuditLogsComponent),
        canActivate: [requireCapability('audit:view')],
      },
      {
        path: 'users',
        loadComponent: () => import('./pages/users/users.component').then((m) => m.UsersComponent),
        canActivate: [requireCapability('users:manage')],
      },
      {
        path: 'updates',
        loadComponent: () => import('./pages/self-update/self-update.component').then((m) => m.SelfUpdateComponent),
        canActivate: [requireCapability('system:update')],
      },
      {
        path: 'account',
        loadComponent: () => import('./pages/account/account.component').then((m) => m.AccountComponent),
      },
    ],
  },
  {
    path: '**',
    redirectTo: '',
  },
];
