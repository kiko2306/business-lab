import { Routes } from '@angular/router';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { LoginComponent } from './pages/login/login.component';
import { SetupComponent } from './pages/setup/setup.component';
import { AuditLogsComponent } from './pages/audit-logs/audit-logs.component';
import { RecoveryComponent } from './pages/recovery/recovery.component';
import { authGuard } from './guards/auth.guard';
import { guestGuard } from './guards/guest.guard';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'dashboard',
  },
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
    path: 'dashboard',
    component: DashboardComponent,
    canActivate: [authGuard],
  },
  {
    path: 'audit-logs',
    component: AuditLogsComponent,
    canActivate: [authGuard],
  },
  {
    path: 'recovery',
    component: RecoveryComponent,
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  },
];
