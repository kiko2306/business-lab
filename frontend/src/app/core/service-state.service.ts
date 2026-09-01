import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, EMPTY, Subject, Subscription, catchError, finalize, firstValueFrom, retry, switchMap, tap, timer } from 'rxjs';
import { API_BASE_URL, extractErrorMessage } from './api';
import { SKIP_GLOBAL_ERROR_HANDLING } from './http-context';
import {
  ConnectionStatus,
  ServiceAction,
  ServiceActionResponse,
  ServiceStatus,
  ServiceStatusResponse,
  ServiceSummary,
  StartupActionEvent,
} from './models';
import { ToastService } from './toast.service';
import { AuthService } from './auth.service';

/**
 * Pull the most detailed text out of a failed start response — the backend
 * puts the raw `docker compose up` output in `message`/`details`, which is
 * what actually explains a failure (port clash, missing image, bad env).
 */
function extractStartFailureDetail(error: unknown): string | null {
  if (error instanceof HttpErrorResponse && error.error && typeof error.error === 'object') {
    const body = error.error as { message?: unknown; details?: unknown };
    const candidates = [body.details, body.message].filter(
      (part): part is string => typeof part === 'string' && part.trim().length > 0
    );
    if (candidates.length) {
      // `details` usually repeats `message`'s text plus the compose progress
      // lines, so the longer of the two is the fuller picture.
      return candidates.sort((a, b) => b.length - a.length)[0].trim();
    }
  }
  return null;
}

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
  private readonly operatingSubject = new BehaviorSubject<Record<string, ServiceAction | null>>({});
  private readonly connectionStatusSubject = new BehaviorSubject<ConnectionStatus>('connecting');
  // Fires once per start attempt with the `docker compose up` outcome, so the
  // startup-log popup can show the command's own error (e.g. a port clash)
  // and not just the container logs.
  private readonly startupEventsSubject = new Subject<StartupActionEvent>();

  private pollingSubscription?: Subscription;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempt = 0;
  private websocket?: WebSocket;
  private eventSource?: EventSource;
  private stopped = true;

  readonly services$ = this.servicesSubject.asObservable();
  readonly summary$ = this.summarySubject.asObservable();
  readonly lastUpdated$ = this.lastUpdatedSubject.asObservable();
  readonly refreshing$ = this.refreshingSubject.asObservable();
  readonly operating$ = this.operatingSubject.asObservable();
  readonly connectionStatus$ = this.connectionStatusSubject.asObservable();
  readonly startupEvents$ = this.startupEventsSubject.asObservable();

  startPolling(): void {
    this.stopped = false;
    this.stopPolling();
    this.stopped = false;
    this.connectionStatusSubject.next('connecting');
    void this.connectWebSocket();
  }

  stopPolling(): void {
    this.stopped = true;
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

  updateService(serviceName: string): void {
    this.runServiceAction(serviceName, 'update');
  }

  /**
   * Build a ticket-authenticated URL for the service's startup log SSE
   * stream (an EventSource can't send an Authorization header). Returns null
   * if no ticket could be obtained (e.g. not logged in).
   */
  async createStartupLogUrl(serviceName: string): Promise<string | null> {
    const ticket = await this.getStreamTicket();
    if (!ticket) {
      return null;
    }
    return `${API_BASE_URL}/services/${encodeURIComponent(serviceName)}/startup-logs?ticket=${encodeURIComponent(ticket)}`;
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

  private async connectWebSocket(): Promise<void> {
    if (this.stopped) {
      return;
    }

    const ticket = await this.getStreamTicket();
    if (!ticket) {
      this.startPollingFallback();
      return;
    }

    const loc = globalThis.location;
    const wsProtocol = loc?.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsBase = API_BASE_URL.startsWith('http')
      ? API_BASE_URL.replace(/^http/, 'ws').replace(/\/api$/, '')
      : `${wsProtocol}//${loc.host}`;

    this.websocket = new WebSocket(`${wsBase}/ws/services?ticket=${encodeURIComponent(ticket)}`);

    this.websocket.onopen = () => {
      this.reconnectAttempt = 0;
      this.pollingSubscription?.unsubscribe();
      this.pollingSubscription = undefined;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
      }
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
      if (this.stopped) {
        return;
      }
      this.websocket = undefined;
      void this.connectSse();
    };
  }

  private async connectSse(): Promise<void> {
    if (this.stopped) {
      return;
    }
    const ticket = await this.getStreamTicket();
    if (!ticket) {
      this.startPollingFallback();
      return;
    }

    this.connectionStatusSubject.next('sse');
    this.eventSource = new EventSource(`${API_BASE_URL}/services/stream?ticket=${encodeURIComponent(ticket)}`);

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
      void this.connectWebSocket();
    }, delayMs);
  }

  private async getStreamTicket(): Promise<string | null> {
    if (!this.auth.getAccessToken()) {
      return null;
    }

    try {
      const response = await firstValueFrom(
        this.http.post<{ ticket: string }>(
          `${API_BASE_URL}/services/stream-ticket`,
          {},
          { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
        )
      );
      return response.ticket;
    } catch {
      return null;
    }
  }

  private runServiceAction(serviceName: string, action: ServiceAction): void {
    this.operatingSubject.next({
      ...this.operatingSubject.value,
      [serviceName]: action,
    });

    this.http
      .post<ServiceActionResponse>(
        `${API_BASE_URL}/services/${serviceName}/${action}`,
        {},
        { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
      )
      .pipe(
        // An update pulls images and recreates the container — minutes, not
        // seconds. Retrying one that appears to have failed would run the
        // whole thing a second time on top of the first.
        action === 'update' ? tap() : retry({ count: 1, delay: 500 }),
        tap((response) => {
          this.toast.success(response.message);
          if (action !== 'stop') {
            this.startupEventsSubject.next({ serviceName, ok: true, message: response.message });
          }
          if (response.exposure?.attempted && !response.exposure.success && response.exposure.warning) {
            this.toast.error(response.exposure.warning);
          }
        }),
        switchMap(() => this.fetchServices(false)),
        finalize(() => {
          this.operatingSubject.next({
            ...this.operatingSubject.value,
            [serviceName]: null,
          });
        }),
        catchError((error) => {
          const message = extractErrorMessage(error, `Unable to ${action} ${serviceName}.`);
          this.toast.error(message);
          if (action !== 'stop') {
            this.startupEventsSubject.next({
              serviceName,
              ok: false,
              message: extractStartFailureDetail(error) ?? message,
            });
          }
          return EMPTY;
        })
      )
      .subscribe();
  }
}
