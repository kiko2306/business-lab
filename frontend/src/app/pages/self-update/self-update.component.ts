import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Subscription, catchError, of, switchMap, timer } from 'rxjs';
import { PanelComponent } from '../../components/panel/panel.component';
import { OperationsService } from '../../core/operations.service';
import { ConfirmService } from '../../core/confirm.service';
import { ToastService } from '../../core/toast.service';
import { extractErrorMessage } from '../../core/api';
import { SelfUpdateRunState, SelfUpdateStatus } from '../../core/models';

const PROGRESS_LABELS: Record<SelfUpdateRunState, string> = {
  checking: 'Checking for updates…',
  pulling: 'Pulling the latest code…',
  building: 'Building the frontend and backend images…',
  updating_apps: 'Pulling and recreating managed apps on their pinned images…',
  restarting_frontend: 'Restarting the frontend…',
  restarting_backend: 'Restarting the backend — the dashboard will reconnect on its own…',
  done: 'Up to date.',
  error: 'The last update failed.',
};

const IN_PROGRESS_STATES: SelfUpdateRunState[] = [
  'checking',
  'pulling',
  'building',
  'updating_apps',
  'restarting_frontend',
  'restarting_backend',
];

/**
 * The "git pull + rebuild + restart" panel (plan.md §131.4), gated to the
 * `system:update` capability (webmaster/admin only). Deliberately its own
 * route rather than a card on Settings — see plan.md §131.4 for why: it
 * keeps working if `settings:manage` is ever narrowed independently.
 */
@Component({
  selector: 'app-self-update',
  standalone: true,
  imports: [CommonModule, PanelComponent],
  templateUrl: './self-update.component.html',
})
export class SelfUpdateComponent implements OnInit, OnDestroy {
  private readonly operations = inject(OperationsService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  protected status: SelfUpdateStatus | null = null;
  protected checking = false;
  protected triggering = false;
  protected readonly progressLabels = PROGRESS_LABELS;

  private pollSubscription?: Subscription;

  ngOnInit(): void {
    this.loadStatus();
  }

  ngOnDestroy(): void {
    this.pollSubscription?.unsubscribe();
  }

  protected get runInProgress(): boolean {
    const state = this.status?.latestRun?.state;
    return !!state && IN_PROGRESS_STATES.includes(state);
  }

  loadStatus(): void {
    this.operations.getSelfUpdateStatus().subscribe({
      next: (status) => {
        this.status = status;
        if (this.runInProgress) {
          this.startPolling();
        }
      },
      error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to load the self-update status.')),
    });
  }

  checkNow(): void {
    this.checking = true;
    this.operations.checkForSelfUpdate().subscribe({
      next: (check) => {
        this.checking = false;
        if (this.status) {
          this.status = { ...this.status, check };
        }
      },
      error: (error) => {
        this.checking = false;
        this.toast.error(extractErrorMessage(error, 'Unable to check for updates.'));
      },
    });
  }

  updateNow(): void {
    void this.confirm
      .ask({
        title: 'Update Business Lab',
        message:
          'Pull the latest code and rebuild + restart the dashboard now?\nIt will be briefly unavailable while the backend restarts.',
        confirmText: 'Update',
        danger: true,
      })
      .then((confirmed) => {
        if (!confirmed) {
          return;
        }
        this.triggering = true;
        this.operations.triggerSelfUpdate().subscribe({
          next: (run) => {
            this.triggering = false;
            if (this.status) {
              this.status = { ...this.status, latestRun: run };
            }
            this.startPolling();
          },
          error: (error) => {
            this.triggering = false;
            this.toast.error(extractErrorMessage(error, 'Unable to start the update.'));
          },
        });
      });
  }

  /**
   * Polls every 3s while a run is in progress — including through the
   * backend's own restart, where requests fail until the new container is
   * accepting connections again. Errors are swallowed rather than toasted
   * for exactly that reason; polling just keeps trying until it succeeds.
   */
  private startPolling(): void {
    this.pollSubscription?.unsubscribe();
    this.pollSubscription = timer(3000, 3000)
      .pipe(switchMap(() => this.operations.getSelfUpdateStatus().pipe(catchError(() => of(null)))))
      .subscribe((status) => {
        if (!status) {
          return;
        }
        this.status = status;
        if (!this.runInProgress) {
          this.pollSubscription?.unsubscribe();
          if (status.latestRun?.state === 'done') {
            this.toast.success('Business Lab is up to date.');
          } else if (status.latestRun?.state === 'error') {
            this.toast.error(status.latestRun.errorMessage || 'The update failed.');
          }
        }
      });
  }
}
