import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { TranslateService } from '../../i18n/translate.service';
import { LoginComponent } from './login.component';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { AuthResponse, MfaChallenge } from '../../core/models';

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let component: LoginComponent;
  let authService: jasmine.SpyObj<AuthService>;
  let router: Router;
  let toastService: jasmine.SpyObj<ToastService>;

  beforeEach(async () => {
    authService = jasmine.createSpyObj('AuthService', ['login', 'completeMfaLogin', 'isSetupRequired']);
    authService.isSetupRequired.and.returnValue(of(false));
    toastService = jasmine.createSpyObj('ToastService', ['success']);

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: ToastService, useValue: toastService },
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.resolveTo(true);
  });

  it('does not call the API and marks fields touched when the form is invalid', () => {
    component.submit();

    expect(authService.login).not.toHaveBeenCalled();
    expect(component['form'].controls.username.touched).toBe(true);
    expect(component['form'].controls.password.touched).toBe(true);
  });

  it('logs in, shows a success toast, and navigates to the menu on success', () => {
    authService.login.and.returnValue(of({ user: { id: 1, username: 'admin' }, accessToken: 'a', refreshToken: 'r' } as AuthResponse));
    component['form'].setValue({ username: 'admin', password: 'password123' });

    component.submit();

    expect(authService.login).toHaveBeenCalledWith('admin', 'password123');
    expect(toastService.success).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/home');
    expect(component['submitting']).toBe(false);
  });

  it('switches to the MFA step on a 202 challenge instead of navigating', () => {
    authService.login.and.returnValue(of({ mfaRequired: true, mfaToken: 'mfa-token' } as MfaChallenge));
    component['form'].setValue({ username: 'admin', password: 'password123' });

    component.submit();

    expect(component['stage']).toBe('mfa');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(component['submitting']).toBe(false);
  });

  it('completes the MFA step with the held token and navigates on success', () => {
    authService.login.and.returnValue(of({ mfaRequired: true, mfaToken: 'mfa-token' } as MfaChallenge));
    authService.completeMfaLogin.and.returnValue(
      of({ user: { id: 1, username: 'admin' }, accessToken: 'a', refreshToken: 'r' } as AuthResponse)
    );
    component['form'].setValue({ username: 'admin', password: 'password123' });
    component.submit();

    component['mfaForm'].setValue({ code: '123456' });
    component.submitMfa();

    expect(authService.completeMfaLogin).toHaveBeenCalledWith('mfa-token', '123456');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/home');
  });

  it('shows an error and stays on the MFA step when the code is rejected', () => {
    authService.login.and.returnValue(of({ mfaRequired: true, mfaToken: 'mfa-token' } as MfaChallenge));
    authService.completeMfaLogin.and.returnValue(throwError(() => new HttpErrorResponse({ status: 401, error: { error: 'That code is not valid.' } })));
    component['form'].setValue({ username: 'admin', password: 'password123' });
    component.submit();

    component['mfaForm'].setValue({ code: '000000' });
    component.submitMfa();

    expect(component['errorMessage']).toContain('That code is not right');
    expect(component['stage']).toBe('mfa');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('"start over" clears the MFA step and returns to credentials', () => {
    authService.login.and.returnValue(of({ mfaRequired: true, mfaToken: 'mfa-token' } as MfaChallenge));
    component['form'].setValue({ username: 'admin', password: 'password123' });
    component.submit();

    component.backToCredentials();

    expect(component['stage']).toBe('credentials');
    expect(component['mfaForm'].controls.code.value).toBe('');
  });

  it('surfaces an error message and stops submitting when login fails', () => {
    authService.login.and.returnValue(throwError(() => new HttpErrorResponse({ status: 401, error: { error: 'Invalid username or password' } })));
    component['form'].setValue({ username: 'admin', password: 'wrong-password' });

    component.submit();

    expect(component['errorMessage']).toContain('username or password is not right');
    expect(component['submitting']).toBe(false);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('hides the "create the initial administrator account" prompt when an admin already exists', () => {
    authService.isSetupRequired.and.returnValue(of(false));
    fixture.detectChanges();

    const link = (fixture.nativeElement as HTMLElement).querySelector('a[href="/setup"]');
    expect(link).toBeNull();
  });

  it('shows the prompt only while the backend reports setup is still required', () => {
    authService.isSetupRequired.and.returnValue(of(true));
    fixture.detectChanges();

    const link = (fixture.nativeElement as HTMLElement).querySelector('a[href="/setup"]');
    expect(link?.textContent).toContain('Create the initial administrator account');
  });

  it('trims whitespace and marks the control dirty when pasting into it', () => {
    fixture.detectChanges();
    const clipboardData = { getData: () => '  admin  ' } as unknown as DataTransfer;
    const event = { clipboardData, preventDefault: () => undefined } as unknown as ClipboardEvent;

    component.sanitizePaste(event, 'username', 64);

    expect(component['form'].controls.username.value).toBe('admin');
    expect(component['form'].controls.username.dirty).toBe(true);
  });

  // plan.md §827 (P1): the failure was a silent bar in the server's English,
  // and focus fell to <body>, so the first Tab left the page.
  describe('a failed sign-in', () => {
    const host = () => fixture.nativeElement as HTMLElement;
    const settle = () => new Promise((resolve) => setTimeout(resolve));
    const wrongPassword = () =>
      throwError(() => new HttpErrorResponse({ status: 401, error: { error: 'Invalid username or password' } }));

    beforeEach(() => {
      authService.isSetupRequired.and.returnValue(of(false));
      fixture.detectChanges();
    });

    afterEach(() => TestBed.inject(TranslateService).setLocale('en'));

    it('announces the failure', () => {
      authService.login.and.callFake(wrongPassword);
      component['form'].setValue({ username: 'admin', password: 'wrong-password' });
      component.submit();
      fixture.detectChanges();

      expect(host().querySelector('.alert-danger')?.getAttribute('role')).toBe('alert');
    });

    it('says it in Portuguese for a pt-PT reader, never the server\'s English', () => {
      TestBed.inject(TranslateService).setLocale('pt-PT');
      authService.login.and.callFake(wrongPassword);
      component['form'].setValue({ username: 'admin', password: 'wrong-password' });
      component.submit();
      fixture.detectChanges();

      const text = host().querySelector('.alert-danger')?.textContent ?? '';
      expect(text).not.toContain('Invalid username or password');
      expect(text).toContain('palavra-passe');
    });

    it('puts the cursor in the password with its text selected, ready to retype', async () => {
      authService.login.and.callFake(wrongPassword);
      component['form'].setValue({ username: 'admin', password: 'wrong-password' });
      component.submit();
      fixture.detectChanges();
      await settle();

      const password = host().querySelector('#password') as HTMLInputElement;
      expect(document.activeElement).toBe(password);
      expect(password.selectionEnd! - password.selectionStart!).toBe('wrong-password'.length);
    });

    it('says to wait when the rate limiter answers', () => {
      authService.login.and.returnValue(throwError(() => new HttpErrorResponse({ status: 429, error: { error: 'Too many requests, please try again later' } })));
      component['form'].setValue({ username: 'admin', password: 'password123' });
      component.submit();

      expect(component['errorMessage']).toContain('15 minutes');
    });

    it('returns to the credentials step when the sign-in timed out, and says why', () => {
      authService.login.and.returnValue(of({ mfaRequired: true, mfaToken: 'mfa-token' } as MfaChallenge));
      authService.completeMfaLogin.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 401, error: { error: 'This login attempt has expired. Start again.' } })),
      );
      component['form'].setValue({ username: 'admin', password: 'password123' });
      component.submit();
      component['mfaForm'].setValue({ code: '123456' });
      component.submitMfa();

      expect(component['stage']).toBe('credentials');
      expect(component['errorMessage']).toContain('timed out');
    });

    it('keeps the cursor in the code field after a wrong code', async () => {
      authService.login.and.returnValue(of({ mfaRequired: true, mfaToken: 'mfa-token' } as MfaChallenge));
      authService.completeMfaLogin.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 401, error: { error: 'That code is not valid.' } })),
      );
      component['form'].setValue({ username: 'admin', password: 'password123' });
      component.submit();
      fixture.detectChanges();
      component['mfaForm'].setValue({ code: '000000' });
      component.submitMfa();
      fixture.detectChanges();
      await settle();

      expect(document.activeElement?.id).toBe('code');
    });
  });

  // plan.md §829 (P1): a locked-out person had no forgot-password link, and the
  // only way back in, a command on the box, was written down nowhere on screen.
  describe('being locked out', () => {
    const locked = () => (fixture.nativeElement as HTMLElement).querySelector('details.locked-out') as HTMLElement | null;

    beforeEach(() => {
      authService.isSetupRequired.and.returnValue(of(false));
      fixture.detectChanges();
    });

    it('offers a Locked out? line on the credentials step, closed until asked', () => {
      expect(locked()?.querySelector('summary')?.textContent).toContain('Locked out?');
      expect(locked()?.hasAttribute('open')).toBeFalse();
    });

    it('tells staff to ask whoever runs the box, and the owner the command to run on it', () => {
      const text = locked()?.textContent ?? '';
      expect(text).toContain('Users page');
      expect(text).toContain('./start.sh recover reset-password');
    });

    it('offers a lost-authenticator line on the code step, with the recovery code first', () => {
      authService.login.and.returnValue(of({ mfaRequired: true, mfaToken: 'mfa-token' } as MfaChallenge));
      component['form'].setValue({ username: 'admin', password: 'password123' });
      component.submit();
      fixture.detectChanges();

      const text = locked()?.textContent ?? '';
      expect(locked()?.querySelector('summary')?.textContent).toContain('Lost your authenticator?');
      expect(text.indexOf('recovery codes')).toBeGreaterThan(-1);
      expect(text).toContain('./start.sh recover disable-2fa');
      expect(text).not.toContain('reset-password');
    });

    it('says it in Portuguese for a pt-PT reader', () => {
      TestBed.inject(TranslateService).setLocale('pt-PT');
      fixture.detectChanges();

      expect(locked()?.querySelector('summary')?.textContent).toContain('Sem acesso?');
      TestBed.inject(TranslateService).setLocale('en');
    });
  });

  // plan.md §827 fix 4.
  describe('on a phone', () => {
    const host = () => fixture.nativeElement as HTMLElement;
    beforeEach(() => {
      authService.isSetupRequired.and.returnValue(of(false));
      fixture.detectChanges();
    });

    it('offers to show the password', () => {
      const toggle = host().querySelector('button[aria-controls="password"]') as HTMLButtonElement;
      expect(toggle.textContent).toContain('Show');
      toggle.click();
      fixture.detectChanges();
      expect((host().querySelector('#password') as HTMLInputElement).type).toBe('text');
    });

    it('puts the cursor in the username on arrival', async () => {
      await new Promise((resolve) => setTimeout(resolve));
      expect(document.activeElement?.id).toBe('username');
    });
  });

  describe('layout', () => {
    beforeEach(() => authService.isSetupRequired.and.returnValue(of(false)));

    it('sits in the shared auth shell, alone: one card, one h1', () => {
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('app-auth-shell')).not.toBeNull();
      expect(root.querySelectorAll('h1').length).toBe(1);
      expect(root.querySelectorAll('.card .card').length).toBe(0);
    });
  });
});
