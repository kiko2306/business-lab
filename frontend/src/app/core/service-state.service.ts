import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, EMPTY, Subscription, catchError, finalize, retry, switchMap, tap, timer } from 'rxjs';
import { API_BASE_URL, extractErrorMessage } from './api';
import { SKIP_GLOBAL_ERROR_HANDLING } from './http-context';
import { ServiceStatus, ServiceStatusResponse, ServiceSummary } from './models';
import { ToastService } from './toast.service';

@Injectable({
  providedIn: 'root'
})
export class ServiceStateService {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);

  private readonly servicesSubject = new BehaviorSubject<ServiceStatus[] | null>(null);
  private readonly summarySubject = new BehaviorSubject<ServiceSummary>({
    total: 0,
    running: 0,
    stopped: 0,
    error: 0,
    starting: 0,
  });
  private readonly lastUpdatedSubject = new BehaviorSubject<string | null>(null);
  private readonly refreshingSubject = new BehaviorSubject(false);
  private readonly operatingSubject = new BehaviorSubject<Record<string, 'start' | 'stop' | null>>({});

  private pollingSubscription?: Subscription;

  readonly services$ = this.servicesSubject.asObservable();
  readonly summary$ = this.summarySubject.asObservable();
  readonly lastUpdated$ = this.lastUpdatedSubject.asObservable();
  readonly refreshing$ = this.refreshingSubject.asObservable();
  readonly operating$ = this.operatingSubject.asObservable();

  startPolling(): void {
    if (this.pollingSubscription) {
      return;
    }

    this.pollingSubscription = timer(0, 15000)
      .pipe(switchMap((tick) => this.fetchServices(tick === 0)))
      .subscribe();
  }

  stopPolling(): void {
    this.pollingSubscription?.unsubscribe();
    this.pollingSubscription = undefined;
  }

  refresh(): void {
    this.fetchServices(true).subscribe();
  }

  startService(serviceName: string): void {
    this.runServiceAction(serviceName, 'start');
  }

  stopService(serviceName: string): void {
    this.runServiceAction(serviceName, 'stop');
  }

  private fetchServices(showLoader: boolean) {
    if (showLoader) {
      this.refreshingSubject.next(true);
    }

    return this.http
      .get<ServiceStatusResponse>(`${API_BASE_URL}/services/status`, {
        context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true),
      })
      .pipe(
        retry({ count: 1, delay: 500 }),
        tap((response) => {
          this.servicesSubject.next(response.services);
          this.summarySubject.next(response.summary);
          this.lastUpdatedSubject.next(response.timestamp);
        }),
        catchError((error) => {
          this.toast.error(extractErrorMessage(error, 'Unable to load service status.'));
          return EMPTY;
        }),
        finalize(() => {
          if (showLoader) {
            this.refreshingSubject.next(false);
          }
        })
      );
  }

  private runServiceAction(serviceName: string, action: 'start' | 'stop'): void {
    this.operatingSubject.next({
      ...this.operatingSubject.value,
      [serviceName]: action,
    });

    this.http
      .post<{ message: string }>(
        `${API_BASE_URL}/services/${serviceName}/${action}`,
        {},
        { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
      )
      .pipe(
        retry({ count: 1, delay: 500 }),
        tap((response) => this.toast.success(response.message)),
        switchMap(() => this.fetchServices(false)),
        finalize(() => {
          this.operatingSubject.next({
            ...this.operatingSubject.value,
            [serviceName]: null,
          });
        }),
        catchError((error) => {
          this.toast.error(extractErrorMessage(error, `Unable to ${action} ${serviceName}.`));
          return EMPTY;
        })
      )
      .subscribe();
  }
}
