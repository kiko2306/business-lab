import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { NEVER, of, throwError } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { TranslateService } from '../../i18n/translate.service';
import { SetPasswordComponent } from './set-password.component';

// plan.md §827: a dead invitation link read "This invitation link is no longer
// valid…" in English on the pt-PT page, in a bar nothing announced.
describe('SetPasswordComponent with a dead link', () => {
  let fixture: ComponentFixture<SetPasswordComponent>;
  let auth: jasmine.SpyObj<AuthService>;

  beforeEach(async () => {
    auth = jasmine.createSpyObj('AuthService', ['getInvitation', 'acceptInvitation']);
    auth.getInvitation.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 410, error: { error: 'This invitation link is no longer valid. Ask for a new one.' } })),
    );
    await TestBed.configureTestingModule({
      imports: [SetPasswordComponent],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        provideRouter([]),
        // After provideRouter, which would otherwise provide the real route.
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => 'spent-token' } } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SetPasswordComponent);
  });

  afterEach(() => TestBed.inject(TranslateService).setLocale('en'));

  const alert = () => (fixture.nativeElement as HTMLElement).querySelector('.alert-danger') as HTMLElement;

  it('announces the dead link', () => {
    fixture.detectChanges();

    expect(alert().getAttribute('role')).toBe('alert');
  });

  it('says it in Portuguese for a pt-PT reader', () => {
    TestBed.inject(TranslateService).setLocale('pt-PT');
    fixture.detectChanges();

    expect(alert().textContent).not.toContain('no longer valid');
    expect(alert().textContent).toContain('convite');
  });

  it('names whom to ask for a new one', () => {
    fixture.detectChanges();

    expect(alert().textContent).toContain('whoever invited you');
  });

  it('announces the "checking your link" wait', () => {
    auth.getInvitation.and.returnValue(NEVER);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[role="status"]')?.textContent).toContain('Checking your link');
  });

  it('leaves a full-width Back to sign in, not a 17px link', () => {
    fixture.detectChanges();

    const back = (fixture.nativeElement as HTMLElement).querySelector('a.btn[href="/login"]') as HTMLElement;
    expect(back.textContent).toContain('Back to sign in');
    expect(back.classList).toContain('w-100');
    expect(back.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });

  // plan.md §827 fix 3: a failed submit was a toast over the header and the
  // form left as it was, with no way out when the link had just died.
  describe('a failed submit with a good link', () => {
    const host = () => fixture.nativeElement as HTMLElement;
    const settle = () => new Promise((resolve) => setTimeout(resolve));

    beforeEach(() => {
      auth.getInvitation.and.returnValue(of({ username: 'ana', email: 'a@b.pt' }));
      fixture.detectChanges();
      fixture.componentInstance['form'].setValue({ password: 'password123', confirmPassword: 'password123' });
    });

    it('says a refused password inside the card, announced, and keeps the form and the cursor', async () => {
      auth.acceptInvitation.and.returnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { error: 'Password too weak' } })));
      fixture.componentInstance.submit();
      fixture.detectChanges();
      await settle();

      const alert = host().querySelector('form .alert-danger') as HTMLElement;
      expect(alert.getAttribute('role')).toBe('alert');
      expect(alert.textContent).not.toContain('Password too weak');
      expect(host().querySelector('form')).not.toBeNull();
      expect(document.activeElement?.id).toBe('spPassword');
    });

    it('swaps the form for the dead-link page, with the way out, when the link just died', () => {
      auth.acceptInvitation.and.returnValue(throwError(() => new HttpErrorResponse({ status: 410, error: { error: 'gone' } })));
      fixture.componentInstance.submit();
      fixture.detectChanges();

      expect(host().querySelector('form')).toBeNull();
      expect(host().querySelector('.alert-danger')?.textContent).toContain('whoever invited you');
      expect(host().querySelector('a.btn[href="/login"]')).not.toBeNull();
    });

    it('does not use a toast for either', () => {
      const toast = TestBed.inject(ToastService) as jasmine.SpyObj<ToastService>;
      auth.acceptInvitation.and.returnValue(throwError(() => new HttpErrorResponse({ status: 400, error: {} })));
      fixture.componentInstance.submit();

      expect(toast.error).not.toHaveBeenCalled();
    });
  });

  describe('choosing a password from a good link', () => {
    const host = () => fixture.nativeElement as HTMLElement;
    beforeEach(() => {
      auth.getInvitation.and.returnValue(of({ username: 'ana', email: 'a@b.pt' }));
      fixture.detectChanges();
    });

    it('says the rule up front, and wires it to the field', () => {
      expect((host().querySelector('#spPassword-hint') as HTMLElement).textContent).toContain('At least 8 characters');
      expect(host().querySelector('#spPassword')?.getAttribute('aria-describedby')).toContain('spPassword-hint');
    });

    it('lets both fields be shown', () => {
      expect(host().querySelector('button[aria-controls="spPassword"]')).not.toBeNull();
      expect(host().querySelector('button[aria-controls="spConfirm"]')).not.toBeNull();
    });

    it('puts the cursor in the password on arrival', async () => {
      await new Promise((resolve) => setTimeout(resolve));
      expect(document.activeElement?.id).toBe('spPassword');
    });
  });
});
