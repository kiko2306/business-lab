import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { LoginComponent } from './login.component';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { AuthResponse } from '../../core/models';

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let component: LoginComponent;
  let authService: jasmine.SpyObj<AuthService>;
  let router: Router;
  let toastService: jasmine.SpyObj<ToastService>;

  beforeEach(async () => {
    authService = jasmine.createSpyObj('AuthService', ['login', 'isSetupRequired']);
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

  it('logs in, shows a success toast, and navigates to the dashboard on success', () => {
    authService.login.and.returnValue(of({ user: { id: 1, username: 'admin' }, accessToken: 'a', refreshToken: 'r' } as AuthResponse));
    component['form'].setValue({ username: 'admin', password: 'password123' });

    component.submit();

    expect(authService.login).toHaveBeenCalledWith('admin', 'password123');
    expect(toastService.success).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/dashboard');
    expect(component['submitting']).toBe(false);
  });

  it('surfaces an error message and stops submitting when login fails', () => {
    authService.login.and.returnValue(throwError(() => new Error('Unable to sign in.')));
    component['form'].setValue({ username: 'admin', password: 'wrong-password' });

    component.submit();

    expect(component['errorMessage']).toBe('Unable to sign in.');
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
});
