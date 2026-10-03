import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Subscription, catchError, of, switchMap, timer } from 'rxjs';
import { PanelComponent } from '../../components/panel/panel.component';
import { OperationsService } from '../../core/operations.service';
import { ConfirmService } from '../../core/confirm.service';
import { ToastService } from '../../core/toast.service';
import { selfUpdateErrorKey } from '../../core/self-update-errors';
import { SelfUpdateRun, SelfUpdateRunState, SelfUpdateStatus } from '../../core/models';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { TranslateService } from '../../i18n/translate.service';

// The sweeper re-checks every 6h; flag the cached result as stale once it's
// meaningfully older than that, so a silently-failing sweep can't keep reading
// as a current "up to date" (§351).
const CHECK_STALE_AFTER_MS = 8 * 60 * 60 * 1000;

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
  imports: [CommonModule, PanelComponent, TranslatePipe],
  templateUrl: './self-update.component.html',
  styleUrl: './self-update.component.css',
})
export class SelfUpdateComponent implements OnInit, OnDestroy {
  private readonly operations = inject(OperationsService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  protected readonly translate = inject(TranslateService);

  protected status: SelfUpdateStatus | null = null;
  protected checking = false;
  protected triggering = false;

  private pollSubscription?: Subscription;

  ngOnInit(): void {
    this.loadStatus();
  }

  ngOnDestroy(): void {
    this.pollSubscription?.unsubscribe();
  }

  /**
   * What the box is left in depends on how far the run got (plan.md §835), so
   * the headline is worded by the phase it stopped in rather than by the raw
   * tool output, which only goes behind the details disclosure.
   */
  protected failureHeadlineKey(run: SelfUpdateRun): string {
    switch (run.failedPhase) {
      case 'checking':
      case 'pulling':
        return 'selfUpdate.failed.headline.start';
      case 'building':
      case 'updating_apps':
        return 'selfUpdate.failed.headline.install';
      case 'restarting_frontend':
      case 'restarting_backend':
        return 'selfUpdate.failed.headline.restart';
      default:
        return 'selfUpdate.failed.headline.unknown';
    }
  }

  /** A run that landed with some apps failed; still shows while the dashboard restarts. */
  protected appsFailedOf(run: SelfUpdateRun | null | undefined): string[] {
    return run && !this.runInProgressFor(run) && run.state !== 'error' ? run.appsFailed ?? [] : [];
  }

  private runInProgressFor(run: SelfUpdateRun): boolean {
    return run.finishedAt === null;
  }

  /**
   * The progress line's detail: the two image targets arrive as the words
   * `frontend` and `backend`, which mean nothing to the owner; an app's name
   * and its count pass through as they are.
   */
  protected detailText(detail: string): string {
    return detail === 'frontend' || detail === 'backend' ? this.translate.t('selfUpdate.target.' + detail) : detail;
  }

  protected get runInProgress(): boolean {
    const state = this.status?.latestRun?.state;
    return !!state && IN_PROGRESS_STATES.includes(state);
  }

  /** The last successful check is old enough that it may no longer be true. */
  protected get checkIsStale(): boolean {
    const checkedAt = this.status?.check?.checkedAt;
    if (!checkedAt) {
      return false;
    }
    return Date.now() - Date.parse(checkedAt) > CHECK_STALE_AFTER_MS;
  }

  loadStatus(): void {
    this.operations.getSelfUpdateStatus().subscribe({
      next: (status) => {
        this.status = status;
        if (this.runInProgress) {
          this.startPolling();
        }
      },
      error: (error) => this.toast.error(this.translate.t(selfUpdateErrorKey(error, 'selfUpdate.errors.loadStatus'))),
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
        this.toast.error(this.translate.t(selfUpdateErrorKey(error, 'selfUpdate.errors.checkFailed')));
      },
    });
  }

  updateNow(): void {
    // Force a fresh git fetch before asking — the status panel only shows a
    // cached check (refreshed every 6h or by "Check now"), and a stale
    // "up to date" would otherwise silently skip a real update.
    this.checking = true;
    this.operations.checkForSelfUpdate().subscribe({
      next: (check) => {
        this.checking = false;
        if (this.status) {
          this.status = { ...this.status, check };
        }
        if (check.commitsBehind === 0) {
          this.toast.success(this.translate.t('selfUpdate.toast.alreadyUpToDate'));
          return;
        }
        this.confirmAndTrigger(check.commitsBehind);
      },
      error: (error) => {
        this.checking = false;
        this.toast.error(this.translate.t(selfUpdateErrorKey(error, 'selfUpdate.errors.checkFailed')));
      },
    });
  }

  private confirmAndTrigger(commitsBehind: number): void {
    void this.confirm
      .ask({
        title: this.translate.t('selfUpdate.confirmUpdate.title'),
        message: this.translate.t(
          commitsBehind === 1 ? 'selfUpdate.confirmUpdate.message.one' : 'selfUpdate.confirmUpdate.message.other',
          { count: commitsBehind }
        ),
        confirmText: this.translate.t('selfUpdate.confirmUpdate.confirmText'),
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
            this.toast.error(this.translate.t(selfUpdateErrorKey(error, 'selfUpdate.errors.startFailed')));
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
            this.toast.success(this.translate.t('selfUpdate.toast.upToDate'));
          } else if (status.latestRun?.state === 'error') {
            // The raw message is in the page's Technical details, not a toast.
            this.toast.error(this.translate.t('selfUpdate.toast.updateFailed'));
          }
        }
      });
  }
}
