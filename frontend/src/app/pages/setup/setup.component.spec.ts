import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { throwError } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { TranslateService } from '../../i18n/translate.service';
import { en } from '../../i18n/en';
import { SetupComponent } from './setup.component';

// plan.md §827: a failed setup was a silent bar in the server's English.
describe('SetupComponent failures', () => {
  let fixture: ComponentFixture<SetupComponent>;
  let component: SetupComponent;
  let auth: jasmine.SpyObj<AuthService>;

  beforeEach(async () => {
    auth = jasmine.createSpyObj('AuthService', ['setup']);
    await TestBed.configureTestingModule({
      imports: [SetupComponent],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success']) },
        provideRouter([]),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SetupComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    component['form'].setValue({ username: 'owner', email: 'o@b.pt', password: 'password123', confirmPassword: 'password123' });
  });

  afterEach(() => TestBed.inject(TranslateService).setLocale('en'));

  const fail = (status: number, message: string) =>
    auth.setup.and.returnValue(throwError(() => new HttpErrorResponse({ status, error: { error: message } })));
  const alert = () => (fixture.nativeElement as HTMLElement).querySelector('.alert-danger') as HTMLElement;

  it('announces a failure, and says it in Portuguese for a pt-PT reader', () => {
    TestBed.inject(TranslateService).setLocale('pt-PT');
    fail(409, 'Username already exists');
    component.submit();
    fixture.detectChanges();

    expect(alert().getAttribute('role')).toBe('alert');
    expect(alert().textContent).not.toContain('Username already exists');
    expect(alert().textContent).toContain('utilizador');
  });

  it('says a username is taken, in words that say what to do', () => {
    fail(409, 'Username already exists');
    component.submit();
    fixture.detectChanges();

    expect(alert().textContent).toContain('already taken');
  });

  // plan.md §827 fix 3: set-password flagged a mismatch under the field, setup
  // only as a bar at the top, off-screen on a phone, after the submit.
  describe('a password mismatch', () => {
    beforeEach(() => {
      component['form'].patchValue({ confirmPassword: 'different123' });
      component['form'].controls.confirmPassword.markAsTouched();
      fixture.detectChanges();
    });

    it('is said under the confirm field, announced, before any submit', () => {
      const message = (fixture.nativeElement as HTMLElement).querySelector('#confirmPassword-error') as HTMLElement;
      expect(message.getAttribute('role')).toBe('alert');
      expect(message.textContent).toContain('do not match');
      expect((fixture.nativeElement as HTMLElement).querySelector('.alert-danger')).toBeNull();
    });

    it('holds the submit button, as set-password does', () => {
      const submit = (fixture.nativeElement as HTMLElement).querySelector('button[type="submit"]') as HTMLButtonElement;
      expect(submit.disabled).toBeTrue();
    });
  });

  it('gives the way back to sign in a 44px target, not a 17px inline link', () => {
    const link = (fixture.nativeElement as HTMLElement).querySelector('a[href="/login"]') as HTMLElement;
    expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });

  // plan.md §827 fix 4: the rule appeared only after an error, the 128 meant
  // nothing to a person, and a password could not be seen.
  describe('choosing a password', () => {
    const host = () => fixture.nativeElement as HTMLElement;

    it('says the rule up front, and wires it to the field', () => {
      const hint = host().querySelector('#setupPassword-hint') as HTMLElement;
      expect(hint.textContent).toContain('At least 8 characters');
      expect(host().querySelector('#setupPassword')?.getAttribute('aria-describedby')).toContain('setupPassword-hint');
    });

    it('no longer quotes the upper limit in the error', () => {
      expect(en['setup.passwordError']).not.toContain('128');
    });

    it('lets both password fields be shown', () => {
      expect(host().querySelector('button[aria-controls="setupPassword"]')).not.toBeNull();
      expect(host().querySelector('button[aria-controls="confirmPassword"]')).not.toBeNull();
    });

    it('puts the cursor in the first field on arrival', async () => {
      await new Promise((resolve) => setTimeout(resolve));
      expect(document.activeElement?.id).toBe('setupUsername');
    });
  });
});
