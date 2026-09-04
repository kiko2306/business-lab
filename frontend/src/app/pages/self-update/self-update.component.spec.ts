import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { SelfUpdateComponent } from './self-update.component';
import { OperationsService } from '../../core/operations.service';
import { ConfirmService } from '../../core/confirm.service';
import { ToastService } from '../../core/toast.service';
import { SelfUpdateRun, SelfUpdateStatus } from '../../core/models';

describe('SelfUpdateComponent', () => {
  let fixture: ComponentFixture<SelfUpdateComponent>;
  let component: SelfUpdateComponent;
  let operations: jasmine.SpyObj<OperationsService>;
  let confirm: jasmine.SpyObj<ConfirmService>;
  let toast: jasmine.SpyObj<ToastService>;

  const upToDateStatus: SelfUpdateStatus = {
    appVersion: '0.24.0',
    check: { currentCommit: 'abc123def456', remoteCommit: 'abc123def456', commitsBehind: 0, checkedAt: '2026-09-04T10:00:00.000Z' },
    latestRun: null,
  };
  const behindStatus: SelfUpdateStatus = {
    appVersion: '0.24.0',
    check: { currentCommit: 'old111old111', remoteCommit: 'new222new222', commitsBehind: 2, checkedAt: '2026-09-04T10:00:00.000Z' },
    latestRun: null,
  };
  const runningRun: SelfUpdateRun = {
    id: 1,
    state: 'building',
    fromCommit: 'old111old111',
    toCommit: null,
    errorMessage: null,
    startedAt: '2026-09-04T10:01:00.000Z',
    finishedAt: null,
  };

  beforeEach(async () => {
    // SectionCollapseService persists panel state to localStorage; start each
    // test with the panel at its collapsed-by-default state.
    localStorage.clear();

    operations = jasmine.createSpyObj('OperationsService', [
      'getSelfUpdateStatus',
      'checkForSelfUpdate',
      'triggerSelfUpdate',
    ]);
    confirm = jasmine.createSpyObj('ConfirmService', ['ask']);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);

    await TestBed.configureTestingModule({
      imports: [SelfUpdateComponent],
      providers: [
        { provide: OperationsService, useValue: operations },
        { provide: ConfirmService, useValue: confirm },
        { provide: ToastService, useValue: toast },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SelfUpdateComponent);
    component = fixture.componentInstance;
  });

  function openPanel(): void {
    const toggle = (fixture.nativeElement as HTMLElement).querySelector(
      '.panel__toggle',
    ) as HTMLButtonElement | null;
    toggle?.click();
    fixture.detectChanges();
  }

  it('loads and displays the up-to-date status on init', () => {
    operations.getSelfUpdateStatus.and.returnValue(of(upToDateStatus));
    fixture.detectChanges();
    openPanel();

    expect(operations.getSelfUpdateStatus).toHaveBeenCalled();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Up to date');
    const updateButton = (fixture.nativeElement as HTMLElement).querySelector('button.btn-primary') as HTMLButtonElement;
    expect(updateButton.disabled).toBe(true);
  });

  it('enables "Update now" when commits are behind, and requires confirmation before triggering', () => {
    operations.getSelfUpdateStatus.and.returnValue(of(behindStatus));
    fixture.detectChanges();
    openPanel();

    const updateButton = (fixture.nativeElement as HTMLElement).querySelector('button.btn-primary') as HTMLButtonElement;
    expect(updateButton.disabled).toBe(false);

    confirm.ask.and.returnValue(Promise.resolve(false));
    component.updateNow();

    expect(confirm.ask).toHaveBeenCalledWith(jasmine.objectContaining({ danger: true }));
    expect(operations.triggerSelfUpdate).not.toHaveBeenCalled();
  });

  it('triggers the update and starts polling once confirmed', fakeAsync(() => {
    operations.getSelfUpdateStatus.and.returnValue(of(upToDateStatus));
    fixture.detectChanges();

    confirm.ask.and.returnValue(Promise.resolve(true));
    operations.triggerSelfUpdate.and.returnValue(of(runningRun));
    operations.getSelfUpdateStatus.and.returnValue(
      of({ ...behindStatus, latestRun: { ...runningRun, state: 'done', finishedAt: '2026-09-04T10:05:00.000Z' } })
    );

    component.updateNow();
    tick();
    fixture.detectChanges();

    expect(operations.triggerSelfUpdate).toHaveBeenCalled();

    tick(3000);
    expect(operations.getSelfUpdateStatus).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();

    component.ngOnDestroy();
  }));

  it('does not blow up the poll on a request failure mid-restart, and keeps trying', fakeAsync(() => {
    operations.getSelfUpdateStatus.and.returnValue(of({ ...behindStatus, latestRun: runningRun }));
    fixture.detectChanges();

    operations.getSelfUpdateStatus.and.returnValue(throwError(() => new Error('connection refused')));
    tick(3000);

    // Still in progress — no toast, no crash, no unsubscribe.
    expect(toast.error).not.toHaveBeenCalled();

    component.ngOnDestroy();
  }));
});
