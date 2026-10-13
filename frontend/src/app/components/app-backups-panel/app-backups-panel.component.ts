import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnInit, inject } from '@angular/core';
import { Observable, finalize, tap } from 'rxjs';
import { extractErrorMessage } from '../../core/api';
import { AppBackupEntry, ServiceStatus } from '../../core/models';
import { ConfirmService } from '../../core/confirm.service';
import { OperationsService } from '../../core/operations.service';
import { ServiceStateService } from '../../core/service-state.service';
import { ToastService } from '../../core/toast.service';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { TranslateService } from '../../i18n/translate.service';

/**
 * Per-app backup archives (plan.md §185): a local rollback point, distinct from
 * the scheduled off-site backup. Lives inside the service card's settings
 * dialog, which renders it only while open — so it loads on every open, as the
 * card itself used to (plan.md §911).
 */
@Component({
  selector: 'app-app-backups-panel',
  imports: [CommonModule, TranslatePipe],
  templateUrl: './app-backups-panel.component.html',
  styleUrls: ['./app-backups-panel.component.css'],
  // Same reason as the card (plan.md §802/§808): every async path below marks.
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppBackupsPanelComponent implements OnInit {
  private readonly operations = inject(OperationsService);
  private readonly serviceState = inject(ServiceStateService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly cdr = inject(ChangeDetectorRef);
  protected readonly translate = inject(TranslateService);

  @Input({ required: true }) service!: ServiceStatus;

  protected loading = false;
  protected creating = false;
  protected backups: AppBackupEntry[] = [];
  /** The file currently being restored / deleted, so its row can show a spinner. */
  protected busyFile: string | null = null;

  private marking<T>(source: Observable<T>): Observable<T> {
    const mark = () => this.cdr.markForCheck();
    return source.pipe(tap({ next: mark, error: mark, complete: mark }), finalize(mark));
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.marking(this.operations.listAppBackups(this.service.name))
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: (response) => (this.backups = response.items),
        error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('serviceCard.errors.loadBackups'))),
      });
  }

  create(): void {
    this.creating = true;
    this.marking(this.operations.createAppBackup(this.service.name))
      .pipe(finalize(() => (this.creating = false)))
      .subscribe({
        next: (response) => {
          if (response.dumpFailures.length) {
            this.toast.error(response.message);
          } else {
            this.toast.success(response.message);
          }
          this.load();
        },
        error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('serviceCard.errors.backupFailed', { label: this.service.label }))),
      });
  }

  async restore(entry: AppBackupEntry): Promise<void> {
    const when = new Date(entry.createdAt).toLocaleString();
    const confirmed = await this.confirm.ask({
      title: this.translate.t('serviceCard.confirmRestore.title', { label: this.service.label }),
      message: this.translate.t('serviceCard.confirmRestore.message', { when, label: this.service.label }),
      confirmText: this.translate.t('serviceCard.confirmRestore.confirmText'),
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    this.busyFile = entry.file;
    this.cdr.markForCheck();
    this.marking(this.operations.restoreAppBackup(this.service.name, entry.file))
      .pipe(finalize(() => (this.busyFile = null)))
      .subscribe({
        next: (response) => {
          if (response.warnings.length) {
            this.toast.error(`${response.message} ${response.warnings.join(' ')}`);
          } else {
            this.toast.success(response.message);
          }
          // The app was stopped and restarted by the restore — refresh the
          // card, and reload the list (a restore doesn't add a snapshot but
          // its mtimes/manifests are worth re-reading).
          this.serviceState.refresh();
          this.load();
        },
        error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('serviceCard.errors.restoreFailed', { label: this.service.label }))),
      });
  }

  async remove(entry: AppBackupEntry): Promise<void> {
    const when = new Date(entry.createdAt).toLocaleString();
    const confirmed = await this.confirm.ask({
      title: this.translate.t('serviceCard.confirmDeleteSnapshot.title'),
      message: this.translate.t('serviceCard.confirmDeleteSnapshot.message', { label: this.service.label, when }),
      confirmText: this.translate.t('serviceCard.confirmDeleteSnapshot.confirmText'),
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    this.busyFile = entry.file;
    this.cdr.markForCheck();
    this.marking(this.operations.deleteAppBackup(this.service.name, entry.file))
      .pipe(finalize(() => (this.busyFile = null)))
      .subscribe({
        next: (response) => {
          this.toast.success(response.message);
          this.load();
        },
        error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('serviceCard.errors.deleteSnapshot'))),
      });
  }

  download(entry: AppBackupEntry): void {
    this.operations.downloadAppBackup(this.service.name, entry.file).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = entry.file;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('serviceCard.errors.downloadSnapshot'))),
    });
  }

  /** Short "· postgres · 2 dumps · 1 failed" line under a snapshot's timestamp. */
  protected detail(entry: AppBackupEntry): string {
    const parts = [`${(entry.bytes / 1024).toFixed(0)} KB`];
    const m = entry.manifest;
    if (!m) {
      parts.push(this.translate.t('serviceCard.backups.detailsUnavailable'));
      return parts.join(' · ');
    }
    if (m.engine) {
      parts.push(m.engine);
    }
    if (m.dumpFailures.length) {
      parts.push(
        this.translate.t(
          m.dumpFailures.length === 1 ? 'serviceCard.backups.dumpFailed.one' : 'serviceCard.backups.dumpFailed.other',
          { count: m.dumpFailures.length }
        )
      );
    }
    return parts.join(' · ');
  }
}
