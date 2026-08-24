import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, EMPTY, Subscription, catchError, finalize, retry, switchMap, tap, timer } from 'rxjs';
import { API_BASE_URL, extractErrorMessage } from './api';
import { SKIP_GLOBAL_ERROR_HANDLING } from './http-context';
import { ConnectionStatus, ServiceStatus, ServiceStatusResponse, ServiceSummary } from './models';
import { ToastService } from './toast.service';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root'
})
export class ServiceStateService {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

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
  private readonly connectionStatusSubject = new BehaviorSubject<ConnectionStatus>('connecting');

  private pollingSubscription?: Subscription;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempt = 0;
  private websocket?: WebSocket;
  private eventSource?: EventSource;

  readonly services$ = this.servicesSubject.asObservable();
  readonly summary$ = this.summarySubject.asObservable();
  readonly lastUpdated$ = this.lastUpdatedSubject.asObservable();
  readonly refreshing$ = this.refreshingSubject.asObservable();
  readonly operating$ = this.operatingSubject.asObservable();
  readonly connectionStatus$ = this.connectionStatusSubject.asObservable();

  startPolling(): void {
    this.stopPolling();
    this.connectionStatusSubject.next('connecting');
    this.connectWebSocket();
  }

  stopPolling(): void {
    this.websocket?.close();
    this.websocket = undefined;
    this.eventSource?.close();
    this.eventSource = undefined;
    this.pollingSubscription?.unsubscribe();
    this.pollingSubscription = undefined;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.connectionStatusSubject.next('disconnected');
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
        tap((response) => this.applyStatusResponse(response)),
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

  private applyStatusResponse(response: ServiceStatusResponse): void {
    this.servicesSubject.next(response.services);
    this.summarySubject.next(response.summary);
    this.lastUpdatedSubject.next(response.timestamp);
  }

  private connectWebSocket(): void {
    const token = this.auth.getAccessToken();
    if (!token) {
      this.startPollingFallback();
      return;
    }

    const loc = globalThis.location;
    const wsProtocol = loc?.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsBase = API_BASE_URL.startsWith('http')
      ? API_BASE_URL.replace(/^http/, 'ws').replace(/\/api$/, '')
      : `${wsProtocol}//${loc.host}`;

    this.websocket = new WebSocket(`${wsBase}/ws/services?token=${encodeURIComponent(token)}`);

    this.websocket.onopen = () => {
      this.reconnectAttempt = 0;
      this.connectionStatusSubject.next('connected');
    };

    this.websocket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as ServiceStatusResponse;
        this.applyStatusResponse(parsed);
      } catch {
        // Ignore malformed messages.
      }
    };

    this.websocket.onerror = () => {
      this.websocket?.close();
    };

    this.websocket.onclose = () => {
      this.websocket = undefined;
      this.connectSse();
    };
  }

  private connectSse(): void {
    const token = this.auth.getAccessToken();
    if (!token) {
      this.startPollingFallback();
      return;
    }

    this.connectionStatusSubject.next('sse');
    this.eventSource = new EventSource(`${API_BASE_URL}/services/stream?token=${encodeURIComponent(token)}`);

    const handler = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as ServiceStatusResponse;
        this.applyStatusResponse(parsed);
      } catch {
        // Ignore malformed messages.
      }
    };

    this.eventSource.onmessage = handler;
    this.eventSource.addEventListener('status', handler as EventListener);

    this.eventSource.onerror = () => {
      this.eventSource?.close();
      this.eventSource = undefined;
      this.startPollingFallback();
    };
  }

  private startPollingFallback(): void {
    this.connectionStatusSubject.next('polling');
    this.pollingSubscription?.unsubscribe();
    this.pollingSubscription = timer(0, 15000)
      .pipe(switchMap((tick) => this.fetchServices(tick === 0)))
      .subscribe();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.websocket || this.eventSource || this.reconnectTimer) {
      return;
    }

    const delayMs = Math.min(30000, 1000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connectWebSocket();
    }, delayMs);
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
