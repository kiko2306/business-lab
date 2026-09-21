import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { BackupsComponent } from './backups.component';
import { OperationsService } from '../../core/operations.service';
import { ConfirmService } from '../../core/confirm.service';
import { SettingsService } from '../../core/settings.service';
import { ToastService } from '../../core/toast.service';
import { BackupProgress, BackupStatusResponse, BackupTargetSettings } from '../../core/models';

describe('BackupsComponent', () => {
  let fixture: ComponentFixture<BackupsComponent>;
  let component: BackupsComponent;
  let operations: jasmine.SpyObj<OperationsService>;
  let settings: jasmine.SpyObj<SettingsService>;
  let toast: jasmine.SpyObj<ToastService>;

  const emptyBackupTarget: BackupTargetSettings = {
    configured: false,
    kind: 'disk',
    path: null,
    server: null,
    share: null,
    username: null,
    passwordConfigured: false,
    options: null,
  };

  const emptyStatus: BackupStatusResponse = {
    job: {
      configured: false,
      reachable: true,
      storageType: null,
      repositoryDescription: null,
      snapshotCount: null,
      lastSnapshotAt: null,
      lastSnapshotSizeBytes: null,
      lastSnapshotFileCount: null,
      lastSnapshotErrorCount: null,
      sourceStatus: null,
    },
    lastAppData: null,
  };

  function dumping(index: number, total: number, label: string): BackupProgress {
    return {
      running: true,
      trigger: 'manual',
      phase: 'dumping',
      index,
      total,
      label,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      ok: null,
      detail: null,
    };
  }

  function done(ok: boolean, detail: string): BackupProgress {
    return {
      running: false,
      trigger: 'manual',
      phase: 'done',
      index: 2,
      total: 2,
      label: null,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      ok,
      detail,
    };
  }

  beforeEach(async () => {
    operations = jasmine.createSpyObj('OperationsService', [
      'listBackups',
      'getBackupSchedule',
      'getBackupStatus',
      'runAppDataBackup',
      'getBackupProgress',
    ]);
    operations.listBackups.and.returnValue(of({ items: [] }));
    operations.getBackupSchedule.and.returnValue(
      of({
        enabled: false,
        frequency: 'daily',
        runAtTime: '03:00',
        retentionCount: 14,
        lastRunAt: null,
        lastOutcome: null,
        lastSuccessAt: null,
        consecutiveFailures: 0,
      })
    );
    operations.getBackupStatus.and.returnValue(of(emptyStatus));
    settings = jasmine.createSpyObj('SettingsService', ['getBackupTarget', 'saveBackupTarget', 'testBackupTarget']);
    settings.getBackupTarget.and.returnValue(of(emptyBackupTarget));
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    const confirm = jasmine.createSpyObj('ConfirmService', ['ask']);

    await TestBed.configureTestingModule({
      imports: [BackupsComponent],
      providers: [
        { provide: OperationsService, useValue: operations },
        { provide: SettingsService, useValue: settings },
        { provide: ConfirmService, useValue: confirm },
        { provide: ToastService, useValue: toast },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BackupsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('opens the modal and shows each dump step as it polls', fakeAsync(() => {
    let call = 0;
    const steps = [dumping(1, 2, 'itflow'), dumping(2, 2, 'kimai'), done(true, 'triggered a Kopia snapshot')];
    operations.getBackupProgress.and.callFake(() => of(steps[Math.min(call++, steps.length - 1)]));
    const run$ = new Subject<{ ok: boolean; message: string }>();
    operations.runAppDataBackup.and.returnValue(run$.asObservable());

    component.runAppDataBackup();
    tick(); // flush timer(0, ...)'s immediate first poll
    fixture.detectChanges();
    expect(component['showRunModal']).toBe(true);
    expect(component['progress']?.label).toBe('itflow');

    tick(500);
    expect(component['progress']?.label).toBe('kimai');

    run$.next({ ok: true, message: 'App data backup queued.' });
    run$.complete();
    tick();
    fixture.detectChanges();

    expect(component['progress']?.phase).toBe('done');
    expect(toast.success).toHaveBeenCalledWith('App data backup queued.');

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('triggered a Kopia snapshot');

    component.closeRunModal();
    expect(component['showRunModal']).toBe(false);
    component.ngOnDestroy();
  }));

  it('stops polling and shows the error when the run request fails', fakeAsync(() => {
    operations.getBackupProgress.and.returnValue(of(done(false, 'the backup engine has no password configured yet')));
    const run$ = new Subject<{ ok: boolean; message: string }>();
    operations.runAppDataBackup.and.returnValue(run$.asObservable());

    component.runAppDataBackup();
    run$.error(
      new HttpErrorResponse({
        status: 400,
        error: { error: 'App data backup did not start: no destination configured.' },
      })
    );
    tick();
    fixture.detectChanges();

    expect(component['runError']).toContain('App data backup did not start');
    expect(component['progress']?.phase).toBe('done');

    component.ngOnDestroy();
  }));
});
