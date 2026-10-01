import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuditLogsComponent } from './audit-logs/audit-logs.component';
import { RecoveryComponent } from './recovery/recovery.component';
import { UsersComponent } from './users/users.component';
import { AuthService } from '../core/auth.service';
import { ConfirmService } from '../core/confirm.service';
import { OperationsService } from '../core/operations.service';
import { SettingsService } from '../core/settings.service';
import { ToastService } from '../core/toast.service';

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

describe('page form controls carry an accessible name', () => {
  let operations: jasmine.SpyObj<OperationsService>;

  beforeEach(() => {
    localStorage.clear();
    operations = jasmine.createSpyObj('OperationsService', [
      'getAuditLogs',
      'getRecoveryStatus',
      'listUsers',
      'listAppAccessOptions',
    ]);
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
    return fixture.nativeElement as HTMLElement;
  };

  it('Audit logs: the filter row names its action, result and date controls', async () => {
    expect(unnamedControls(await render(AuditLogsComponent))).toEqual([]);
  });

  it('Recovery: names the username and password fields', async () => {
    expect(unnamedControls(await render(RecoveryComponent))).toEqual([]);
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
