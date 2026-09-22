import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { BackupsComponent } from './backups.component';
import { OperationsService } from '../../core/operations.service';
import { ConfirmService } from '../../core/confirm.service';
import { ServiceStateService } from '../../core/service-state.service';
import { SettingsService } from '../../core/settings.service';
import { ToastService } from '../../core/toast.service';
import {
  BackupProgress,
  BackupStatusResponse,
  BackupTargetSettings,
  RemoteBackupSnapshot,
  ServiceStatus,
  SnapshotRestoreResponse,
} from '../../core/models';

describe('BackupsComponent', () => {
  let fixture: ComponentFixture<BackupsComponent>;
  let component: BackupsComponent;
  let operations: jasmine.SpyObj<OperationsService>;
  let settings: jasmine.SpyObj<SettingsService>;
  let toast: jasmine.SpyObj<ToastService>;
  let services$: Subject<ServiceStatus[]>;
  let serviceState: jasmine.SpyObj<ServiceStateService>;

  const snapshot: RemoteBackupSnapshot = {
    id: 'abc123def456',
    rootId: 'kdeadbeef',
    startTime: '2026-09-22T11:48:50.000Z',
    endTime: '2026-09-22T11:48:56.000Z',
    sizeBytes: 4619542642,
    fileCount: 49780,
    retentionReasons: ['latest-1'],
  };

  const app = (name: string, label: string) => ({ name, label }) as ServiceStatus;

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
      'listRemoteBackups',
      'getBackupSchedule',
      'getBackupStatus',
      'runAppDataBackup',
      'getBackupProgress',
    ]);
    operations.listBackups.and.returnValue(of({ items: [] }));
    operations.listRemoteBackups.and.returnValue(of({ items: [] }));
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
    settings = jasmine.createSpyObj('SettingsService', [
      'getBackupTarget',
      'saveBackupTarget',
      'testBackupTarget',
      'getKopiaStatus',
    ]);
    settings.getBackupTarget.and.returnValue(of(emptyBackupTarget));
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    const confirm = jasmine.createSpyObj('ConfirmService', ['ask']);
    // The page only wants the app list for the restore picker, so the real
    // poller (websocket + HttpClient) is stubbed down to that.
    services$ = new Subject<ServiceStatus[]>();
    serviceState = jasmine.createSpyObj('ServiceStateService', ['refresh'], { services$ });

    await TestBed.configureTestingModule({
      imports: [BackupsComponent],
      providers: [
        { provide: OperationsService, useValue: operations },
        { provide: SettingsService, useValue: settings },
        { provide: ConfirmService, useValue: confirm },
        { provide: ToastService, useValue: toast },
        { provide: ServiceStateService, useValue: serviceState },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BackupsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('restoring one app from a snapshot', () => {
    beforeEach(() => {
      operations.restoreAppFromSnapshot = jasmine.createSpy('restoreAppFromSnapshot');
      services$.next([app('ntfy', 'Ntfy'), app('itflow', 'ITFlow')]);
      fixture.detectChanges();
    });

    it('offers the apps alphabetically and starts with none chosen', () => {
      component.openSnapshotRestore(snapshot);

      expect(component['restorableApps'].map((a) => a.name)).toEqual(['itflow', 'ntfy']);
      expect(component['restoreSnapshotApp']).toBe('');
    });

    it('will not call the API until an app is chosen', () => {
      component.openSnapshotRestore(snapshot);
      component.confirmSnapshotRestore();

      expect(operations.restoreAppFromSnapshot).not.toHaveBeenCalled();
    });

    it('sends the snapshot id and app, then reports the outcome', () => {
      operations.restoreAppFromSnapshot.and.returnValue(
        of({
          success: true,
          app: 'ntfy',
          snapshotId: snapshot.id,
          file: 'ntfy-snapshot-2026.tar.gz',
          restoredBytes: 382837,
          restoredFiles: 8,
          warnings: [],
          message: 'Restored ntfy from the snapshot.',
        })
      );

      component.openSnapshotRestore(snapshot);
      component['restoreSnapshotApp'] = 'ntfy';
      component.confirmSnapshotRestore();

      expect(operations.restoreAppFromSnapshot).toHaveBeenCalledWith('abc123def456', 'ntfy');
      expect(toast.success).toHaveBeenCalledWith('Restored ntfy from the snapshot.');
      expect(component['snapshotRestoreResult']?.file).toBe('ntfy-snapshot-2026.tar.gz');
      expect(component['restoringSnapshot']).toBeFalse();
      // The app was stopped and started, so the shell's state is stale.
      expect(serviceState.refresh).toHaveBeenCalled();
    });

    it('surfaces a warning-carrying restore as an error, not a success', () => {
      operations.restoreAppFromSnapshot.and.returnValue(
        of({
          success: true,
          app: 'itflow',
          snapshotId: snapshot.id,
          file: 'itflow-snapshot.tar.gz',
          restoredBytes: 1,
          restoredFiles: 1,
          warnings: ['Database replay failed: connection refused'],
          message: 'Restored itflow from the snapshot with warnings — see the details.',
        })
      );

      component.openSnapshotRestore(snapshot);
      component['restoreSnapshotApp'] = 'itflow';
      component.confirmSnapshotRestore();

      expect(toast.error).toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
      expect(component['snapshotRestoreResult']?.warnings.length).toBe(1);
    });

    it('keeps the modal open on failure so the reason is visible', () => {
      operations.restoreAppFromSnapshot.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 404, error: { error: 'That snapshot no longer exists.' } }))
      );

      component.openSnapshotRestore(snapshot);
      component['restoreSnapshotApp'] = 'ntfy';
      component.confirmSnapshotRestore();

      expect(component['snapshotRestoreError']).toContain('no longer exists');
      expect(component['restoreSnapshotTarget']).toBe(snapshot);
      expect(component['restoringSnapshot']).toBeFalse();
    });

    it('refuses to close while the restore is in flight — the app is stopped', () => {
      operations.restoreAppFromSnapshot.and.returnValue(new Subject<SnapshotRestoreResponse>().asObservable());

      component.openSnapshotRestore(snapshot);
      component['restoreSnapshotApp'] = 'ntfy';
      component.confirmSnapshotRestore();
      component.closeSnapshotRestore();

      expect(component['restoreSnapshotTarget']).toBe(snapshot);
    });
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

  it('waits for Kopia to reconnect after a destination save that restarts it', fakeAsync(() => {
    settings.saveBackupTarget.and.returnValue(
      of({ message: 'Saved. Kopia recreated; its repository now lives on the new location.', restarted: true })
    );
    let call = 0;
    const statuses = [
      { ok: false, detail: 'Kopia is not reachable yet.' },
      { ok: true, detail: 'connected' },
    ];
    settings.getKopiaStatus.and.callFake(() => of(statuses[Math.min(call++, statuses.length - 1)]));

    component.saveBackupTarget();
    tick(); // flush the save PUT and the poll's immediate first tick
    fixture.detectChanges();
    expect(component['showDestinationRestartModal']).toBe(true);
    expect(component['destinationRestartDone']).toBe(false);

    tick(1000);
    fixture.detectChanges();
    expect(component['destinationRestartDone']).toBe(true);
    expect(component['destinationRestartOk']).toBe(true);

    component.closeDestinationRestartModal();
    expect(component['showDestinationRestartModal']).toBe(false);
    component.ngOnDestroy();
  }));

  it('gives up and reports failure if Kopia never reconnects', fakeAsync(() => {
    settings.saveBackupTarget.and.returnValue(
      of({ message: 'Saved. Kopia recreated; its repository now lives on the new location.', restarted: true })
    );
    settings.getKopiaStatus.and.returnValue(of({ ok: false, detail: 'connect ECONNREFUSED' }));

    component.saveBackupTarget();
    tick();
    tick(60 * 1000); // the full DESTINATION_RESTART_MAX_ATTEMPTS budget
    fixture.detectChanges();

    expect(component['destinationRestartDone']).toBe(true);
    expect(component['destinationRestartOk']).toBe(false);
    expect(component['destinationRestartDetail']).toContain('ECONNREFUSED');

    component.ngOnDestroy();
  }));

  it('does not open the restart modal when the destination save does not restart Kopia', fakeAsync(() => {
    settings.saveBackupTarget.and.returnValue(
      of({ message: 'Saved.', restarted: false })
    );

    component.saveBackupTarget();
    tick();
    fixture.detectChanges();

    expect(component['showDestinationRestartModal']).toBe(false);
    expect(settings.getKopiaStatus).not.toHaveBeenCalled();

    component.ngOnDestroy();
  }));
});
