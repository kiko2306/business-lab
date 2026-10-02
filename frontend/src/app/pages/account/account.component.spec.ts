import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { TranslateService } from '../../i18n/translate.service';
import { AccountComponent } from './account.component';
import { OperationsService } from '../../core/operations.service';
import { ToastService } from '../../core/toast.service';
import { ConfirmService } from '../../core/confirm.service';
import { TotpActivateResponse, TotpSetupResponse, TotpStatus } from '../../core/models';

describe('AccountComponent', () => {
  let fixture: ComponentFixture<AccountComponent>;
  let component: AccountComponent;
  let operations: jasmine.SpyObj<OperationsService>;
  let toast: jasmine.SpyObj<ToastService>;
  let confirm: jasmine.SpyObj<ConfirmService>;

  const disabledStatus: TotpStatus = { enabled: false, enrolledAt: null, recoveryCodesRemaining: 0 };
  const enabledStatus: TotpStatus = {
    enabled: true,
    enrolledAt: '2026-09-03T10:00:00.000Z',
    recoveryCodesRemaining: 8,
  };
  const setupResponse: TotpSetupResponse = {
    otpauthUri: 'otpauth://totp/x',
    qrSvg: '<svg viewBox="0 0 21 21"></svg>',
    secret: 'ABCDEF0123456789',
  };

  beforeEach(async () => {
    // SectionCollapseService persists panel state to localStorage; start each
    // test with the panel at its collapsed-by-default state.
    localStorage.clear();

    operations = jasmine.createSpyObj('OperationsService', [
      'getTotpStatus',
      'setupTotp',
      'activateTotp',
      'disableTotp',
    ]);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    confirm = jasmine.createSpyObj('ConfirmService', ['ask']);
    confirm.ask.and.resolveTo(true);
    operations.getTotpStatus.and.returnValue(of(disabledStatus));

    await TestBed.configureTestingModule({
      imports: [AccountComponent],
      providers: [
        { provide: OperationsService, useValue: operations },
        { provide: ToastService, useValue: toast },
        { provide: ConfirmService, useValue: confirm },
        // No ban panel in these tests: it's gated on settings:manage (§546).
        { provide: AuthService, useValue: { hasCapability: () => false } },
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AccountComponent);
    component = fixture.componentInstance;
  });

  // The 2FA content lives inside a collapsible <app-panel> that starts
  // collapsed, so DOM assertions need the panel opened first.
  function openPanel(): void {
    const toggle = (fixture.nativeElement as HTMLElement).querySelector(
      '.panel__toggle',
    ) as HTMLButtonElement | null;
    toggle?.click();
    fixture.detectChanges();
  }

  it('loads status on init and shows the "set up" state when 2FA is off', () => {
    fixture.detectChanges();
    openPanel();

    expect(operations.getTotpStatus).toHaveBeenCalled();
    expect(component['view']).toBe('status');
    const button = (fixture.nativeElement as HTMLElement).querySelector('button.btn-primary');
    expect(button?.textContent).toContain('Set up two-factor authentication');
  });

  it('renders the QR and secret after starting enrolment', () => {
    operations.setupTotp.and.returnValue(of(setupResponse));
    fixture.detectChanges();
    openPanel();

    component.beginSetup();
    fixture.detectChanges();

    expect(component['view']).toBe('enrolling');
    expect(component['secret']).toBe('ABCDEF0123456789');
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.qr svg')).not.toBeNull();
    expect(host.textContent).toContain('ABCDEF0123456789');
  });

  it('shows the recovery codes once after a successful activate', () => {
    operations.setupTotp.and.returnValue(of(setupResponse));
    const activated: TotpActivateResponse = {
      enabled: true,
      recoveryCodes: ['aaaaa-11111', 'bbbbb-22222'],
    };
    operations.activateTotp.and.returnValue(of(activated));
    fixture.detectChanges();
    openPanel();
    component.beginSetup();

    component['activateForm'].setValue({ code: '123456' });
    component.activate();
    fixture.detectChanges();

    expect(operations.activateTotp).toHaveBeenCalledWith('123456');
    expect(component['view']).toBe('recovery-codes');
    expect(toast.success).toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('aaaaa-11111');
  });

  // plan.md §819: the failure used to be a banner at the top of the page with
  // no role, the server's English sentence even in pt-PT, and a wrong disable
  // code answered "Provide a current 6-digit code…" — which reads as "you gave
  // nothing". It now sits under the field that failed, announced, in the
  // person's language, saying what to try.
  const rejected = () => throwError(() => new HttpErrorResponse({ status: 400, error: { error: 'That code is not valid.' } }));
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  it('puts a rejected enrol code beside the field, announced, with no page banner', async () => {
    operations.setupTotp.and.returnValue(of(setupResponse));
    operations.activateTotp.and.callFake(rejected);
    fixture.detectChanges();
    openPanel();
    component.beginSetup();
    fixture.detectChanges();

    component['activateForm'].setValue({ code: '000000' });
    component.activate();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const error = host.querySelector('#activate-code-error') as HTMLElement;
    expect(component['view']).toBe('enrolling');
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toContain('changes every 30 seconds');
    expect(error.textContent).toContain('clock');
    expect(text()).not.toContain('That code is not valid.');
    expect(host.querySelector('.alert-danger')).toBeNull();
    expect(host.querySelector('#activate-code')?.getAttribute('aria-describedby')).toContain('activate-code-error');

    // Focus goes to the field so the next attempt is a keystroke away.
    await new Promise((resolve) => setTimeout(resolve));
    expect(document.activeElement?.id).toBe('activate-code');
  });

  it('says it in Portuguese for a pt-PT reader, never the server\'s English', () => {
    TestBed.inject(TranslateService).setLocale('pt-PT');
    operations.setupTotp.and.returnValue(of(setupResponse));
    operations.activateTotp.and.callFake(rejected);
    fixture.detectChanges();
    openPanel();
    component.beginSetup();
    fixture.detectChanges();

    component['activateForm'].setValue({ code: '000000' });
    component.activate();
    fixture.detectChanges();

    const error = (fixture.nativeElement as HTMLElement).querySelector('#activate-code-error') as HTMLElement;
    expect(error.textContent).toContain('telemóvel');
    expect(text()).not.toContain('That code is not valid.');
    TestBed.inject(TranslateService).setLocale('en');
  });

  it('tells a server failure from a wrong code', () => {
    operations.setupTotp.and.returnValue(of(setupResponse));
    operations.activateTotp.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    fixture.detectChanges();
    openPanel();
    component.beginSetup();
    fixture.detectChanges();

    component['activateForm'].setValue({ code: '000000' });
    component.activate();
    fixture.detectChanges();

    const error = (fixture.nativeElement as HTMLElement).querySelector('#activate-code-error') as HTMLElement;
    expect(error.textContent).toContain('couldn');
    expect(error.textContent).not.toContain('changes every 30 seconds');
  });

  it('puts a wrong disable code beside its field and says what to use', async () => {
    operations.getTotpStatus.and.returnValue(of(enabledStatus));
    operations.disableTotp.and.callFake(rejected);
    fixture.detectChanges();
    openPanel();

    component['disableForm'].setValue({ code: '000000' });
    await component.disable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const error = host.querySelector('#disable-code-error') as HTMLElement;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toContain('recovery codes');
    expect(error.textContent).not.toContain('Provide a current');
    expect(host.querySelector('.alert-danger')).toBeNull();
  });

  it('announces a page-level error such as a failed load', () => {
    operations.getTotpStatus.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.alert-danger')?.getAttribute('role')).toBe('alert');
  });

  it('shows the disable form and the enrolled date when 2FA is on', () => {
    operations.getTotpStatus.and.returnValue(of(enabledStatus));
    fixture.detectChanges();
    openPanel();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('recovery codes left');
    expect(host.querySelector('form')).not.toBeNull();
    expect(host.querySelector('button.btn-outline-danger')?.textContent).toContain('Disable');
  });

  // plan.md §819: turning 2FA off took the account password alone and one click,
  // so a phished password removed the second factor. A code (or a recovery
  // code, for a lost phone) is required, and the person is asked first.
  it('does not ask or call the API to disable when no code is given', async () => {
    operations.getTotpStatus.and.returnValue(of(enabledStatus));
    fixture.detectChanges();

    await component.disable();

    expect(confirm.ask).not.toHaveBeenCalled();
    expect(operations.disableTotp).not.toHaveBeenCalled();
    expect(component['disableError']).toContain('recovery code');
  });

  it('offers no password field when turning 2FA off', () => {
    operations.getTotpStatus.and.returnValue(of(enabledStatus));
    fixture.detectChanges();
    openPanel();

    expect((fixture.nativeElement as HTMLElement).querySelector('input[type="password"]')).toBeNull();
  });

  it('asks first, naming what changes, and does nothing if declined', async () => {
    operations.getTotpStatus.and.returnValue(of(enabledStatus));
    confirm.ask.and.resolveTo(false);
    fixture.detectChanges();

    component['disableForm'].setValue({ code: '654321' });
    await component.disable();

    const options = confirm.ask.calls.mostRecent().args[0];
    expect(options.danger).toBeTrue();
    expect(options.message).toContain('recovery codes stop working');
    expect(operations.disableTotp).not.toHaveBeenCalled();
  });

  it('disables with a code once confirmed, and reloads status', async () => {
    operations.getTotpStatus.and.returnValue(of(enabledStatus));
    operations.disableTotp.and.returnValue(of({ enabled: false }));
    fixture.detectChanges();
    operations.getTotpStatus.and.returnValue(of(disabledStatus));

    component['disableForm'].setValue({ code: ' 654321 ' });
    await component.disable();

    expect(operations.disableTotp).toHaveBeenCalledWith({ code: '654321' });
    expect(toast.success).toHaveBeenCalled();
    expect(component['view']).toBe('status');
    expect(component['status']?.enabled).toBe(false);
  });

  it('sends a recovery code as typed, so a lost phone still has a way out', async () => {
    operations.getTotpStatus.and.returnValue(of(enabledStatus));
    operations.disableTotp.and.returnValue(of({ enabled: false }));
    fixture.detectChanges();

    component['disableForm'].setValue({ code: 'abcd-efgh-ijkl' });
    await component.disable();

    expect(operations.disableTotp).toHaveBeenCalledWith({ code: 'abcd-efgh-ijkl' });
  });
});
