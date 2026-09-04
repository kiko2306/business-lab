import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PanelComponent } from '../../components/panel/panel.component';
import { OperationsService } from '../../core/operations.service';
import { ConfirmService } from '../../core/confirm.service';
import { BackupFile, BackupScheduleConfig, BackupStatusResponse } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { extractErrorMessage } from '../../core/api';

/**
 * Backups & restore on its own route (§131.1): the schedule, the on-demand
 * "Back up now" run, what Kopia actually holds, and the list of restorable
 * archives. Lifted verbatim from the one-page dashboard — no API change — so
 * that upcoming backups work (per-app backup/restore) has a page to grow on
 * rather than another panel on an already-long dashboard.
 */
@Component({
  selector: 'app-backups',
  standalone: true,
  imports: [CommonModule, FormsModule, PanelComponent],
  templateUrl: './backups.component.html',
  styleUrl: './backups.component.css',
})
export class BackupsComponent implements OnInit {
  private readonly operations = inject(OperationsService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  protected backups: BackupFile[] = [];
  protected schedule: BackupScheduleConfig = {
    enabled: false,
    frequency: 'daily',
    retentionCount: 14,
    lastRunAt: null,
    lastOutcome: null,
    lastSuccessAt: null,
    consecutiveFailures: 0,
  };
  protected savingSchedule = false;
  protected runningAppDataBackup = false;
  protected backupStatus: BackupStatusResponse | null = null;

  ngOnInit(): void {
    this.loadBackups();
    this.loadSchedule();
    this.loadBackupStatus();
  }

  loadBackups(): void {
    this.operations.listBackups().subscribe({
      next: (response) => {
        this.backups = response.items;
      },
      error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to load backups.')),
    });
  }

  createBackup(): void {
    this.operations.createBackup().subscribe({
      next: (response) => {
        this.toast.success(response.message);
        this.loadBackups();
      },
      error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to create backup.')),
    });
  }

  restoreBackup(fileName: string): void {
    void this.confirm
      .ask({
        title: 'Restore backup',
        message: `Restore backup "${fileName}"?\nThis overwrites the current state.`,
        confirmText: 'Restore',
        danger: true,
      })
      .then((confirmed) => {
        if (!confirmed) {
          return;
        }
        this.operations.restoreBackup(fileName).subscribe({
          next: (response) => this.toast.success(response.message),
          error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to restore backup.')),
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
      error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to download backup.')),
    });
  }

  loadSchedule(): void {
    this.operations.getBackupSchedule().subscribe({
      next: (response) => {
        this.schedule = response;
      },
      error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to load backup schedule.')),
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
    // The dump is synchronous, so this request runs ~20s.
    this.runningAppDataBackup = true;
    this.operations.runAppDataBackup().subscribe({
      next: (response) => {
        this.runningAppDataBackup = false;
        this.toast.success(response.message);
        this.loadBackupStatus();
      },
      error: (error) => {
        this.runningAppDataBackup = false;
        this.toast.error(extractErrorMessage(error, 'Unable to run the app data backup.'));
        // Even a run that "did not start" dumped databases and wrote an audit
        // row — refresh the card so any dump failures show.
        this.loadBackupStatus();
      },
    });
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
    const { enabled, frequency, retentionCount } = this.schedule;
    this.operations.updateBackupSchedule({ enabled, frequency, retentionCount }).subscribe({
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
        this.toast.error(extractErrorMessage(error, 'Unable to update backup schedule.'));
        this.savingSchedule = false;
      },
    });
  }
}
