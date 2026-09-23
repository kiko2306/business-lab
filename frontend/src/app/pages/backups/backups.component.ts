import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Subscription, catchError, finalize, of, switchMap, timer } from 'rxjs';
import { PanelComponent } from '../../components/panel/panel.component';
import { OperationsService } from '../../core/operations.service';
import { ConfirmService } from '../../core/confirm.service';
import {
  BackupFile,
  BackupProgress,
  BackupScheduleConfig,
  BackupStatusResponse,
  BackupTargetInput,
  BackupTargetKind,
  BackupTargetSettings,
  BackupTargetTestResponse,
  RemoteBackupSnapshot,
  ServiceStatus,
  SnapshotRestoreResponse,
} from '../../core/models';
import { ServiceStateService } from '../../core/service-state.service';
import { SettingsService } from '../../core/settings.service';
import { ToastService } from '../../core/toast.service';
import { extractErrorMessage } from '../../core/api';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { TranslateService } from '../../i18n/translate.service';

/** How often the "Full Backup" modal polls GET /backups/run/progress. Each
 * step (one app's dump) can finish in well under a second, so this needs to
 * be faster than the 3s the self-update panel polls at — that page's steps
 * (pull, build) each run tens of seconds. */
const PROGRESS_POLL_MS = 500;

/** How often the destination-save modal polls GET /backup-target/kopia-status
 * while waiting for Kopia to restart. Kopia's own entrypoint (connect/create,
 * a network round trip for anything but a local disk) takes longer than a
 * dump step does, so this is slower than PROGRESS_POLL_MS above. */
const KOPIA_STATUS_POLL_MS = 1000;

/**
 * Backups & restore on its own route (§131.1): the schedule, the on-demand
 * "Full Backup" run, what Kopia actually holds, and the list of restorable
 * archives. Lifted verbatim from the one-page dashboard — no API change — so
 * that upcoming backups work (per-app backup/restore) has a page to grow on
 * rather than another panel on an already-long dashboard.
 */
@Component({
  selector: 'app-backups',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, PanelComponent, TranslatePipe],
  templateUrl: './backups.component.html',
  styleUrl: './backups.component.css',
})
export class BackupsComponent implements OnInit, OnDestroy {
  private readonly operations = inject(OperationsService);
  private readonly settingsService = inject(SettingsService);
  private readonly serviceState = inject(ServiceStateService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly formBuilder = inject(FormBuilder);
  protected readonly translate = inject(TranslateService);

  // One form for all destination types; which controls matter depends on
  // `kind`, and the template shows only the relevant ones. Validation is done
  // server-side because the rules differ per kind and duplicating them here
  // would be two places to keep in step.
  protected readonly backupTargetForm = this.formBuilder.nonNullable.group({
    kind: ['disk' as BackupTargetKind],
    path: [''],
    server: [''],
    share: [''],
    username: [''],
    password: [''],
    options: [''],
  });
  protected backupTarget: BackupTargetSettings | null = null;
  protected backupTargetLoading = true;
  protected savingBackupTarget = false;
  protected testingBackupTarget = false;
  protected backupTargetFeedback: { type: 'success' | 'danger' | 'info'; message: string } | null = null;
  protected backupTargetTestResult: BackupTargetTestResponse | null = null;

  protected backups: BackupFile[] = [];
  protected remoteBackups: RemoteBackupSnapshot[] = [];
  protected remoteBackupsLoading = true;
  protected schedule: BackupScheduleConfig = {
    enabled: false,
    frequency: 'daily',
    runAtTime: '03:00',
    retentionCount: 14,
    lastRunAt: null,
    lastOutcome: null,
    lastSuccessAt: null,
    consecutiveFailures: 0,
  };
  protected savingSchedule = false;
  protected backupStatus: BackupStatusResponse | null = null;

  protected showRunModal = false;
  protected progress: BackupProgress | null = null;
  protected runError: string | null = null;
  private pollSubscription?: Subscription;

  // Kopia always restarts to pick up a saved destination (§581) — this modal
  // polls GET /backup-target/kopia-status until it reconnects, since `docker
  // compose up -d` returns as soon as the container starts, well before its
  // entrypoint has actually connected (or failed) against the new target.
  protected showDestinationRestartModal = false;
  protected destinationRestartDone = false;
  protected destinationRestartOk = false;
  protected destinationRestartDetail = '';
  // Snapshot restore (plan.md §592). One app at a time: a whole-tree restore
  // is the "the box is gone" case, which has no dashboard to click in.
  protected restoreSnapshotTarget: RemoteBackupSnapshot | null = null;
  protected restoreSnapshotApp = '';
  protected restoringSnapshot = false;
  protected snapshotRestoreResult: SnapshotRestoreResponse | null = null;
  protected snapshotRestoreError = '';
  protected restorableApps: ServiceStatus[] = [];
  private servicesSubscription?: Subscription;

  private destinationPollSubscription?: Subscription;
  private destinationRestartAttempts = 0;
  private readonly DESTINATION_RESTART_MAX_ATTEMPTS = 60; // 60 * 1s = 1 minute

  ngOnInit(): void {
    this.loadBackups();
    this.loadRemoteBackups();
    this.loadSchedule();
    this.loadBackupStatus();
    this.loadBackupTarget();
    // The picker needs the app list, not live state, so this takes one
    // snapshot of it rather than starting the shared poller.
    this.servicesSubscription = this.serviceState.services$.subscribe((services) => {
      this.restorableApps = [...(services ?? [])].sort((a, b) => a.label.localeCompare(b.label));
    });
    this.serviceState.refresh();
  }

  ngOnDestroy(): void {
    this.servicesSubscription?.unsubscribe();
    this.destinationPollSubscription?.unsubscribe();
    this.pollSubscription?.unsubscribe();
  }

  loadBackups(): void {
    this.operations.listBackups().subscribe({
      next: (response) => {
        this.backups = response.items;
      },
      error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('backups.errors.loadBackups'))),
    });
  }

  loadRemoteBackups(): void {
    // Best-effort, like loadBackupStatus: no destination configured yet or
    // Kopia unreachable both come back as an empty list rather than an error,
    // and the destination card above already explains why.
    this.remoteBackupsLoading = true;
    this.operations
      .listRemoteBackups()
      .pipe(finalize(() => (this.remoteBackupsLoading = false)))
      .subscribe({
        next: (response) => {
          this.remoteBackups = response.items;
        },
        error: () => {
          this.remoteBackups = [];
        },
      });
  }

  openSnapshotRestore(snapshot: RemoteBackupSnapshot): void {
    this.restoreSnapshotTarget = snapshot;
    this.restoreSnapshotApp = '';
    this.snapshotRestoreResult = null;
    this.snapshotRestoreError = '';
  }

  closeSnapshotRestore(): void {
    if (this.restoringSnapshot) {
      return; // mid-restore the app is stopped; closing would hide the outcome
    }
    this.restoreSnapshotTarget = null;
    this.snapshotRestoreResult = null;
    this.snapshotRestoreError = '';
  }

  /**
   * The modal states the consequence and the button says Restore, so this is
   * the confirmation — a second confirm dialog on top of it would just be a
   * click to dismiss.
   */
  confirmSnapshotRestore(): void {
    const snapshot = this.restoreSnapshotTarget;
    const app = this.restoreSnapshotApp;
    if (!snapshot || !app || this.restoringSnapshot) {
      return;
    }
    this.restoringSnapshot = true;
    this.snapshotRestoreError = '';
    this.operations
      .restoreAppFromSnapshot(snapshot.id, app)
      .pipe(finalize(() => (this.restoringSnapshot = false)))
      .subscribe({
        next: (response) => {
          this.snapshotRestoreResult = response;
          if (response.warnings.length) {
            this.toast.error(response.message);
          } else {
            this.toast.success(response.message);
          }
          // The staged archive is a normal restore point now, and the app was
          // stopped and started, so both lists are stale.
          this.serviceState.refresh();
        },
        error: (error) => {
          this.snapshotRestoreError = extractErrorMessage(error, this.translate.t('backups.errors.restoreSnapshot'));
        },
      });
  }

  createBackup(): void {
    this.operations.createBackup().subscribe({
      next: (response) => {
        this.toast.success(response.message);
        this.loadBackups();
      },
      error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('backups.errors.createBackup'))),
    });
  }

  restoreBackup(fileName: string): void {
    void this.confirm
      .ask({
        title: this.translate.t('backups.confirmRestore.title'),
        message: this.translate.t('backups.confirmRestore.message', { fileName }),
        confirmText: this.translate.t('backups.confirmRestore.confirmText'),
        danger: true,
      })
      .then((confirmed) => {
        if (!confirmed) {
          return;
        }
        this.operations.restoreBackup(fileName).subscribe({
          next: (response) => this.toast.success(response.message),
          error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('backups.errors.restoreBackup'))),
        });
      });
  }

  downloadBackup(fileName: string): void {
    this.operations.downloadBackup(fileName).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('backups.errors.downloadBackup'))),
    });
  }

  loadSchedule(): void {
    this.operations.getBackupSchedule().subscribe({
      next: (response) => {
        this.schedule = response;
      },
      error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('backups.errors.loadSchedule'))),
    });
  }

  loadBackupStatus(): void {
    // Best-effort: this panel is extra detail, not the reason the page exists.
    // A Kopia that is down or unprovisioned is a state the card renders,
    // not a toast.
    this.operations.getBackupStatus().subscribe({
      next: (response) => {
        this.backupStatus = response;
      },
      error: () => {
        this.backupStatus = null;
      },
    });
  }

  runAppDataBackup(): void {
    // Dumps every app database then triggers a Kopia snapshot — the same path
    // the scheduler takes, so a manual run is never a generation stale (§74.6).
    // The dump is synchronous (~20s), so the modal polls GET /run/progress
    // for the step actually running instead of sitting on an indeterminate
    // spinner for the whole request.
    this.progress = null;
    this.runError = null;
    this.showRunModal = true;
    this.startProgressPolling();

    this.operations.runAppDataBackup().subscribe({
      next: (response) => {
        this.fetchFinalProgress();
        this.toast.success(response.message);
        this.loadBackupStatus();
        this.loadRemoteBackups();
      },
      error: (error) => {
        this.runError = extractErrorMessage(error, this.translate.t('backups.errors.runBackup'));
        this.fetchFinalProgress();
        // Even a run that "did not start" dumped databases and wrote an audit
        // row — refresh the card so any dump failures show.
        this.loadBackupStatus();
        this.loadRemoteBackups();
      },
    });
  }

  private startProgressPolling(): void {
    this.pollSubscription?.unsubscribe();
    this.pollSubscription = timer(0, PROGRESS_POLL_MS)
      .pipe(switchMap(() => this.operations.getBackupProgress().pipe(catchError(() => of(null)))))
      .subscribe((progress) => {
        if (!progress) {
          return;
        }
        this.progress = progress;
        if (!progress.running) {
          this.pollSubscription?.unsubscribe();
        }
      });
  }

  /**
   * The POST to /run only resolves once the backend has already marked the
   * run done, so one extra fetch here shows the final numbers right away
   * instead of waiting for the next poll tick (or, if something threw before
   * the backend could mark it done, at least the last state it reached).
   */
  private fetchFinalProgress(): void {
    this.pollSubscription?.unsubscribe();
    this.operations.getBackupProgress().subscribe({
      next: (progress) => (this.progress = progress),
      error: () => {},
    });
  }

  closeRunModal(): void {
    this.showRunModal = false;
    this.pollSubscription?.unsubscribe();
  }

  /**
   * Sizes are reported in bytes; show them in the unit a person would use.
   * Binary units (KiB steps), matching the utils page's formatter.
   */
  protected formatBytes(bytes: number): string {
    if (!bytes || bytes < 0) {
      return '—';
    }
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value >= 10 || unit <= 1 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
  }

  saveSchedule(): void {
    this.savingSchedule = true;
    const { enabled, frequency, runAtTime, retentionCount } = this.schedule;
    this.operations.updateBackupSchedule({ enabled, frequency, runAtTime, retentionCount }).subscribe({
      next: (response) => {
        this.toast.success(response.message);
        this.savingSchedule = false;
        this.loadSchedule();
        // Saving a lower retention count deletes the extra archives server-side,
        // so the list has to be re-read or it keeps showing what is gone.
        this.loadBackups();
        this.loadBackupStatus();
      },
      error: (error) => {
        this.toast.error(extractErrorMessage(error, this.translate.t('backups.errors.updateSchedule')));
        this.savingSchedule = false;
      },
    });
  }

  loadBackupTarget(): void {
    this.backupTargetLoading = true;
    this.settingsService
      .getBackupTarget()
      .pipe(finalize(() => (this.backupTargetLoading = false)))
      .subscribe({
        next: (settings) => {
          this.backupTarget = settings;
          this.backupTargetForm.patchValue({
            kind: settings.kind,
            path: settings.path ?? '',
            server: settings.server ?? '',
            share: settings.share ?? '',
            username: settings.username ?? '',
            options: settings.options ?? '',
          });
        },
        error: () =>
          (this.backupTargetFeedback = {
            type: 'danger',
            message: this.translate.t('backups.errors.loadTarget'),
          }),
      });
  }

  saveBackupTarget(): void {
    const value = this.backupTargetForm.getRawValue();
    const payload: BackupTargetInput = { kind: value.kind };

    if (value.kind === 'disk') {
      payload.path = value.path.trim();
    } else {
      payload.server = value.server.trim();
      payload.share = value.share.trim();
      payload.username = value.username.trim();
      payload.options = value.options.trim();
      if (value.password) payload.password = value.password;
    }

    this.savingBackupTarget = true;
    this.backupTargetTestResult = null;
    this.settingsService
      .saveBackupTarget(payload)
      .pipe(finalize(() => (this.savingBackupTarget = false)))
      .subscribe({
        next: (response) => {
          this.backupTargetFeedback = { type: 'success', message: response.message };
          this.backupTargetForm.controls.password.reset('');
          this.loadBackupTarget();
          if (response.restarted) {
            this.startDestinationRestartWait();
          }
        },
        error: (error) =>
          (this.backupTargetFeedback = {
            type: 'danger',
            message: extractErrorMessage(error, this.translate.t('backups.errors.saveTarget')),
          }),
      });
  }

  /** Polls Kopia's own connection status until it reconnects against the
   * destination just saved, or the attempt budget above runs out — the save
   * request itself only proves `docker compose up -d` was issued, not that
   * the new destination actually works (plan.md §581). */
  private startDestinationRestartWait(): void {
    this.destinationPollSubscription?.unsubscribe();
    this.destinationRestartAttempts = 0;
    this.destinationRestartDone = false;
    this.destinationRestartOk = false;
    this.destinationRestartDetail = this.translate.t('backups.restartModal.waiting');
    this.showDestinationRestartModal = true;

    this.destinationPollSubscription = timer(0, KOPIA_STATUS_POLL_MS)
      .pipe(
        switchMap(() =>
          this.settingsService
            .getKopiaStatus()
            .pipe(catchError(() => of({ ok: false, detail: this.translate.t('backups.restartModal.unreachable') })))
        )
      )
      .subscribe((status) => {
        this.destinationRestartAttempts++;
        this.destinationRestartDetail = status.detail;
        if (status.ok || this.destinationRestartAttempts >= this.DESTINATION_RESTART_MAX_ATTEMPTS) {
          this.destinationRestartDone = true;
          this.destinationRestartOk = status.ok;
          this.destinationPollSubscription?.unsubscribe();
        }
      });
  }

  closeDestinationRestartModal(): void {
    this.showDestinationRestartModal = false;
    this.destinationPollSubscription?.unsubscribe();
  }

  testBackupTarget(): void {
    this.testingBackupTarget = true;
    this.backupTargetTestResult = null;
    this.settingsService
      .testBackupTarget()
      .pipe(finalize(() => (this.testingBackupTarget = false)))
      .subscribe({
        next: (result) => {
          this.backupTargetTestResult = result;
          this.backupTargetFeedback = {
            type: result.success ? 'success' : 'danger',
            message: result.message,
          };
        },
        error: (error) =>
          (this.backupTargetFeedback = {
            type: 'danger',
            message: extractErrorMessage(error, this.translate.t('backups.errors.testTarget')),
          }),
      });
  }
}
