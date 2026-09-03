import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AccountComponent } from './account.component';
import { OperationsService } from '../../core/operations.service';
import { ToastService } from '../../core/toast.service';
import { TotpActivateResponse, TotpSetupResponse, TotpStatus } from '../../core/models';

describe('AccountComponent', () => {
  let fixture: ComponentFixture<AccountComponent>;
  let component: AccountComponent;
  let operations: jasmine.SpyObj<OperationsService>;
  let toast: jasmine.SpyObj<ToastService>;

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
    operations.getTotpStatus.and.returnValue(of(disabledStatus));

    await TestBed.configureTestingModule({
      imports: [AccountComponent],
      providers: [
        { provide: OperationsService, useValue: operations },
        { provide: ToastService, useValue: toast },
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

  it('keeps the enrolling view and surfaces the error when the code is rejected', () => {
    operations.setupTotp.and.returnValue(of(setupResponse));
    operations.activateTotp.and.returnValue(throwError(() => new Error('That code was not accepted.')));
    fixture.detectChanges();
    component.beginSetup();

    component['activateForm'].setValue({ code: '000000' });
    component.activate();

    expect(component['view']).toBe('enrolling');
    expect(component['errorMessage']).toBe('That code was not accepted.');
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

  it('does not call the API to disable when neither a code nor a password is given', () => {
    operations.getTotpStatus.and.returnValue(of(enabledStatus));
    fixture.detectChanges();

    component.disable();

    expect(operations.disableTotp).not.toHaveBeenCalled();
    expect(component['errorMessage']).toContain('current 6-digit code or your account password');
  });

  it('disables with a code and reloads status', () => {
    operations.getTotpStatus.and.returnValue(of(enabledStatus));
    operations.disableTotp.and.returnValue(of({ enabled: false }));
    fixture.detectChanges();
    operations.getTotpStatus.and.returnValue(of(disabledStatus));

    component['disableForm'].setValue({ code: ' 654321 ', password: '' });
    component.disable();

    expect(operations.disableTotp).toHaveBeenCalledWith({ code: '654321' });
    expect(toast.success).toHaveBeenCalled();
    expect(component['view']).toBe('status');
    expect(component['status']?.enabled).toBe(false);
  });

  it('disables with the account password when no code is entered', () => {
    operations.getTotpStatus.and.returnValue(of(enabledStatus));
    operations.disableTotp.and.returnValue(of({ enabled: false }));
    fixture.detectChanges();

    component['disableForm'].setValue({ code: '', password: 'hunter2hunter2' });
    component.disable();

    expect(operations.disableTotp).toHaveBeenCalledWith({ password: 'hunter2hunter2' });
  });
});
