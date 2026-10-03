import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { NEVER, throwError } from 'rxjs';
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
});
