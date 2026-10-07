import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AuditLogsComponent } from './audit-logs.component';
import { OperationsService } from '../../core/operations.service';
import { TranslateService } from '../../i18n/translate.service';
import { SectionCollapseService } from '../../core/section-collapse.service';
import { en } from '../../i18n/en';
import { ptPT } from '../../i18n/pt-pt';

// Every code the backend writes to audit_logs (`action:` in backend/src). A new code with no
// sentence here shows the raw code to the owner (plan.md §854 item 3).
const CODES = [
  'SERVICE_ADMIN_USER_UPDATE', 'SERVICE_ENV_UPDATE', 'SERVICE_RESTART', 'SERVICE_START', 'SERVICE_STOP',
  'SERVICE_UPDATE', 'app_project_removed', 'authelia_access_control_sync', 'authelia_oidc_clients_sync',
  'authelia_users_sync', 'backup_create', 'backup_delete', 'backup_restore', 'backup_snapshot_restore',
  'critical-service.gave-up', 'critical-service.probe-failed', 'critical-service.recovered',
  'critical-service.restarted', 'exposure_deprovision', 'exposure_disable', 'exposure_provision',
  'exposure_reconcile', 'invitation_accepted', 'login', 'login_mfa', 'login_mfa_challenge',
  'login_recovery_code_used', 'logout', 'recovery_create_admin', 'recovery_disable_2fa',
  'recovery_mode_disable', 'recovery_mode_enable', 'recovery_password_reset', 'recovery_reset_password',
  'self_update_complete', 'self_update_reconcile_failed', 'self_update_trigger', 'settings_change', 'setup',
  'totp_activate', 'totp_disable', 'user_access_update', 'user_capabilities_update', 'user_create',
  'user_delete', 'user_invitation_resend', 'user_password_reset', 'user_roles_update',
];

describe('AuditLogsComponent', () => {
  const row = (action: string, result: string) => ({
    id: 1, username: 'ana', action, resource: 'x'.repeat(200), result, created_at: '2026-10-07T10:00:00Z', ip: null,
  });

  function render(locale: 'en' | 'pt-PT', items = [row('user_delete', 'failure')]) {
    TestBed.configureTestingModule({
      providers: [{ provide: OperationsService, useValue: { getAuditLogs: () => of({ items, page: 1, pageSize: 20, total: items.length }) } }],
    });
    TestBed.inject(TranslateService).setLocale(locale);
    TestBed.inject(SectionCollapseService).open('audit:log'); // panels start collapsed
    const fixture = TestBed.createComponent(AuditLogsComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('has a sentence for every action code, in both languages', () => {
    for (const code of CODES) {
      expect(en['auditLogs.action.' + code]).withContext(`en ${code}`).toBeTruthy();
      expect(ptPT['auditLogs.action.' + code]).withContext(`pt-PT ${code}`).toBeTruthy();
    }
  });

  it('puts Result first, shows the action as a sentence and translates the badge', () => {
    const el = render('pt-PT');
    expect(el.querySelector('thead th')!.textContent).toContain(ptPT['auditLogs.table.result']);
    const cells = el.querySelectorAll('tbody tr:first-child td');
    expect(cells[0].textContent).toContain(ptPT['auditLogs.result.failure']);
    expect(el.querySelector('tbody')!.textContent).toContain(ptPT['auditLogs.action.user_delete']);
    expect(el.querySelector('tbody')!.textContent).not.toContain('user_delete');
  });

  it('falls back to the raw code for an unknown action and lets the resource wrap', () => {
    const el = render('en', [row('brand_new_code', 'success')]);
    expect(el.querySelector('tbody')!.textContent).toContain('brand_new_code');
    expect(el.querySelector('td.audit-resource')).not.toBeNull();
  });
});
