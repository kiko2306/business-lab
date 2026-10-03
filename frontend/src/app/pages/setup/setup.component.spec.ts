import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { throwError } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { TranslateService } from '../../i18n/translate.service';
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

  it('announces a password mismatch too', () => {
    component['form'].patchValue({ confirmPassword: 'different123' });
    component.submit();
    fixture.detectChanges();

    expect(alert().getAttribute('role')).toBe('alert');
  });
});
