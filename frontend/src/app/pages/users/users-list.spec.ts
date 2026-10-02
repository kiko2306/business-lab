import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { UsersComponent } from './users.component';
import { AuthService } from '../../core/auth.service';
import { ConfirmService } from '../../core/confirm.service';
import { OperationsService } from '../../core/operations.service';
import { SettingsService } from '../../core/settings.service';
import { ToastService } from '../../core/toast.service';

// plan.md §813 (P1): Users opened as two closed cards, and an admin's row then
// carried 11+ checkboxes (3 roles, 8 features) that drowned who the person is
// and what they can do. The list opens by default and a row is one line; roles
// and features are edited in their own row, like access and password.
const admin = { id: 2, username: 'ines', email: 'i@b.pt', created_at: '2026-01-01', roles: ['admin'], capabilities: ['apps:control', 'backups:manage'], appAccess: [], active: true };
const staff = { id: 3, username: 'ana', email: 'a@b.pt', created_at: '2026-01-02', roles: ['user'], capabilities: [], appAccess: [], active: true };
const me = { id: 1, username: 'owner', email: 'o@b.pt', created_at: '2026-01-01', roles: ['webmaster'], capabilities: [], appAccess: [], active: true };

describe('Users list is one line per person', () => {
  let component: { startRolesEdit(user: unknown): void; cancelRolesEdit(user: unknown): void; roleDraft: Record<number, Record<string, boolean>> };
  let element: HTMLElement;
  let detect: () => void;
  const rows = () => Array.from(element.querySelectorAll('tbody tr'));
  const row = (name: string) => rows().find((r) => r.textContent?.includes(name)) as HTMLElement;

  beforeEach(async () => {
    localStorage.clear();
    const operations = jasmine.createSpyObj('OperationsService', ['listUsers', 'listAppAccessOptions']);
    operations.listUsers.and.returnValue(of({ items: [me, admin, staff] }));
    operations.listAppAccessOptions.and.returnValue(of({ items: [] }));
    await TestBed.configureTestingModule({
      imports: [UsersComponent],
      providers: [
        provideRouter([]),
        { provide: OperationsService, useValue: operations },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        { provide: SettingsService, useValue: { getMailSettings: () => of({ configured: true }) } },
        { provide: AuthService, useValue: { user$: of({ id: 1 }), hasCapability: () => of(true) } },
        { provide: ConfirmService, useValue: jasmine.createSpyObj('ConfirmService', ['ask']) },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(UsersComponent);
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
    component = fixture.componentInstance as unknown as typeof component;
    detect = () => fixture.detectChanges();
  });

  afterEach(() => localStorage.clear());

  it('shows the accounts without anyone having to open a panel, and leaves the add form closed', () => {
    expect(rows().length).toBe(3);
    expect(element.querySelector('form')).toBeNull();
  });

  it('shows roles as words and no checkbox in a row', () => {
    expect(row('ines').querySelectorAll('input[type="checkbox"]').length).toBe(0);
    expect(row('ines').textContent).toContain('Admin');
    expect(row('ana').textContent).toContain('SSO user');
  });

  it('summarises an admin\'s features as a count instead of listing eight checkboxes', () => {
    expect(row('ines').textContent).toContain('2 of 8 features');
  });

  it('opens the roles and features in their own row on Edit roles, and closes on Cancel', () => {
    (row('ines').querySelector('.edit-roles') as HTMLButtonElement).click();
    detect();
    const editor = element.querySelector('.roles-editor') as HTMLElement;
    expect(editor).not.toBeNull();
    expect(editor.querySelectorAll('input[type="checkbox"]').length).toBe(3 + 8);

    (editor.querySelector('.roles-cancel') as HTMLButtonElement).click();
    detect();
    expect(element.querySelector('.roles-editor')).toBeNull();
  });

  it('does not offer to edit your own roles', () => {
    expect(row('owner').querySelector('.edit-roles')).toBeNull();
  });

  it('forgets an abandoned edit', () => {
    component.startRolesEdit(admin);
    component.roleDraft[2]['webmaster'] = true;
    component.cancelRolesEdit(admin);
    expect(component.roleDraft[2]['webmaster']).toBeFalse();
  });
});
