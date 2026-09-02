import { CommonModule } from '@angular/common';
import {
  AfterViewChecked,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription, filter, finalize } from 'rxjs';
import { extractErrorMessage } from '../../core/api';
import {
  AutheliaAdminUser,
  ServiceEnvField,
  ServiceEnvStatus,
  ServiceAction,
  ServiceExposureConfig,
  ServiceStatus,
  StartupActionEvent,
} from '../../core/models';
import { OperationsService } from '../../core/operations.service';
import { ServiceStateService } from '../../core/service-state.service';
import { ToastService } from '../../core/toast.service';

type StartupPhase = 'streaming' | 'running' | 'error' | 'timeout';

interface DependencyState {
  name: string;
  label: string;
  running: boolean;
  // dependsOn (blocks the start) rather than requires (functional only).
  blocking: boolean;
  // Replaces the generic tooltip when this dependency needs a specific reason.
  note?: string;
}

@Component({
  selector: 'app-service-card',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './service-card.component.html',
  styleUrl: './service-card.component.css'
})
export class ServiceCardComponent implements OnDestroy, AfterViewChecked {
  private readonly operations = inject(OperationsService);
  private readonly serviceState = inject(ServiceStateService);
  private readonly toast = inject(ToastService);

  @Input({ required: true }) service!: ServiceStatus;
  @Input() allServices: ServiceStatus[] = [];
  @Input() loadingAction: ServiceAction | null = null;

  @Output() actionRequested = new EventEmitter<ServiceAction>();

  // All per-service setup (configuration, exposure, admin account) lives in a
  // single modal opened from the row, instead of inline expanding panels.
  protected settingsModalOpen = false;

  protected exposureLoading = false;
  protected exposureSaving = false;
  protected exposureVerifying = false;
  protected exposure: ServiceExposureConfig | null = null;

  protected exposureEnabled = false;
  protected exposureAutheliaProtected = false;

  protected envLoading = false;
  protected envSaving = false;
  protected env: ServiceEnvStatus | null = null;
  protected envValues: Record<string, string> = {};

  protected setupTokenLoading = false;
  protected setupTokenResetting = false;
  protected setupToken: string | null = null;
  protected setupTokenCopied = false;

  protected adminUserLoading = false;
  protected adminUserSaving = false;
  protected adminUser: AutheliaAdminUser | null = null;
  protected adminUserForm = { username: '', displayName: '', email: '', password: '' };

  protected startupLogsOpen = false;
  protected startupLogLines: string[] = [];
  protected startupPhase: StartupPhase = 'streaming';
  private startupLogSource?: EventSource;
  private startupActionSub?: Subscription;
  private startupAutoCloseTimer?: ReturnType<typeof setTimeout>;
  private scrollLogsPending = false;

  @ViewChild('startupLogBody') private startupLogBody?: ElementRef<HTMLElement>;

  /** An image the daily sweep found a newer version of (§82.1). */
  protected updateAvailable(): boolean {
    return (this.service.updateImages?.length ?? 0) > 0;
  }

  protected updateTitle(): string {
    const images = this.service.updateImages ?? [];
    if (!images.length) {
      return 'Pull newer images and recreate the container';
    }
    return `Newer image${images.length === 1 ? '' : 's'} available: ${images.join(', ')}`;
  }

  requestAction(action: ServiceAction): void {
    // An update pulls and recreates, so it produces exactly the output a start
    // does — and is the one most worth watching, since a new image is the most
    // likely thing to come up broken.
    if (action !== 'stop') {
      void this.openStartupLogs();
    }
    this.actionRequested.emit(action);
  }

  ngAfterViewChecked(): void {
    if (this.scrollLogsPending && this.startupLogBody) {
      const el = this.startupLogBody.nativeElement;
      el.scrollTop = el.scrollHeight;
      this.scrollLogsPending = false;
    }
  }

  ngOnDestroy(): void {
    this.teardownStartupLogs();
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.startupLogsOpen) {
      this.closeStartupLogs();
    } else if (this.settingsModalOpen) {
      this.closeSettings();
    }
  }

  openSettings(): void {
    this.settingsModalOpen = true;
    if (!this.env) {
      this.loadEnv();
    }
    if (this.service.setupTokenSupported && this.setupToken === null) {
      this.loadSetupToken();
    }
    if (!this.exposure) {
      this.loadExposure();
    }
    if (this.service.adminUserManagementSupported && !this.adminUser) {
      this.loadAdminUser();
    }
  }

  closeSettings(): void {
    this.settingsModalOpen = false;
  }

  private async openStartupLogs(): Promise<void> {
    this.teardownStartupLogs();
    this.startupLogsOpen = true;
    this.startupLogLines = [];
    this.startupPhase = 'streaming';

    // Listen for this start attempt's `docker compose up` outcome so a
    // command-level failure (port clash, bad env, missing image) shows in
    // the popup even though the container never produced any logs.
    this.startupActionSub = this.serviceState.startupEvents$
      .pipe(filter((event) => event.serviceName === this.service.name))
      .subscribe((event) => this.applyStartupActionResult(event));

    const url = await this.serviceState.createStartupLogUrl(this.service.name);
    if (!url) {
      this.pushStartupLine('Unable to open the log stream — try reloading the dashboard.');
      this.startupPhase = 'error';
      return;
    }
    if (!this.startupLogsOpen) {
      return; // closed again while the ticket request was in flight
    }

    const source = new EventSource(url);
    this.startupLogSource = source;

    source.addEventListener('log', (event) => {
      try {
        const { line } = JSON.parse((event as MessageEvent<string>).data) as { line: string };
        this.pushStartupLine(line);
      } catch {
        // ignore malformed frames
      }
    });

    source.addEventListener('done', (event) => {
      try {
        const info = JSON.parse((event as MessageEvent<string>).data) as {
          state?: string;
          healthy?: boolean;
          timedOut?: boolean;
        };
        this.startupPhase = info.timedOut
          ? 'timeout'
          : info.state === 'running' && info.healthy
            ? 'running'
            : 'error';
      } catch {
        this.startupPhase = 'error';
      }
      source.close();
      this.startupLogSource = undefined;
      if (this.startupPhase === 'running') {
        this.startupAutoCloseTimer = setTimeout(() => this.closeStartupLogs(), 2500);
      }
    });

    source.onerror = () => {
      if (this.startupPhase === 'streaming') {
        this.pushStartupLine('— log stream disconnected —');
      }
      source.close();
      this.startupLogSource = undefined;
    };
  }

  private applyStartupActionResult(event: StartupActionEvent): void {
    if (!this.startupLogsOpen || this.startupPhase !== 'streaming') {
      return;
    }
    if (event.ok) {
      return; // container is coming up — let the log stream report the rest
    }
    for (const raw of event.message.split('\n')) {
      const line = raw.replace(/\s+$/, '');
      if (line) {
        this.pushStartupLine(line);
      }
    }
    this.pushStartupLine('— docker compose could not start this service —');
    this.startupPhase = 'error';
    this.startupLogSource?.close();
    this.startupLogSource = undefined;
    this.startupActionSub?.unsubscribe();
    this.startupActionSub = undefined;
  }

  private pushStartupLine(line: string): void {
    this.startupLogLines.push(line);
    if (this.startupLogLines.length > 600) {
      this.startupLogLines.splice(0, this.startupLogLines.length - 600);
    }
    this.scrollLogsPending = true;
  }

  closeStartupLogs(): void {
    this.teardownStartupLogs();
    this.startupLogsOpen = false;
  }

  private teardownStartupLogs(): void {
    this.startupLogSource?.close();
    this.startupLogSource = undefined;
    this.startupActionSub?.unsubscribe();
    this.startupActionSub = undefined;
    if (this.startupAutoCloseTimer) {
      clearTimeout(this.startupAutoCloseTimer);
      this.startupAutoCloseTimer = undefined;
    }
  }

  protected startupPhaseLabel(): string {
    switch (this.startupPhase) {
      case 'streaming':
        return 'starting…';
      case 'running':
        return 'running';
      case 'error':
        return 'failed';
      case 'timeout':
        return 'still starting';
    }
  }

  protected startupPhaseBadgeClass(): Record<string, boolean> {
    return {
      'text-bg-secondary': this.startupPhase === 'streaming',
      'text-bg-success': this.startupPhase === 'running',
      'text-bg-danger': this.startupPhase === 'error',
      'text-bg-warning': this.startupPhase === 'timeout',
    };
  }

  protected startupFootNote(): string {
    switch (this.startupPhase) {
      case 'streaming':
        return 'Streaming container logs until the service is running and healthy…';
      case 'running':
        return `${this.service.label} is up and healthy.`;
      case 'error':
        return `${this.service.label} did not come up — check the log above for the error.`;
      case 'timeout':
        return 'Still starting after a few minutes — leaving the logs here so you can keep watching.';
    }
  }

  protected startupLogText(): string {
    return this.startupLogLines.length ? this.startupLogLines.join('\n') : 'Waiting for output…';
  }

  /**
   * Both tiers of dependency, for display. `blocking` ones (dependsOn) stop
   * the app booting at all and disable Start; the rest (requires) break what
   * the app does without stopping it from coming up, so they are shown and
   * warned about but never gate the button.
   */
  dependencies(): DependencyState[] {
    const resolve = (names: string[] | undefined, blocking: boolean): DependencyState[] =>
      (names ?? []).map((name) => {
        const dep = this.allServices.find((s) => s.name === name);
        return { name, label: dep?.label ?? name, running: dep?.state === 'running', blocking };
      });
    return [
      ...resolve(this.service.dependsOn, true),
      ...resolve(this.service.requires, false),
      ...this.proxyDependency(),
    ];
  }

  /**
   * Ingress is Cloudflare Tunnel -> NPM -> app, so an exposed app's public URL
   * dies with the proxy while the app itself keeps working on its LAN port.
   *
   * Derived from live exposure rather than declared per app: it is true of
   * every exposed app and of none of the others, and which is which is a
   * runtime setting, not a property of the app. Declaring it in the registry
   * would put the same chip on all ~36 entries and still be wrong for the
   * ones nobody has exposed.
   *
   * exposedHostname is only set while the app is running, so a stopped app
   * shows no proxy chip — there is no public URL to lose yet.
   */
  private proxyDependency(): DependencyState[] {
    const name = 'nginx-proxy-manager';
    const declared = [...(this.service.dependsOn ?? []), ...(this.service.requires ?? [])];
    if (this.service.name === name || declared.includes(name) || !this.service.exposedHostname) {
      return [];
    }
    const proxy = this.allServices.find((s) => s.name === name);
    return [
      {
        name,
        label: proxy?.label ?? 'Nginx Proxy Manager',
        running: proxy?.state === 'running',
        blocking: false,
        note: `${this.service.exposedHostname} is served through it — the app itself keeps working without it.`,
      },
    ];
  }

  dependencyStates(): DependencyState[] {
    return this.dependencies().filter((d) => d.blocking);
  }

  dependenciesSatisfied(): boolean {
    return this.dependencyStates().every((d) => d.running);
  }

  startBlockedTitle(): string {
    const notRunning = this.dependencyStates()
      .filter((d) => !d.running)
      .map((d) => d.label);
    return notRunning.length ? `Start ${notRunning.join(', ')} first` : '';
  }

  /**
   * Non-blocking dependencies that are down — the app runs, but part of what
   * it does is broken (NetBird without Tailscale registers no peers).
   */
  degradedBy(): string[] {
    return this.dependencies()
      .filter((d) => !d.blocking && !d.running)
      .map((d) => d.label);
  }

  degradedTitle(): string {
    const down = this.degradedBy();
    return down.length ? `Runs, but needs ${down.join(' and ')} to work properly` : '';
  }

  dependencyTitle(dep: DependencyState): string {
    const state = dep.running ? 'running' : 'not running';
    if (dep.note) {
      return `${dep.label} — ${state}. ${dep.note}`;
    }
    return dep.blocking
      ? `${dep.label} — ${state}. Required to start.`
      : `${dep.label} — ${state}. Needed for this app to work, not to start.`;
  }

  loadExposure(): void {
    this.exposureLoading = true;
    this.operations
      .getServiceExposure(this.service.name)
      .pipe(finalize(() => (this.exposureLoading = false)))
      .subscribe({
        next: (config) => {
          this.exposure = config;
          this.exposureEnabled = config.enabled;
          this.exposureAutheliaProtected = config.autheliaProtected;
        },
        error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to load exposure configuration.')),
      });
  }

  saveExposure(): void {
    this.exposureSaving = true;
    this.operations
      .updateServiceExposure(this.service.name, {
        enabled: this.exposureEnabled,
        autheliaProtected: this.exposureAutheliaProtected,
      })
      .pipe(finalize(() => (this.exposureSaving = false)))
      .subscribe({
        next: (response) => {
          this.toast.success(response.message);
          this.loadExposure();
        },
        error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to save exposure configuration.')),
      });
  }

  verifyExposure(): void {
    this.exposureVerifying = true;
    this.operations
      .verifyServiceExposure(this.service.name)
      .pipe(finalize(() => (this.exposureVerifying = false)))
      .subscribe({
        next: (result) => {
          if (result.success) {
            this.toast.success(`Exposure verified — reconciled with the live NPM/Cloudflare state.`);
          } else if (result.warning) {
            this.toast.error(result.warning);
          }
          this.loadExposure();
        },
        error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to verify exposure configuration.')),
      });
  }

  loadSetupToken(): void {
    this.setupTokenLoading = true;
    this.operations
      .getServiceSetupToken(this.service.name)
      .pipe(finalize(() => (this.setupTokenLoading = false)))
      .subscribe({
        next: (result) => (this.setupToken = result.token),
        error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to load setup token.')),
      });
  }

  copySetupToken(): void {
    if (!this.setupToken) {
      return;
    }
    navigator.clipboard.writeText(this.setupToken).then(() => {
      this.setupTokenCopied = true;
      setTimeout(() => (this.setupTokenCopied = false), 2000);
    });
  }

  resetSetupToken(): void {
    this.setupTokenResetting = true;
    this.operations
      .resetServiceSetupToken(this.service.name)
      .pipe(finalize(() => (this.setupTokenResetting = false)))
      .subscribe({
        next: (result) => {
          this.setupToken = result.token;
          if (result.token) {
            this.toast.success('Restarted — a fresh setup token is ready. Complete setup within 5 minutes.');
          } else {
            this.toast.info('Restarted, but no token appeared yet — reopen this panel in a moment to retry.');
          }
        },
        error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to reset the setup token.')),
      });
  }

  loadEnv(): void {
    this.envLoading = true;
    this.operations
      .getServiceEnv(this.service.name)
      .pipe(finalize(() => (this.envLoading = false)))
      .subscribe({
        next: (env) => {
          this.env = env;
          this.envValues = {};
          for (const field of env.fields) {
            // Hidden secrets are generated server-side on save; managed keys
            // follow the exposure hostname; locked keys are fixed protocol
            // ports the backend refuses to write. The client submits none of
            // them — the read-only inputs render straight from the field, not
            // from envValues.
            if (field.hidden || field.managed || field.locked) {
              continue;
            }
            if (field.boolean) {
              this.envValues[field.key] = field.value ?? field.suggestedValue ?? field.defaultValue ?? 'false';
            } else if (!field.secret) {
              // Prefill with the current value, else a suggestion (generated
              // secret / global timezone), else the compose default for port
              // fields so a clashing default surfaces its conflict right away.
              this.envValues[field.key] =
                field.value ?? field.suggestedValue ?? (field.isPort ? field.defaultValue : null) ?? '';
            } else if (field.suggestedValue) {
              this.envValues[field.key] = field.suggestedValue;
            }
          }
        },
        error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to load configuration.')),
      });
  }

  missingRequiredCount(): number {
    return this.env?.fields.filter((field) => field.required && !field.isSet).length ?? 0;
  }

  /**
   * Read-only value shown for an exposure-managed field: the exact value the
   * exposure system injects (scheme+host for URL keys, bare host for host
   * keys, the merged allow-list, `https` for protocol knobs, …) when exposure
   * is on, otherwise the current .env value or the compose default.
   */
  protected managedFieldValue(field: ServiceEnvField): string {
    return field.managedValue ?? field.value ?? field.defaultValue ?? '—';
  }

  /**
   * A port field still shows a conflict while its value is unchanged from the
   * one the backend flagged as in use — once the user edits it (or takes the
   * suggested free port) the warning clears; the backend re-checks on save.
   */
  protected portConflict(field: ServiceEnvField): boolean {
    if (!field.portInUse) {
      return false;
    }
    const flaggedValue = field.value ?? field.defaultValue ?? '';
    return (this.envValues[field.key] ?? '') === flaggedValue;
  }

  protected hasPortConflict(): boolean {
    return this.env?.fields.some((field) => this.portConflict(field)) ?? false;
  }

  protected useSuggestedPort(field: ServiceEnvField): void {
    if (field.suggestedPort != null) {
      this.envValues[field.key] = String(field.suggestedPort);
    }
  }

  saveEnv(): void {
    this.envSaving = true;
    this.operations
      .updateServiceEnv(this.service.name, this.envValues)
      .pipe(finalize(() => (this.envSaving = false)))
      .subscribe({
        next: (response) => {
          this.toast.success(response.message);
          this.loadEnv();
        },
        error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to save configuration.')),
      });
  }

  loadAdminUser(): void {
    this.adminUserLoading = true;
    this.operations
      .getAutheliaAdminUser(this.service.name)
      .pipe(finalize(() => (this.adminUserLoading = false)))
      .subscribe({
        next: (user) => {
          this.adminUser = user;
          this.adminUserForm = { username: user.username, displayName: user.displayName, email: user.email, password: '' };
        },
        error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to load admin account.')),
      });
  }

  saveAdminUser(): void {
    this.adminUserSaving = true;
    const { username, displayName, email, password } = this.adminUserForm;
    this.operations
      .updateAutheliaAdminUser(this.service.name, {
        username,
        displayName,
        email,
        ...(password ? { password } : {}),
      })
      .pipe(finalize(() => (this.adminUserSaving = false)))
      .subscribe({
        next: (response) => {
          this.toast.success(response.message);
          this.adminUserForm.password = '';
          this.loadAdminUser();
        },
        error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to save admin account.')),
      });
  }

  serviceIcon(icon: string): string {
    const icons: Record<string, string> = {
      nginx: '🌐',
      vpn: '🔐',
      home: '🏠',
      cloud: '☁️',
      code: '💻',
      book: '📚',
      folder: '🗂️',
      dashboard: '🧭',
      workflow: '🔁',
      document: '📄',
      shield: '🛡️',
      speed: '⚡',
      lock: '🔒',
      pulse: '📈',
      key: '🔑',
      backup: '💾',
      photo: '📷',
      media: '🎬',
      tasks: '✅',
      update: '🔄',
      bell: '🔔',
      pdf: '📕',
      chat: '💬',
      table: '🗃️',
      siren: '🚨',
      pantry: '🥫',
      switch: '🔀',
      fridge: '🧊',
      cart: '🛒',
      remote: '🖥️',
    };

    return icons[icon] ?? '🖥️';
  }

  stateBadge(state: ServiceStatus['state']): string {
    switch (state) {
      case 'running':
        return 'success';
      case 'starting':
        return 'warning';
      case 'error':
        return 'danger';
      case 'stopped':
        return 'secondary';
      default:
        return 'dark';
    }
  }

  healthLabel(): string {
    if (this.service.state !== 'running') {
      return 'inactive';
    }

    return this.service.healthy ? 'healthy' : 'check failed';
  }

  healthClass(): string {
    return this.service.healthy ? 'text-success border-success-subtle' : 'text-secondary';
  }
}
