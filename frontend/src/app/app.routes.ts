import { Routes } from '@angular/router';
import { ShellComponent } from './layout/shell/shell.component';
import { HomeComponent } from './pages/home/home.component';
import { AppsComponent } from './pages/apps/apps.component';
import { BackupsComponent } from './pages/backups/backups.component';
import { ExposureComponent } from './pages/exposure/exposure.component';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { LoginComponent } from './pages/login/login.component';
import { SetupComponent } from './pages/setup/setup.component';
import { AccountComponent } from './pages/account/account.component';
import { AuditLogsComponent } from './pages/audit-logs/audit-logs.component';
import { UsersComponent } from './pages/users/users.component';
import { RecoveryComponent } from './pages/recovery/recovery.component';
import { authGuard } from './guards/auth.guard';
import { guestGuard } from './guards/guest.guard';

export const routes: Routes = [
  {
    path: 'login',
    component: LoginComponent,
    canActivate: [guestGuard],
  },
  {
    path: 'setup',
    component: SetupComponent,
    canActivate: [guestGuard],
  },
  {
    // Recovery is reached while locked out, so it stays outside the shell.
    path: 'recovery',
    component: RecoveryComponent,
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
        component: HomeComponent,
      },
      {
        path: 'apps',
        component: AppsComponent,
      },
      {
        path: 'backups',
        component: BackupsComponent,
      },
      {
        path: 'exposure',
        component: ExposureComponent,
      },
      {
        // What is left of the one-page dashboard: the stack-wide sections
        // (Settings, Health, Utils) not yet on their own routes.
        path: 'dashboard',
        component: DashboardComponent,
      },
      {
        path: 'audit-logs',
        component: AuditLogsComponent,
      },
      {
        path: 'users',
        component: UsersComponent,
      },
      {
        path: 'account',
        component: AccountComponent,
      },
    ],
  },
  {
    path: '**',
    redirectTo: '',
  },
];
