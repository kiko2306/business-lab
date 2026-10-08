import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { UsersComponent } from './users.component';
import { AuthService } from '../../core/auth.service';
import { ConfirmService } from '../../core/confirm.service';
import { OperationsService } from '../../core/operations.service';
import { SettingsService } from '../../core/settings.service';
import { ToastService } from '../../core/toast.service';

// plan.md §873 item 1. An `admin` holds `users:manage` by default, so the page
// offered it Edit roles and Reset password on the webmaster's own row, and a
// Full admin tick in the add form — all three now refused by the API. The UI
// must not offer what the API will refuse.
const owner = { id: 1, username: 'owner', email: 'o@b.pt', created_at: '2026-01-01', roles: ['webmaster'], capabilities: [], appAccess: [], active: true };
const me = { id: 2, username: 'ines', email: 'i@b.pt', created_at: '2026-01-01', roles: ['admin'], capabilities: [], appAccess: [], active: true };
const staff = { id: 3, username: 'ana', email: 'a@b.pt', created_at: '2026-01-02', roles: ['user'], capabilities: [], appAccess: [], active: true };

// Signed in as `me` (id 2) throughout; only the caller's own role changes.
// Configured per spec, never reset by hand: a manual resetTestingModule here
// hands the *next* suite a fresh root injector, and `TranslateService` then
// re-reads a `locale` another spec left in localStorage — which turned four
// unrelated service-card specs Portuguese.
async function renderAs(isWebmaster: boolean) {
  const operations = jasmine.createSpyObj('OperationsService', ['listUsers', 'listAppAccessOptions']);
  operations.listUsers.and.returnValue(of({ items: [owner, me, staff] }));
  operations.listAppAccessOptions.and.returnValue(of({ items: [] }));
  await TestBed.configureTestingModule({
    imports: [UsersComponent],
    providers: [
      provideRouter([]),
      { provide: OperationsService, useValue: operations },
      { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
      { provide: SettingsService, useValue: { getMailSettings: () => of({ configured: true }) } },
      { provide: AuthService, useValue: { user$: of({ id: 2 }), hasCapability: () => of(true), isWebmaster: () => isWebmaster } },
      { provide: ConfirmService, useValue: jasmine.createSpyObj('ConfirmService', ['ask']) },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(UsersComponent);
  fixture.detectChanges();
  return fixture;
}

function page(element: HTMLElement) {
  const rows = () => Array.from(element.querySelectorAll('tbody tr'));
  return {
    buttonText: (name: string) => {
      const row = rows().find((r) => r.textContent?.includes(name)) as HTMLElement;
      return Array.from(row.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
    },
  };
}

describe('Users page as an admin: no webmaster-level actions offered', () => {
  let element: HTMLElement;
  let detect: () => void;

  beforeEach(async () => {
    localStorage.clear();
    const fixture = await renderAs(false);
    element = fixture.nativeElement as HTMLElement;
    detect = () => fixture.detectChanges();
  });

  afterEach(() => localStorage.clear());

  it('hides Edit roles, Reset password and Delete on the webmaster row', () => {
    const { buttonText } = page(element);
    expect(buttonText('owner')).not.toContain('Edit roles');
    expect(buttonText('owner')).not.toContain('Reset password');
    expect(buttonText('owner')).not.toContain('Delete');
  });

  it('leaves an ordinary account fully editable — an admin still runs the roster', () => {
    const { buttonText } = page(element);
    expect(buttonText('ana')).toContain('Edit roles');
    expect(buttonText('ana')).toContain('Reset password');
    expect(buttonText('ana')).toContain('Delete');
  });

  it('drops the Full admin tick from the add form', () => {
    // The add panel starts collapsed; its own toggle is the first on the page.
    (element.querySelector('.panel__toggle') as HTMLButtonElement).click();
    detect();
    expect(element.querySelector('#new-role-admin')).not.toBeNull();
    expect(element.querySelector('#new-role-webmaster')).toBeNull();
  });
});

describe('Users page as a webmaster: everything stays offered', () => {
  let element: HTMLElement;
  let detect: () => void;

  beforeEach(async () => {
    localStorage.clear();
    const fixture = await renderAs(true);
    element = fixture.nativeElement as HTMLElement;
    detect = () => fixture.detectChanges();
  });

  afterEach(() => localStorage.clear());

  it('keeps Edit roles, Reset password and Delete on another webmaster row', () => {
    const { buttonText } = page(element);
    expect(buttonText('owner')).toContain('Edit roles');
    expect(buttonText('owner')).toContain('Reset password');
    expect(buttonText('owner')).toContain('Delete');
  });

  it('keeps the Full admin tick in the add form', () => {
    (element.querySelector('.panel__toggle') as HTMLButtonElement).click();
    detect();
    expect(element.querySelector('#new-role-webmaster')).not.toBeNull();
  });
});
