import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { UsersComponent } from './users.component';
import { AuthService } from '../../core/auth.service';
import { ConfirmService } from '../../core/confirm.service';
import { OperationsService } from '../../core/operations.service';
import { SettingsService } from '../../core/settings.service';
import { ToastService } from '../../core/toast.service';

// plan.md §813 (P1): delete said only "This cannot be undone", revoking an app
// showed no diff, and a too-short password was caught after Save, as a toast.
// An owner about to remove someone should read what that does, where they act.
const options = [
  { serviceName: 'paperless', label: 'Paperless', hostname: null, requiredGroups: [] },
  { serviceName: 'kimai', label: 'Kimai', hostname: null, requiredGroups: [] },
  { serviceName: 'nocodb', label: 'NocoDB', hostname: null, requiredGroups: [] },
];
const ana = { id: 7, username: 'ana', email: 'ana@b.pt', created_at: '2026-01-01', roles: ['user'], capabilities: [], appAccess: ['paperless', 'kimai'], active: true };
const bia = { ...ana, id: 8, username: 'bia', appAccess: [] };

describe('Users page says what an action does', () => {
  let confirm: jasmine.SpyObj<ConfirmService>;
  let component: {
    deleteUser(user: unknown): void;
    startAccessEdit(user: unknown): void;
    startPasswordReset(id: number): void;
    accessApps: Record<string, boolean>;
    resetPasswordValue: string;
  };
  let element: HTMLElement;
  let detect: () => void;

  beforeEach(async () => {
    localStorage.clear();
    confirm = jasmine.createSpyObj('ConfirmService', ['ask']);
    confirm.ask.and.resolveTo(false);
    const operations = jasmine.createSpyObj('OperationsService', ['listUsers', 'listAppAccessOptions']);
    operations.listUsers.and.returnValue(of({ items: [ana, bia] }));
    operations.listAppAccessOptions.and.returnValue(of({ items: options }));
    await TestBed.configureTestingModule({
      imports: [UsersComponent],
      providers: [
        provideRouter([]),
        { provide: OperationsService, useValue: operations },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        { provide: SettingsService, useValue: { getMailSettings: () => of({ configured: true }) } },
        { provide: AuthService, useValue: { user$: of({ id: 1 }), hasCapability: () => of(true) } },
        { provide: ConfirmService, useValue: confirm },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(UsersComponent);
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
    element.querySelectorAll<HTMLButtonElement>('.panel__toggle[aria-expanded="false"]').forEach((toggle) => toggle.click());
    fixture.detectChanges();
    component = fixture.componentInstance as unknown as typeof component;
    detect = () => fixture.detectChanges();
  });

  afterEach(() => localStorage.clear());

  it('delete names the apps the person loses and that app-side accounts stay', () => {
    component.deleteUser(ana);
    const message = confirm.ask.calls.mostRecent().args[0].message;
    expect(message).toContain('Paperless, Kimai');
    expect(message).toContain('dashboard');
    expect(message).toContain('not removed');
  });

  it('delete for someone with no apps still says what goes, without an empty app list', () => {
    component.deleteUser(bia);
    const message = confirm.ask.calls.mostRecent().args[0].message;
    expect(message).toContain('dashboard');
    expect(message).not.toContain('not removed');
  });

  it('the access editor shows what saving removes and adds, and nothing when unchanged', () => {
    component.startAccessEdit(ana);
    detect();
    expect(element.querySelector('.access-change')).toBeNull();

    component.accessApps['kimai'] = false;
    component.accessApps['nocodb'] = true;
    detect();
    expect(element.querySelector('.access-change--remove')?.textContent).toContain('Kimai');
    expect(element.querySelector('.access-change--remove')?.textContent).not.toContain('Paperless');
    expect(element.querySelector('.access-change--add')?.textContent).toContain('NocoDB');
  });

  it('the password editor states the 8-character rule up front and holds Save until it is met', () => {
    component.startPasswordReset(7);
    detect();
    expect(element.querySelector('.reset-hint')?.textContent).toContain('8 characters');
    const save = element.querySelector('.reset-save') as HTMLButtonElement;
    expect(save.disabled).toBeTrue();

    component.resetPasswordValue = 'longenough';
    detect();
    expect(save.disabled).toBeFalse();
  });
});
