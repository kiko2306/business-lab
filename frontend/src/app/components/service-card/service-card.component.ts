import { CommonModule } from '@angular/common';
import {
  AfterViewChecked,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  NgZone,
  OnDestroy,
  Output,
  ViewChild,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription, filter, finalize } from 'rxjs';
import { extractErrorMessage } from '../../core/api';
import {
  AppBackupEntry,
  AutheliaAdminUser,
  ServiceEnvField,
  ServiceEnvStatus,
  ServiceAction,
  ServiceStatus,
  StartupActionEvent,
} from '../../core/models';
import { ConfirmOptions, ConfirmService } from '../../core/confirm.service';
import { OperationsService } from '../../core/operations.service';
import { ServiceStateService } from '../../core/service-state.service';
import { ToastService } from '../../core/toast.service';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { TranslateService } from '../../i18n/translate.service';

// SIGNUPS_ALLOWED -> "Signups allowed": the registry has no per-key labels, and
// a derived one beats a raw env key for a non-technical owner (plan.md §761).
export function humanizeEnvKey(key: string): string {
  const words = key.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Initials, not the registry's emoji: emoji render differently per OS and read
// as noise beside 36 rows (plan.md §761). "Home Assistant" -> HA, "Jellyfin" -> Je.
export function serviceInitials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return '?';
  }
  return words.length > 1 ? (words[0][0] + words[1][0]).toUpperCase() : words[0].slice(0, 2).replace(/^./, (c) => c.toUpperCase());
}

const CORE_SERVICES = new Set(['authelia', 'nginx-proxy-manager']);

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
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './service-card.component.html',
  styleUrl: './service-card.component.css'
})
export class ServiceCardComponent implements OnDestroy, AfterViewChecked {
  private readonly operations = inject(OperationsService);
  private readonly serviceState = inject(ServiceStateService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly zone = inject(NgZone);
  protected readonly translate = inject(TranslateService);
  protected readonly envLabel = humanizeEnvKey;
  protected readonly initials = serviceInitials;

  @Input({ required: true }) service!: ServiceStatus;
  @Input() allServices: ServiceStatus[] = [];
  @Input() loadingAction: ServiceAction | null = null;
  // The Docker host's real LAN IP (networkScan.ts), for a lanOnly/overlayOnly
  // app's access link — falls back to this dashboard's own hostname (wrong
  // when that's a public subdomain the tunnel doesn't forward raw ports on)
  // only if the backend hasn't resolved one yet.
  @Input() hostLanIp: string | null = null;

  @Output() startWithNeedsRequested = new EventEmitter<void>();
  @Output() actionRequested = new EventEmitter<ServiceAction>();

  // All per-service setup (configuration, admin account) lives in a single
  // modal opened from the row, instead of inline expanding panels.
  protected settingsModalOpen = false;

  protected envLoading = false;
  protected envSaving = false;
  protected env: ServiceEnvStatus | null = null;
  // What the config panel actually renders: every field that isn't a hidden
  // generated secret or a host port. Computed on load rather than in the
  // template, so change detection doesn't re-filter on every tick.
  protected visibleEnvFields: ServiceEnvField[] = [];
  protected envValues: Record<string, string> = {};


  protected adminUserLoading = false;
  protected adminUserSaving = false;
  protected adminUser: AutheliaAdminUser | null = null;
  protected adminUserForm = { username: '', displayName: '', email: '', password: '' };

  // Per-app backup archives (plan.md §185). A local rollback point, distinct
  // from the scheduled off-site backup.
  protected backupsLoading = false;
  protected backupsCreating = false;
  protected appBackups: AppBackupEntry[] = [];
  /** The file currently being restored / deleted, so its row can show a spinner. */
  protected backupBusyFile: string | null = null;

  protected startupLogsOpen = false;
  protected startupLogLines: string[] = [];
  protected startupPhase: StartupPhase = 'streaming';
  private startupLogSource?: EventSource;
  private startupActionSub?: Subscription;
  private startupAutoCloseTimer?: ReturnType<typeof setTimeout>;
  private scrollLogsPending = false;
  // A chatty first boot (Twenty: thousands of migration/cron lines, §371) can
  // fire the 'log' SSE event faster than the UI can usefully redraw. Each one
  // used to run inside Angular's zone and trigger a full change-detection
  // pass plus a scrollTop/scrollHeight reflow, freezing the tab for the
  // burst's duration. Buffer lines outside the zone and flush them in
  // batches instead — the DOM updates a few times a second no matter how
  // fast the backend is emitting.
  private pendingStartupLines: string[] = [];
  private startupFlushTimer?: ReturnType<typeof setTimeout>;

  // Dialogs are focused when they render (the setters fire once the element
  // exists) and hand focus back to whatever opened them (plan.md §761).
  private opener: HTMLElement | null = null;
  @ViewChild('settingsDialog') protected set settingsDialogEl(el: ElementRef<HTMLElement> | undefined) {
    el?.nativeElement.focus();
  }
  @ViewChild('startupDialog') protected set startupDialogEl(el: ElementRef<HTMLElement> | undefined) {
    el?.nativeElement.focus();
  }
  @ViewChild('startupLogBody') private startupLogBody?: ElementRef<HTMLElement>;

  /**
   * What's actually installed: the last self-update's pinned image ref when
   * there is one, else the version baked into the app's own compose file,
   * else just "latest" (never pulled by a self-update).
   *
   * The `@sha256:…` half of a pin is dropped: it is 71 characters that push
   * the rest of the row off the panel and say nothing a human acts on — the
   * image and tag are what identifies the build. The exact digest is still in
   * docker-compose.override.yml for anything that needs it.
   */
  protected installedVersion(): string {
    if (this.service.pinnedImages?.length) {
      return this.service.pinnedImages.map((image) => image.split('@')[0]).join(', ');
    }
    if (this.service.versionPinned?.length) {
      return this.service.versionPinned.join(', ');
    }
    return this.translate.t('serviceCard.latestVersion');
  }

  /**
   * A `lanOnly`/`overlayOnly` app never gets an `exposedHostname` (kept off
   * the public tunnel regardless of exposability), but a browser already on
   * the LAN or the overlay VPN reaches it the same way: this dashboard's own
   * hostname, at the app's published web port.
   */
  protected lanAccessUrl(): string | null {
    if (!this.service.webPort) {
      return null;
    }
    const host = this.hostLanIp ?? window.location.hostname;
    return `http://${host}:${this.service.webPort}${this.service.webPath ?? ''}`;
  }

  /**
   * What Stop must confirm first, or null when it is safe as one click.
   * Stopping the SSO or the proxy silently takes every gated/exposed app down;
   * stopping an exposed app takes its public page and Home Page tile down for
   * everyone (an outward-facing action, PRODUCT.md), so it is confirmed too.
   */
  private stopConfirmation(): ConfirmOptions | null {
    const label = this.service.label;
    if (CORE_SERVICES.has(this.service.name)) {
      return {
        title: this.translate.t('serviceCard.confirmStopCore.title', { label }),
        message: this.translate.t('serviceCard.confirmStopCore.message', { label }),
        confirmText: this.translate.t('serviceCard.confirmStopCore.confirmText'),
      };
    }
    if (this.service.exposedHostname) {
      return {
        title: this.translate.t('serviceCard.confirmStopExposed.title', { label }),
        message: this.translate.t('serviceCard.confirmStopExposed.message', { label, hostname: this.service.exposedHostname }),
        confirmText: this.translate.t('serviceCard.confirmStopExposed.confirmText'),
        danger: true,
      };
    }
    return null;
  }

  async requestAction(action: ServiceAction): Promise<void> {
    if (action === 'stop') {
      const options = this.stopConfirmation();
      if (options && !(await this.confirm.ask(options))) {
        return;
      }
    }
    if (action === 'start') {
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

  /** Keeps Tab/Shift+Tab inside the dialog: aria-modal alone does not trap focus. */
  protected trapTab(event: KeyboardEvent): void {
    if (event.key !== 'Tab') {
      return;
    }
    const dialog = event.currentTarget as HTMLElement;
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
    );
    if (!focusable.length) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog)) {
      last.focus();
      event.preventDefault();
    } else if (!event.shiftKey && active === last) {
      first.focus();
      event.preventDefault();
    }
  }

  private restoreFocus(): void {
    this.opener?.focus();
    this.opener = null;
  }

  openSettings(): void {
    this.opener = document.activeElement as HTMLElement | null;
    this.settingsModalOpen = true;
    if (!this.env) {
      this.loadEnv();
    }
    if (this.service.adminUserManagementSupported && !this.adminUser) {
      this.loadAdminUser();
    }
    this.loadAppBackups();
  }

  closeSettings(): void {
    this.settingsModalOpen = false;
    this.restoreFocus();
  }

  private async openStartupLogs(): Promise<void> {
    this.teardownStartupLogs();
    this.opener = document.activeElement as HTMLElement | null;
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
      this.pushStartupLine(this.translate.t('serviceCard.startupLogs.unableToOpen'));
      this.startupPhase = 'error';
      return;
    }
    if (!this.startupLogsOpen) {
      return; // closed again while the ticket request was in flight
    }

    const source = new EventSource(url);
    this.startupLogSource = source;

    // Registered outside the Angular zone so a burst of events doesn't queue
    // a change-detection pass per line — only the throttled flush re-enters
    // the zone.
    this.zone.runOutsideAngular(() => {
      source.addEventListener('log', (event) => {
        try {
          const { line } = JSON.parse((event as MessageEvent<string>).data) as { line: string };
          this.queueStartupLine(line);
        } catch {
          // ignore malformed frames
        }
      });
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
        this.pushStartupLine(this.translate.t('serviceCard.startupLogs.disconnected'));
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
    this.pushStartupLine(this.translate.t('serviceCard.startupLogs.couldNotStart'));
    this.startupPhase = 'error';
    this.startupLogSource?.close();
    this.startupLogSource = undefined;
    this.startupActionSub?.unsubscribe();
    this.startupActionSub = undefined;
  }

  private queueStartupLine(line: string): void {
    this.pendingStartupLines.push(line);
    if (!this.startupFlushTimer) {
      this.startupFlushTimer = setTimeout(() => this.flushStartupLines(), 120);
    }
  }

  private flushStartupLines(): void {
    this.startupFlushTimer = undefined;
    const lines = this.pendingStartupLines;
    if (!lines.length) {
      return;
    }
    this.pendingStartupLines = [];
    this.zone.run(() => {
      for (const line of lines) {
        this.pushStartupLine(line);
      }
    });
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
    this.restoreFocus();
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
    if (this.startupFlushTimer) {
      clearTimeout(this.startupFlushTimer);
      this.startupFlushTimer = undefined;
    }
    this.pendingStartupLines = [];
  }

  protected startupPhaseLabel(): string {
    return this.translate.t(`serviceCard.startupLogs.phase.${this.startupPhase}`);
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
    if (this.startupPhase === 'running' || this.startupPhase === 'error') {
      return this.translate.t(`serviceCard.startupLogs.footNote.${this.startupPhase}`, { label: this.service.label });
    }
    return this.translate.t(`serviceCard.startupLogs.footNote.${this.startupPhase}`);
  }

  protected startupLogText(): string {
    return this.startupLogLines.length ? this.startupLogLines.join('\n') : this.translate.t('serviceCard.startupLogs.waitingForOutput');
  }

  /**
   * Both tiers of dependency, for display. `blocking` ones (dependsOn) stop
   * the app booting at all and disable Start; the rest (requires) break what
   * the app does without stopping it from coming up, so they are shown and
   * warned about but never gate the button.
   */
  /**
   * Resolved once per input change, not per call. The template reads this
   * through four different helpers, each read scanned the whole service list
   * once per declared dependency, and change detection runs on every event —
   * so a 50-app box was doing tens of thousands of comparisons per mouse move.
   */
  dependencies(): DependencyState[] {
    // Keyed on the two inputs by identity rather than on ngOnChanges: a status
    // payload replaces both objects, so this recomputes exactly when the
    // answer can have changed, and it cannot go stale if something assigns an
    // input directly.
    if (!this.resolved || this.resolved.service !== this.service || this.resolved.all !== this.allServices) {
      this.resolved = { service: this.service, all: this.allServices, deps: this.resolveDependencies() };
    }
    return this.resolved.deps;
  }

  private resolved?: { service: ServiceStatus; all: ServiceStatus[]; deps: DependencyState[] };

  private resolveDependencies(): DependencyState[] {
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
        note: this.translate.t('serviceCard.dependency.proxyNote', { hostname: this.service.exposedHostname ?? '' }),
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
    return notRunning.length ? this.translate.t('serviceCard.startBlocked', { names: notRunning.join(', ') }) : '';
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
    return down.length ? this.translate.t('serviceCard.degraded', { names: down.join(' and ') }) : '';
  }

  dependencyTitle(dep: DependencyState): string {
    const state = this.translate.t(dep.running ? 'serviceCard.dependency.running' : 'serviceCard.dependency.notRunning');
    if (dep.note) {
      return this.translate.t('serviceCard.dependency.titleWithNote', { label: dep.label, state, note: dep.note });
    }
    return this.translate.t(
      dep.blocking ? 'serviceCard.dependency.titleRequired' : 'serviceCard.dependency.titleNeeded',
      { label: dep.label, state }
    );
  }


  loadEnv(): void {
    this.envLoading = true;
    this.operations
      .getServiceEnv(this.service.name)
      .pipe(finalize(() => (this.envLoading = false)))
      .subscribe({
        next: (env) => {
          this.env = env;
          this.visibleEnvFields = env.fields.filter((field) => !field.hidden && !field.isPort);
          this.envValues = {};
          for (const field of env.fields) {
            // Hidden secrets are generated server-side on save; managed keys
            // follow the exposure hostname; host ports are allocated by
            // start.sh, not chosen here, so the panel neither shows nor
            // submits one — leaving a port out of the save keeps whatever the
            // allocator put in .env, since a save only writes the keys it is
            // given. The client submits none of them.
            if (field.hidden || field.managed || field.isPort) {
              continue;
            }
            if (field.boolean) {
              this.envValues[field.key] = field.value ?? field.suggestedValue ?? field.defaultValue ?? 'false';
            } else if (!field.secret) {
              // Prefill with the current value, else a suggestion (generated
              // secret / global timezone).
              this.envValues[field.key] = field.value ?? field.suggestedValue ?? '';
            } else if (field.suggestedValue) {
              this.envValues[field.key] = field.suggestedValue;
            }
          }
        },
        error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('serviceCard.errors.loadConfig'))),
      });
  }

  /** Counts only what the panel renders — a warning about a field nobody can see is a dead end. */
  missingRequiredCount(): number {
    return this.visibleEnvFields.filter((field) => field.required && !field.isSet).length;
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
        error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('serviceCard.errors.saveConfig'))),
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
        error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('serviceCard.errors.loadAdminAccount'))),
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
        error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('serviceCard.errors.saveAdminAccount'))),
      });
  }

  loadAppBackups(): void {
    this.backupsLoading = true;
    this.operations
      .listAppBackups(this.service.name)
      .pipe(finalize(() => (this.backupsLoading = false)))
      .subscribe({
        next: (response) => (this.appBackups = response.items),
        error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('serviceCard.errors.loadBackups'))),
      });
  }

  createAppBackup(): void {
    this.backupsCreating = true;
    this.operations
      .createAppBackup(this.service.name)
      .pipe(finalize(() => (this.backupsCreating = false)))
      .subscribe({
        next: (response) => {
          if (response.dumpFailures.length) {
            this.toast.error(response.message);
          } else {
            this.toast.success(response.message);
          }
          this.loadAppBackups();
        },
        error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('serviceCard.errors.backupFailed', { label: this.service.label }))),
      });
  }

  async restoreAppBackup(entry: AppBackupEntry): Promise<void> {
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
    this.backupBusyFile = entry.file;
    this.operations
      .restoreAppBackup(this.service.name, entry.file)
      .pipe(finalize(() => (this.backupBusyFile = null)))
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
          this.loadAppBackups();
        },
        error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('serviceCard.errors.restoreFailed', { label: this.service.label }))),
      });
  }

  async deleteAppBackup(entry: AppBackupEntry): Promise<void> {
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
    this.backupBusyFile = entry.file;
    this.operations
      .deleteAppBackup(this.service.name, entry.file)
      .pipe(finalize(() => (this.backupBusyFile = null)))
      .subscribe({
        next: (response) => {
          this.toast.success(response.message);
          this.loadAppBackups();
        },
        error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('serviceCard.errors.deleteSnapshot'))),
      });
  }

  downloadAppBackup(entry: AppBackupEntry): void {
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
  protected appBackupDetail(entry: AppBackupEntry): string {
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
      return this.translate.t('serviceCard.health.inactive');
    }

    return this.translate.t(this.service.healthy ? 'serviceCard.health.healthy' : 'serviceCard.health.checkFailed');
  }

  healthClass(): string {
    return this.service.healthy ? 'text-success border-success-subtle' : 'text-secondary';
  }
}
