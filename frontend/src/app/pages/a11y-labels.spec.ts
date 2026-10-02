import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuditLogsComponent } from './audit-logs/audit-logs.component';
import { BackupsComponent } from './backups/backups.component';
import { SettingsComponent } from './settings/settings.component';
import { SocialComponent } from './social/social.component';
import { RecoveryComponent } from './recovery/recovery.component';
import { UsersComponent } from './users/users.component';
import { AuthService } from '../core/auth.service';
import { ConfirmService } from '../core/confirm.service';
import { OperationsService } from '../core/operations.service';
import { SettingsService } from '../core/settings.service';
import { ToastService } from '../core/toast.service';
import { SocialService } from '../core/social.service';
import { ServiceStateService } from '../core/service-state.service';

/**
 * Every control a page renders has to say what it is. A placeholder does not
 * count: it disappears the moment someone types, so anyone coming back to a
 * half-filled form has nothing left to read, and a date input or a select
 * never had one to begin with.
 */
function unnamedControls(root: HTMLElement): string[] {
  const controls = Array.from(root.querySelectorAll('input, select, textarea'));
  return controls
    .filter((control) => {
      if (control.getAttribute('type') === 'hidden') return false;
      if (control.getAttribute('aria-label') || control.getAttribute('aria-labelledby')) return false;
      if (control.closest('label')) return false;
      const id = control.getAttribute('id');
      return !(id && root.querySelector(`label[for="${id}"]`));
    })
    .map((control) => `${control.tagName.toLowerCase()}[type=${control.getAttribute('type') ?? 'text'}]`);
}

const settingsStub = () => ({
  loadDeploymentStatus: () => of({ checks: [], outstanding: 0 }),
  loadGeneralSettings: () => of({ timezone: 'Europe/Lisbon', defaultTimezone: 'Europe/Lisbon', timezones: ['Europe/Lisbon'] }),
  getMailSettings: () => of({ configured: false, receiveConfigured: false, smtpHost: null }),
  loadAlertSettings: () =>
    of({
      topics: { crowdsec: 'a', 'critical-service': 'b', netbird: 'c', backup: 'd' },
      enabled: { crowdsec: true, 'critical-service': true, netbird: false, backup: true },
    }),
  loadAiKeys: () => of({ providers: [], features: {} }),
  // The Settings page embeds <app-network-settings>, which loads its own two.
  loadCloudflareSettings: () => of({ configured: false, accountModel: 'single' }),
  loadExposureSettings: () => of({ configured: false, baseDomain: null }),
});

const draft = { id: 1, prompt: 'A post about backups', content: 'Draft text', createdAt: '', updatedAt: '' };

describe('page form controls carry an accessible name', () => {
  let operations: jasmine.SpyObj<OperationsService>;

  beforeEach(() => {
    localStorage.clear();
    operations = jasmine.createSpyObj('OperationsService', [
      'getAuditLogs',
      'getRecoveryStatus',
      'listUsers',
      'listAppAccessOptions',
      'listBackups',
      'listRemoteBackups',
      'getBackupSchedule',
      'getBackupStatus',
    ]);
    operations.listBackups.and.returnValue(of({ items: [] }) as never);
    operations.listRemoteBackups.and.returnValue(of({ items: [] }) as never);
    operations.getBackupSchedule.and.returnValue(
      of({ enabled: false, frequency: 'daily', runAtTime: '03:00', retentionCount: 7 }) as never
    );
    operations.getBackupStatus.and.returnValue(
      of({ job: { configured: false }, dumps: [] }) as never
    );
    operations.getAuditLogs.and.returnValue(of({ items: [], total: 0 }) as never);
    operations.getRecoveryStatus.and.returnValue(of({ enabled: false }) as never);
    operations.listUsers.and.returnValue(of({ items: [] }) as never);
    operations.listAppAccessOptions.and.returnValue(of({ items: [] }) as never);
  });

  const render = async (component: unknown, extraProviders: unknown[] = []) => {
    await TestBed.configureTestingModule({
      imports: [component as never],
      providers: [
        provideRouter([]),
        { provide: OperationsService, useValue: operations },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        ...(extraProviders as never[]),
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(component as never);
    fixture.detectChanges();
    // Panels are collapsed by default, so their controls are not in the DOM
    // until the page is opened up — without this the assertions pass by
    // finding nothing at all.
    const element = fixture.nativeElement as HTMLElement;
    for (const toggle of Array.from(element.querySelectorAll('.panel__toggle'))) {
      (toggle as HTMLButtonElement).click();
    }
    fixture.detectChanges();
    return element;
  };

  it('Audit logs: the filter row names its action, result and date controls', async () => {
    expect(unnamedControls(await render(AuditLogsComponent))).toEqual([]);
  });

  it('Recovery: names the username and password fields', async () => {
    expect(unnamedControls(await render(RecoveryComponent))).toEqual([]);
  });

  it('Settings: names every control, including the alert switches', async () => {
    // The switch that turns an alert category off is a bare checkbox; the
    // label beside it points at the topic *text field*, not the switch.
    const element = await render(SettingsComponent, [
      { provide: SettingsService, useValue: settingsStub() },
      { provide: AuthService, useValue: { hasCapability: () => of(true) } },
    ]);
    expect(unnamedControls(element)).toEqual([]);
  });

  it('Content: names each draft editor', async () => {
    const element = await render(SocialComponent, [
      { provide: SocialService, useValue: { listDrafts: () => of({ drafts: [draft] }) } },
      { provide: ConfirmService, useValue: jasmine.createSpyObj('ConfirmService', ['ask']) },
    ]);
    expect(unnamedControls(element)).toEqual([]);
  });

  it('Backups: names the schedule and destination fields', async () => {
    const element = await render(BackupsComponent, [
      {
        provide: SettingsService,
        useValue: {
          getBackupTarget: () =>
            of({
              configured: false,
              kind: 'local',
              path: null,
              server: null,
              share: null,
              username: null,
              passwordConfigured: false,
              options: null,
            }),
          getKopiaStatus: () => of({ ok: true, detail: '' }),
        },
      },
      { provide: ServiceStateService, useValue: { services$: of([]), refresh: () => undefined } },
      { provide: ConfirmService, useValue: jasmine.createSpyObj('ConfirmService', ['ask']) },
    ]);
    expect(unnamedControls(element)).toEqual([]);
  });

  // The first version rendered the Users page with no users and no app options,
  // so none of its editors existed to be checked — the audit then found a
  // placeholder-only search box and password field (plan.md §811).
  it('Users: names every editor, with users and apps present and each editor open', async () => {
    operations.listAppAccessOptions.and.returnValue(
      of({ items: [{ serviceName: 'paperless', label: 'Paperless', hostname: null, requiredGroups: [] }] }) as never
    );
    operations.listUsers.and.returnValue(
      of({
        items: [{ id: 7, username: 'ana', email: 'a@b.pt', created_at: '2026-01-01', roles: ['user'], capabilities: [], appAccess: [], active: true }],
      }) as never
    );
    await TestBed.configureTestingModule({
      imports: [UsersComponent],
      providers: [
        provideRouter([]),
        { provide: OperationsService, useValue: operations },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        { provide: SettingsService, useValue: { getMailSettings: () => of({ configured: false }) } },
        { provide: AuthService, useValue: { user$: of(null), hasCapability: () => of(false) } },
        { provide: ConfirmService, useValue: jasmine.createSpyObj('ConfirmService', ['ask']) },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(UsersComponent);
    fixture.detectChanges();
    // The user list starts open now (plan.md §813); only the add-user form is collapsed.
    for (const toggle of Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.panel__toggle[aria-expanded="false"]'))) {
      (toggle as HTMLButtonElement).click();
    }
    fixture.detectChanges();
    const users = fixture.componentInstance as unknown as {
      startPasswordReset(id: number): void;
      startAccessEdit(user: unknown): void;
      startRolesEdit(user: unknown): void;
      items: unknown[];
    };
    users.startPasswordReset(7);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('input[type="password"]')).not.toBeNull();
    expect(unnamedControls(element)).toEqual([]);

    users.startAccessEdit(users.items[0]);
    fixture.detectChanges();
    expect(element.querySelectorAll('input[type="search"]').length).toBeGreaterThan(1);
    expect(unnamedControls(element)).toEqual([]);

    users.startRolesEdit(users.items[0]);
    fixture.detectChanges();
    expect(element.querySelector('.roles-editor input[type="checkbox"]')).not.toBeNull();
    expect(unnamedControls(element)).toEqual([]);
  });

  it('Users: names the new-account username and email fields', async () => {
    const element = await render(UsersComponent, [
      { provide: SettingsService, useValue: { getMailSettings: () => of({ configured: false }) } },
      { provide: AuthService, useValue: { user$: of(null), hasCapability: () => of(false) } },
      { provide: ConfirmService, useValue: jasmine.createSpyObj('ConfirmService', ['ask']) },
    ]);
    expect(unnamedControls(element)).toEqual([]);
  });
});
