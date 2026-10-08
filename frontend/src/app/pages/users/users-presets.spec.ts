import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { UsersComponent } from './users.component';
import { AuthService } from '../../core/auth.service';
import { ConfirmService } from '../../core/confirm.service';
import { OperationsService } from '../../core/operations.service';
import { SettingsService } from '../../core/settings.service';
import { ToastService } from '../../core/toast.service';

// plan.md §826 (§813 fix 5): "SSO user", "Webmaster" and eight raw features.
// Roles get plain names with a line saying what they are; features get presets.
const admin = { id: 2, username: 'ines', email: 'i@b.pt', created_at: '2026-01-01', roles: ['admin'], capabilities: ['apps:control', 'apps:config'], appAccess: [], active: true };
const staff = { id: 3, username: 'ana', email: 'a@b.pt', created_at: '2026-01-02', roles: ['user'], capabilities: [], appAccess: [], active: true };
const me = { id: 1, username: 'owner', email: 'o@b.pt', created_at: '2026-01-01', roles: ['webmaster'], capabilities: [], appAccess: [], active: true };

describe('Users roles and presets', () => {
  let element: HTMLElement;
  let detect: () => void;
  // ngModel writes a checkbox's state a microtask after the change, so a spec
  // that reads `checked` straight after a click must let it settle first.
  let settle: () => Promise<void>;
  const row = (name: string) =>
    Array.from(element.querySelectorAll('tbody tr')).find((r) => r.textContent?.includes(name)) as HTMLElement;
  const editor = () => element.querySelector('.roles-editor') as HTMLElement;
  const preset = (label: string) =>
    Array.from(editor().querySelectorAll('button.preset')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
  const ticked = () =>
    Array.from(editor().querySelectorAll('input[id^="cap-"]'))
      .filter((i) => (i as HTMLInputElement).checked)
      .map((i) => i.id.replace('cap-2-', ''))
      .sort();

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
        { provide: AuthService, useValue: { user$: of({ id: 1 }), hasCapability: () => of(true), isWebmaster: () => true } },
        { provide: ConfirmService, useValue: jasmine.createSpyObj('ConfirmService', ['ask']) },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(UsersComponent);
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
    detect = () => fixture.detectChanges();
    settle = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    (row('ines').querySelector('.edit-roles') as HTMLButtonElement).click();
    detect();
  });

  afterEach(() => localStorage.clear());

  it('names the roles in plain words, each with a line saying what it is', () => {
    const text = editor().textContent ?? '';
    expect(text).toContain('Full admin');
    expect(text).toContain('Every feature, always.');
    expect(text).toContain('App user');
    expect(text).toContain('Signs in to apps only');
    expect(element.textContent).not.toContain('SSO user');
    expect(element.textContent).not.toContain('Webmaster');
  });

  it('offers three presets and marks none as pressed while the boxes are custom', () => {
    const buttons = Array.from(editor().querySelectorAll('button.preset'));
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Everything', 'Day to day', 'View only']);
    expect(buttons.every((b) => b.getAttribute('aria-pressed') === 'false')).toBeTrue();
    expect(editor().textContent).toContain('Custom');
  });

  it('ticks exactly the preset\'s features when one is chosen, and shows it pressed', async () => {
    preset('Day to day').click();
    await settle();

    expect(ticked()).toEqual(['apps:control', 'audit:view', 'backups:manage']);
    expect(preset('Day to day').getAttribute('aria-pressed')).toBe('true');
    expect(editor().textContent).not.toContain('Custom');
  });

  it('lets a preset be adjusted afterwards, and says Custom again', async () => {
    preset('Everything').click();
    await settle();
    expect(ticked().length).toBe(8);

    (editor().querySelector('#cap-2-apps\\:config') as HTMLInputElement).click();
    await settle();
    expect(preset('Everything').getAttribute('aria-pressed')).toBe('false');
    expect(editor().textContent).toContain('Custom');
  });

  it('keeps an unsaved preset out of the saved features until Save', () => {
    preset('View only').click();
    detect();

    expect(row('ines').textContent).toContain('2 of 8 features');
    expect(editor().querySelector('button.btn-primary')).not.toBeNull();
  });
});
