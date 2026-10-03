import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { OperationsService } from '../../core/operations.service';
import { ToastService } from '../../core/toast.service';
import { RecoveryComponent } from './recovery.component';

// plan.md §829: on a containerised install every browser is a non-loopback
// caller, so Enable and Reset always answered 403 "only from localhost" and the
// page never said what to do instead.
describe('RecoveryComponent', () => {
  let fixture: ComponentFixture<RecoveryComponent>;
  let operations: jasmine.SpyObj<OperationsService>;
  const host = () => fixture.nativeElement as HTMLElement;

  function mount(status: { enabled: boolean; available: boolean }): void {
    operations.getRecoveryStatus.and.returnValue(of(status));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    operations = jasmine.createSpyObj('OperationsService', ['getRecoveryStatus', 'enableRecoveryMode', 'disableRecoveryMode', 'resetAdminPassword']);
    await TestBed.configureTestingModule({
      imports: [RecoveryComponent],
      providers: [
        { provide: OperationsService, useValue: operations },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        provideRouter([]),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RecoveryComponent);
  });

  describe('where the dashboard runs in a container (the normal install)', () => {
    beforeEach(() => mount({ enabled: false, available: false }));

    it('says it works only on the box itself, and names the commands', () => {
      const notice = host().querySelector('.recovery-unavailable') as HTMLElement;
      expect(notice.getAttribute('role')).toBe('status');
      expect(notice.textContent).toContain('./start.sh recover reset-password');
      expect(notice.textContent).toContain('./start.sh recover disable-2fa');
    });

    it('turns the buttons and fields off rather than let them answer 403', async () => {
      // ngModel applies [disabled] to its input a microtask after the render.
      await fixture.whenStable();
      fixture.detectChanges();
      const off = host().querySelectorAll('button.btn-outline-warning, button.btn-danger, #recovery-username, #recovery-password');
      expect(off.length).toBe(4);
      expect(Array.from(off).every((el) => (el as HTMLButtonElement).disabled)).toBeTrue();
    });
  });

  describe('where it can work (a bare-metal install)', () => {
    beforeEach(() => mount({ enabled: false, available: true }));

    it('shows no notice and leaves Enable usable', () => {
      expect(host().querySelector('.recovery-unavailable')).toBeNull();
      expect((host().querySelector('button.btn-outline-warning') as HTMLButtonElement).disabled).toBeFalse();
    });
  });

  it('shows nothing and leaves the controls off until the status is known', () => {
    operations.getRecoveryStatus.and.returnValue(new (class { subscribe() { return { unsubscribe() {} }; } })() as never);
    fixture.detectChanges();

    expect(host().querySelector('.recovery-unavailable')).toBeNull();
    expect((host().querySelector('button.btn-outline-warning') as HTMLButtonElement).disabled).toBeTrue();
  });
});
