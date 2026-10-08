import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { TranslateService } from '../../i18n/translate.service';
import { ServiceCardComponent, serviceInitials } from './service-card.component';
import { ConfirmService } from '../../core/confirm.service';
import { OperationsService } from '../../core/operations.service';
import { ServiceStateService } from '../../core/service-state.service';
import { ToastService } from '../../core/toast.service';
import { AppBackupEntry, ServiceEnvField, ServiceEnvStatus, ServiceStatus } from '../../core/models';

const service = (name: string, state: ServiceStatus['state'], extra: Partial<ServiceStatus> = {}): ServiceStatus => ({
  name,
  label: name,
  description: '',
  icon: '',
  state,
  healthy: state === 'running',
  lastChecked: '',
  ...extra,
});

describe('ServiceCardComponent dependencies', () => {
  let fixture: ComponentFixture<ServiceCardComponent>;
  let component: ServiceCardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ServiceCardComponent],
      providers: [
        { provide: OperationsService, useValue: jasmine.createSpyObj('OperationsService', ['getServiceEnv']) },
        { provide: ServiceStateService, useValue: jasmine.createSpyObj('ServiceStateService', ['refresh']) },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ServiceCardComponent);
    component = fixture.componentInstance;
  });

  const setUp = (netbird: Partial<ServiceStatus>, deps: ServiceStatus[]) => {
    component.service = service('netbird-vpn', 'stopped', netbird);
    component.allServices = [component.service, ...deps];
  };

  it('lists both tiers, marking only dependsOn as blocking', () => {
    setUp({ dependsOn: ['authelia'], requires: ['tailscale'] }, [
      service('authelia', 'running'),
      service('tailscale', 'stopped'),
    ]);

    expect(component.dependencies()).toEqual([
      { name: 'authelia', label: 'authelia', running: true, blocking: true },
      { name: 'tailscale', label: 'tailscale', running: false, blocking: false },
    ]);
  });

  it('blocks the start only while a dependsOn service is down', () => {
    setUp({ dependsOn: ['authelia'] }, [service('authelia', 'stopped')]);
    expect(component.dependenciesSatisfied()).toBe(false);
    expect(component.startBlockedTitle()).toBe('Start authelia first');

    setUp({ dependsOn: ['authelia'] }, [service('authelia', 'running')]);
    expect(component.dependenciesSatisfied()).toBe(true);
  });

  it('never blocks the start on a requires service, however many are down', () => {
    setUp({ requires: ['tailscale', 'nginx-proxy-manager'] }, [
      service('tailscale', 'stopped'),
      service('nginx-proxy-manager', 'stopped'),
    ]);

    expect(component.dependenciesSatisfied()).toBe(true);
    expect(component.degradedBy()).toEqual(['tailscale', 'nginx-proxy-manager']);
  });

  it('reports nothing degraded when every requires service is up', () => {
    setUp({ requires: ['tailscale'] }, [service('tailscale', 'running')]);

    expect(component.degradedBy()).toEqual([]);
    expect(component.degradedTitle()).toBe('');
  });

  it('adds the proxy for an exposed app, derived from its live hostname', () => {
    setUp({ exposedHostname: 'netbird.example.com' }, [service('nginx-proxy-manager', 'running')]);

    expect(component.dependencies()).toEqual([
      jasmine.objectContaining({ name: 'nginx-proxy-manager', running: true, blocking: false }),
    ]);
    // The public URL is dead without it; the app on its LAN port is not.
    expect(component.dependenciesSatisfied()).toBe(true);
  });

  it('adds no proxy chip for an app with no public hostname', () => {
    setUp({}, [service('nginx-proxy-manager', 'running')]);

    expect(component.dependencies()).toEqual([]);
  });

  it('does not list the proxy twice when the app already declares it', () => {
    setUp({ exposedHostname: 'netbird.example.com', requires: ['nginx-proxy-manager'] }, [
      service('nginx-proxy-manager', 'stopped'),
    ]);

    expect(component.dependencies().filter((d) => d.name === 'nginx-proxy-manager').length).toBe(1);
    expect(component.degradedBy()).toEqual(['nginx-proxy-manager']);
  });

  it('falls back to the raw name for a dependency the dashboard has no status for', () => {
    setUp({ dependsOn: ['authelia'] }, []);

    expect(component.dependencies()).toEqual([
      { name: 'authelia', label: 'authelia', running: false, blocking: true },
    ]);
  });
});

describe('ServiceCardComponent per-app backups', () => {
  let component: ServiceCardComponent;
  let operations: jasmine.SpyObj<OperationsService>;
  let confirm: jasmine.SpyObj<ConfirmService>;

  const entry = (over: Partial<AppBackupEntry> = {}): AppBackupEntry => ({
    file: 'paperless-2026-01-01T00-00-00-000Z.tar.gz',
    bytes: 422_912,
    createdAt: '2026-01-01T00:00:00.000Z',
    manifest: { app: 'paperless', createdAt: '2026-01-01T00:00:00.000Z', dashboardVersion: '0.18.0', engine: 'postgres', archiveBytes: 422_912, dumps: [], dumpFailures: [] },
    ...over,
  });

  beforeEach(async () => {
    operations = jasmine.createSpyObj('OperationsService', [
      'getServiceEnv',
      'listAppBackups',
      'createAppBackup',
      'restoreAppBackup',
      'deleteAppBackup',
      'downloadAppBackup',
    ]);
    operations.listAppBackups.and.returnValue(of({ items: [] }));
    operations.getServiceEnv.and.returnValue(of({ fields: [] } as unknown as ServiceEnvStatus));
    confirm = jasmine.createSpyObj('ConfirmService', ['ask']);

    await TestBed.configureTestingModule({
      imports: [ServiceCardComponent],
      providers: [
        { provide: OperationsService, useValue: operations },
        { provide: ServiceStateService, useValue: jasmine.createSpyObj('ServiceStateService', ['refresh']) },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        { provide: ConfirmService, useValue: confirm },
      ],
    }).compileComponents();

    component = TestBed.createComponent(ServiceCardComponent).componentInstance;
    component.service = service('paperless', 'running');
  });

  it('summarises a snapshot as size · engine, and flags failed dumps', () => {
    expect(component['appBackupDetail'](entry())).toBe('413 KB · postgres');
    expect(
      component['appBackupDetail'](
        entry({ manifest: { ...entry().manifest!, dumpFailures: [{ target: '', kind: 'postgres', bytes: null, detail: 'x' }] } })
      )
    ).toBe('413 KB · postgres · 1 dump failed');
    expect(component['appBackupDetail'](entry({ manifest: null }))).toBe('413 KB · details unavailable');
  });

  it('restores only after the user confirms', async () => {
    confirm.ask.and.resolveTo(false);
    await component.restoreAppBackup(entry());
    expect(operations.restoreAppBackup).not.toHaveBeenCalled();

    confirm.ask.and.resolveTo(true);
    operations.restoreAppBackup.and.returnValue(of({ success: true, service: 'paperless', file: entry().file, fileRestore: '', databaseRestore: null, warnings: [], message: 'ok' }));
    await component.restoreAppBackup(entry());
    expect(operations.restoreAppBackup).toHaveBeenCalledWith('paperless', entry().file);
  });

  it('deletes only after the user confirms', async () => {
    confirm.ask.and.resolveTo(false);
    await component.deleteAppBackup(entry());
    expect(operations.deleteAppBackup).not.toHaveBeenCalled();
  });

  it('loads the app\'s backups when the settings modal opens', () => {
    component.openSettings();
    expect(operations.listAppBackups).toHaveBeenCalledWith('paperless');
  });
});

describe('ServiceCardComponent startup log batching (§371)', () => {
  let component: ServiceCardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ServiceCardComponent],
      providers: [
        { provide: OperationsService, useValue: jasmine.createSpyObj('OperationsService', ['getServiceEnv']) },
        { provide: ServiceStateService, useValue: jasmine.createSpyObj('ServiceStateService', ['refresh']) },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
      ],
    }).compileComponents();

    component = TestBed.createComponent(ServiceCardComponent).componentInstance;
    component.service = service('twenty', 'stopped');
  });

  // A chatty first boot fires the SSE 'log' event hundreds of times in a
  // burst; each one used to apply straight to the view and freeze the tab.
  // Lines must sit buffered until the throttled flush, then land in one go.
  it('buffers rapid log lines and applies them in one flush', fakeAsync(() => {
    for (let i = 0; i < 500; i++) {
      component['queueStartupLine'](`line ${i}`);
    }
    expect(component['startupLogLines']).toEqual([]);

    tick(120);

    expect(component['startupLogLines'].length).toBe(500);
    expect(component['startupLogLines'][0]).toBe('line 0');
    expect(component['startupLogLines'][499]).toBe('line 499');
  }));

  it('stops flushing once the popup is torn down', fakeAsync(() => {
    component['queueStartupLine']('leftover');
    component['teardownStartupLogs']();

    tick(120);

    expect(component['startupLogLines']).toEqual([]);
  }));
});

describe('ServiceCardComponent installedVersion', () => {
  let fixture: ComponentFixture<ServiceCardComponent>;
  let component: ServiceCardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ServiceCardComponent],
      providers: [
        { provide: OperationsService, useValue: jasmine.createSpyObj('OperationsService', ['getServiceEnv']) },
        { provide: ServiceStateService, useValue: jasmine.createSpyObj('ServiceStateService', ['refresh']) },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        { provide: ConfirmService, useValue: jasmine.createSpyObj('ConfirmService', ['ask']) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ServiceCardComponent);
    component = fixture.componentInstance;
  });

  it('prefers the self-update digest pin when there is one, without the digest itself', () => {
    // The sha256 is 71 characters of noise to a human reading the panel; the
    // image and tag are what identifies what is installed.
    component.service = service('itflow', 'running', {
      pinnedImages: ['itfloworg/itflow:latest@sha256:abc'],
      versionPinned: [],
    });
    expect(component['installedVersion']()).toBe('itfloworg/itflow:latest');
  });

  it('strips the digest from every image of a multi-image app', () => {
    component.service = service('nginx-proxy-manager', 'running', {
      pinnedImages: ['jc21/nginx-proxy-manager:latest@sha256:4393e6', 'mysql:8.0@sha256:7dcddc'],
      versionPinned: [],
    });
    expect(component['installedVersion']()).toBe('jc21/nginx-proxy-manager:latest, mysql:8.0');
  });

  it('falls back to the base compose tag when nothing is digest-pinned yet', () => {
    component.service = service('guacamole', 'running', { pinnedImages: [], versionPinned: ['1.6.0'] });
    expect(component['installedVersion']()).toBe('1.6.0');
  });

  it('falls back to "latest" when neither is set', () => {
    component.service = service('clamav', 'running', { pinnedImages: [], versionPinned: [] });
    expect(component['installedVersion']()).toBe('latest');
  });

  it('renders a single version badge with the version in the Settings dialog, and no pinned badges or Unpin button', () => {
    component.service = service('guacamole', 'running', { pinnedImages: [], versionPinned: ['1.6.0'] });
    component.allServices = [component.service];
    component['settingsModalOpen'] = true;
    fixture.detectChanges();

    const root: HTMLElement = fixture.nativeElement;
    const versionBadge = Array.from(root.querySelectorAll('.settings-about span')).find((el) => el.textContent?.includes('Installed:'));
    expect(versionBadge).withContext('version badge should render').toBeTruthy();
    expect(versionBadge?.textContent?.trim()).toBe('Installed: 1.6.0');

    expect(root.textContent).not.toContain('pinned to a fixed image');
    expect(root.textContent).not.toContain('version pinned');
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent?.trim() === 'Unpin')).toBe(false);
  });
});

describe('ServiceCardComponent lanAccessUrl', () => {
  let fixture: ComponentFixture<ServiceCardComponent>;
  let component: ServiceCardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ServiceCardComponent],
      providers: [
        { provide: OperationsService, useValue: jasmine.createSpyObj('OperationsService', ['getServiceEnv']) },
        { provide: ServiceStateService, useValue: jasmine.createSpyObj('ServiceStateService', ['refresh']) },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        { provide: ConfirmService, useValue: jasmine.createSpyObj('ConfirmService', ['ask']) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ServiceCardComponent);
    component = fixture.componentInstance;
  });

  it('falls back to this dashboard\'s own hostname when the backend has not resolved a LAN IP yet', () => {
    component.service = service('clamav', 'running', { lanOnly: true, webPort: 10450 });
    component.hostLanIp = null;
    expect(component['lanAccessUrl']()).toBe(`http://${window.location.hostname}:10450`);
  });

  it('prefers the Docker host\'s real LAN IP over this dashboard\'s own (possibly public) hostname', () => {
    component.service = service('clamav', 'running', { lanOnly: true, webPort: 10450 });
    component.hostLanIp = '192.168.1.236';
    expect(component['lanAccessUrl']()).toBe('http://192.168.1.236:10450');
  });

  it('is null when the app has no published port (not running)', () => {
    component.service = service('clamav', 'stopped', { lanOnly: true, webPort: null });
    expect(component['lanAccessUrl']()).toBeNull();
  });

  it('renders a lanOnly link, tagged, when the app is LAN-only', () => {
    component.service = service('clamav', 'running', { lanOnly: true, webPort: 10450 });
    component.allServices = [component.service];
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector('a.badge') as HTMLAnchorElement | null;
    expect(link?.textContent?.trim()).toBe('Local network only');
    expect(link?.getAttribute('href')).toBe(`http://${window.location.hostname}:10450`);
  });

  it('renders an overlayOnly link, tagged, when the app is overlay-only', () => {
    component.service = service('guacamole', 'running', { overlayOnly: true, webPort: 10240 });
    component.allServices = [component.service];
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector('a.badge') as HTMLAnchorElement | null;
    expect(link?.textContent?.trim()).toBe('VPN only');
  });

  // Replaces the removed Running table's LAN link (plan.md §771): an ordinary app
  // whose exposure is off or failed must still be reachable from its row.
  it('falls back to a LAN link for a running, unexposed, ordinary app', () => {
    component.service = service('jellyfin', 'running', { webPort: 10130 });
    component.allServices = [component.service];
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector('a.badge') as HTMLAnchorElement | null;
    expect(link?.textContent?.trim()).toBe('Local network');
    expect(link?.getAttribute('href')).toBe(`http://${window.location.hostname}:10130`);
  });

  it('offers no fallback link for a stopped app', () => {
    component.service = service('jellyfin', 'stopped', { webPort: 10130 });
    component.allServices = [component.service];
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('a.badge')).toBeNull();
  });

  it('does not render the LAN/overlay link when the app is publicly exposed instead', () => {
    component.service = service('nextcloud', 'running', { exposedHostname: 'nextcloud.example.com' });
    component.allServices = [component.service];
    fixture.detectChanges();

    const badges = Array.from(fixture.nativeElement.querySelectorAll('a.badge')) as HTMLAnchorElement[];
    expect(badges.some((b) => b.textContent?.trim() === 'Local network only' || b.textContent?.trim() === 'VPN only')).toBe(
      false
    );
  });
});

describe('ServiceCardComponent polish', () => {
  let fixture: ComponentFixture<ServiceCardComponent>;
  let component: ServiceCardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ServiceCardComponent],
      providers: [
        { provide: OperationsService, useValue: jasmine.createSpyObj('OperationsService', ['getServiceEnv']) },
        { provide: ServiceStateService, useValue: jasmine.createSpyObj('ServiceStateService', ['refresh']) },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        { provide: ConfirmService, useValue: jasmine.createSpyObj('ConfirmService', ['ask']) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ServiceCardComponent);
    component = fixture.componentInstance;
    component.service = service('guacamole', 'running', { mobileApps: { android: true, ios: true } });
    component.allServices = [component.service];
  });

  it('renders the state badge through the translate service, not the raw state string', () => {
    const translate = component['translate'];
    spyOn(translate, 't').and.callFake((key: string) => `«${key}»`);
    fixture.detectChanges();

    const badge = fixture.nativeElement.querySelector('.service-row-heading .badge');
    expect(badge.textContent.trim()).toBe('«serviceCard.state.running»');
  });

  it('names the settings dialog by its title', () => {
    component['settingsModalOpen'] = true;
    fixture.detectChanges();

    const dialog: HTMLElement = fixture.nativeElement.querySelector('.settings-dialog');
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(labelId).withContext('aria-labelledby').toBeTruthy();
    expect(fixture.nativeElement.querySelector('#' + labelId)?.textContent).toContain('guacamole');
  });

  it('marks the startup-log popup as a modal dialog named by its heading', () => {
    component['startupLogsOpen'] = true;
    fixture.detectChanges();

    const dialog: HTMLElement = fixture.nativeElement.querySelector('.startup-logs-dialog');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(fixture.nativeElement.querySelector('#' + labelId)?.textContent).toContain('guacamole');
  });

  it('keeps layout styling for the mobile-app badges in CSS, not inline style attributes', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.service-row-heading [style]').length).toBe(0);
  });
});

// plan.md §761: a failed or in-flight row must say what happened and offer one
// action; stopping the proxy or SSO must warn that other apps lose access.
describe('ServiceCardComponent recovery states', () => {
  let fixture: ComponentFixture<ServiceCardComponent>;
  let component: ServiceCardComponent;
  let confirm: jasmine.SpyObj<ConfirmService>;
  let emitted: string[];

  beforeEach(async () => {
    confirm = jasmine.createSpyObj('ConfirmService', ['ask']);
    await TestBed.configureTestingModule({
      imports: [ServiceCardComponent],
      providers: [
        { provide: OperationsService, useValue: jasmine.createSpyObj('OperationsService', ['getServiceEnv']) },
        { provide: ServiceStateService, useValue: jasmine.createSpyObj('ServiceStateService', ['refresh']) },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        { provide: ConfirmService, useValue: confirm },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ServiceCardComponent);
    component = fixture.componentInstance;
    emitted = [];
    component.actionRequested.subscribe((a) => emitted.push(a));
  });

  const render = (svc: ServiceStatus) => {
    component.service = svc;
    component.allServices = [svc];
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it('shows a plain cause, Try again and the raw error behind Show details', () => {
    const el = render(service('jellyfin', 'error', { error: 'port is already allocated' }));
    expect(el.querySelector('.row-recovery')?.textContent).toContain('start jellyfin');
    expect(el.querySelector('.row-recovery details')?.textContent).toContain('port is already allocated');
    (el.querySelector('.row-recovery button') as HTMLButtonElement).click();
    expect(emitted).toEqual(['start']);
  });

  it('gives a starting row a busy Start button that says why it is disabled', () => {
    const el = render(service('jellyfin', 'starting'));
    const start = el.querySelector('.service-row-actions button') as HTMLButtonElement;
    expect(start.disabled).toBeTrue();
    expect(start.textContent).toContain('Starting');
  });

  it('asks before stopping the proxy or SSO, and stops nothing on cancel', async () => {
    confirm.ask.and.resolveTo(false);
    component.service = service('authelia', 'running');
    await component.requestAction('stop');
    expect(confirm.ask).toHaveBeenCalled();
    expect(emitted).toEqual([]);

    confirm.ask.and.resolveTo(true);
    await component.requestAction('stop');
    expect(emitted).toEqual(['stop']);
  });

  it('offers to start what a blocked app needs, and only then', () => {
    let asked = 0;
    component.startWithNeedsRequested.subscribe(() => asked++);
    const el = render(service('itflow', 'stopped', { dependsOn: ['authelia'] }));
    component.allServices = [component.service, service('authelia', 'stopped')];
    fixture.detectChanges();
    const link = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('what it needs'));
    link!.click();
    expect(asked).toBe(1);

    component.allServices = [component.service, service('authelia', 'running')];
    fixture.detectChanges();
    expect(el.textContent).not.toContain('what it needs');
  });

  it('stops an ordinary app without asking', async () => {
    component.service = service('jellyfin', 'running');
    await component.requestAction('stop');
    expect(confirm.ask).not.toHaveBeenCalled();
    expect(emitted).toEqual(['stop']);
  });
});

// plan.md §761: the Settings dialog must not drop unsaved edits on a stray
// backdrop click, must keep Tab inside, and must hand focus back on close.
describe('ServiceCardComponent settings dialog focus', () => {
  let fixture: ComponentFixture<ServiceCardComponent>;
  let component: ServiceCardComponent;
  let el: HTMLElement;

  beforeEach(async () => {
    const operations = jasmine.createSpyObj('OperationsService', ['getServiceEnv', 'listAppBackups']);
    operations.listAppBackups.and.returnValue(of({ items: [] }));
    operations.getServiceEnv.and.returnValue(of({ fields: [] } as unknown as ServiceEnvStatus));
    await TestBed.configureTestingModule({
      imports: [ServiceCardComponent],
      providers: [
        { provide: OperationsService, useValue: operations },
        { provide: ServiceStateService, useValue: jasmine.createSpyObj('ServiceStateService', ['refresh']) },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        { provide: ConfirmService, useValue: jasmine.createSpyObj('ConfirmService', ['ask']) },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ServiceCardComponent);
    component = fixture.componentInstance;
    component.service = service('paperless', 'running');
    component.allServices = [component.service];
    el = fixture.nativeElement;
    document.body.appendChild(el); // focus only works on attached nodes
    fixture.detectChanges();
  });

  afterEach(() => el.remove());

  const opener = () => el.querySelector('.service-row-actions button:last-child') as HTMLButtonElement;

  it('keeps the dialog open, edits intact, on a backdrop click', () => {
    opener().click();
    fixture.detectChanges();
    (el.querySelector('.settings-backdrop') as HTMLElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.settings-dialog')).not.toBeNull();
  });

  it('moves focus into the dialog, then back to the opener on close', () => {
    opener().focus();
    opener().click();
    fixture.detectChanges();
    expect(el.querySelector('.settings-dialog')!.contains(document.activeElement)).toBeTrue();
    component.closeSettings();
    fixture.detectChanges();
    expect(document.activeElement).toBe(opener());
  });

  it('wraps Tab from the last control to the first', () => {
    opener().click();
    fixture.detectChanges();
    const dialog = el.querySelector('.settings-dialog') as HTMLElement;
    const focusable = dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]');
    focusable[focusable.length - 1].focus();
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(focusable[0]);
  });
});

// plan.md §761: the row heading keeps state, health-only-when-wrong and one
// link; version, phone apps and secondary URLs live in the Settings dialog.
describe('ServiceCardComponent heading line', () => {
  let fixture: ComponentFixture<ServiceCardComponent>;
  let component: ServiceCardComponent;
  let el: HTMLElement;

  beforeEach(async () => {
    const operations = jasmine.createSpyObj('OperationsService', ['getServiceEnv', 'listAppBackups']);
    operations.listAppBackups.and.returnValue(of({ items: [] }));
    operations.getServiceEnv.and.returnValue(of({ fields: [] } as unknown as ServiceEnvStatus));
    await TestBed.configureTestingModule({
      imports: [ServiceCardComponent],
      providers: [
        { provide: OperationsService, useValue: operations },
        { provide: ServiceStateService, useValue: jasmine.createSpyObj('ServiceStateService', ['refresh']) },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        { provide: ConfirmService, useValue: jasmine.createSpyObj('ConfirmService', ['ask']) },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ServiceCardComponent);
    component = fixture.componentInstance;
    el = fixture.nativeElement;
  });

  const render = (extra: Partial<ServiceStatus>) => {
    component.service = service('paperless', 'running', {
      exposedHostname: 'paperless.example.com',
      clientApiPath: '/api',
      mobileApps: { android: true, ios: true },
      additionalExposureUrls: [{ label: 'Sync', hostname: 'sync.example.com' }],
      ...extra,
    });
    component.allServices = [component.service];
    fixture.detectChanges();
  };
  const heading = () => el.querySelector('.service-row-heading') as HTMLElement;

  it('shows state and one link, and no health badge while healthy', () => {
    render({});
    expect(heading().querySelectorAll('a').length).toBe(1);
    expect(heading().textContent).toContain('paperless.example.com');
    expect(heading().textContent).not.toContain('sync.example.com');
    expect(heading().querySelector('svg')).toBeNull();
    expect(heading().textContent).not.toContain('ⓥ');
    expect(heading().querySelectorAll('.badge').length).toBe(2); // state + link
  });

  it('shows a health badge only when a running app fails its check', () => {
    render({ healthy: false });
    expect(heading().textContent).toContain('not responding');
  });

  it('lists the published host ports in Settings (the old Running table\'s other column)', () => {
    render({ ports: [{ hostPort: '10120', containerPort: '8080', protocol: 'tcp' }] });
    component.openSettings();
    fixture.detectChanges();
    expect(el.querySelector('.settings-about')?.textContent).toContain('Port 10120');
    expect(el.querySelector('.settings-about')?.textContent).not.toContain('8080');
  });

  it('moves version, phone apps and secondary URLs into the Settings dialog', () => {
    render({});
    component.openSettings();
    fixture.detectChanges();
    const about = el.querySelector('.settings-dialog .settings-about') as HTMLElement;
    expect(about.textContent).toContain('sync.example.com');
    expect(about.textContent).toContain('/api');
    expect(about.textContent).toContain('Android');
    expect(about.textContent).toContain('iPhone');
    expect(about.textContent).toContain('Installed:');
  });
});

// plan.md §761 P3: OS-dependent emoji replaced by initials, so every app's tile
// renders the same on every device.
describe('serviceInitials', () => {
  it('takes the first letters of the first two words, else the first two letters', () => {
    expect(serviceInitials('Home Assistant')).toBe('HA');
    expect(serviceInitials('Jellyfin')).toBe('Je');
    expect(serviceInitials('  nginx proxy manager ')).toBe('NP');
    expect(serviceInitials('')).toBe('?');
  });

  it('renders as the row tile, with the full name as a tooltip', () => {
    TestBed.configureTestingModule({
      imports: [ServiceCardComponent],
      providers: [
        { provide: OperationsService, useValue: jasmine.createSpyObj('OperationsService', ['getServiceEnv']) },
        { provide: ServiceStateService, useValue: jasmine.createSpyObj('ServiceStateService', ['refresh']) },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
      ],
    });
    const fixture = TestBed.createComponent(ServiceCardComponent);
    fixture.componentInstance.service = service('jellyfin', 'running', { label: 'Jellyfin', icon: 'media' });
    fixture.componentInstance.allServices = [fixture.componentInstance.service];
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.service-icon')?.textContent?.trim()).toBe('Je');
    expect(el.querySelector('.service-name')?.getAttribute('title')).toBe('Jellyfin');
  });
});

// plan.md §776: Stop is one click, but on an exposed app it takes the public
// page and its Home Page tile offline for everyone — outward-facing, so it is
// confirmed (PRODUCT.md). An app nobody outside can reach stops without a prompt.
describe('ServiceCardComponent stop confirmation', () => {
  let fixture: ComponentFixture<ServiceCardComponent>;
  let component: ServiceCardComponent;
  let confirm: jasmine.SpyObj<ConfirmService>;
  let emitted: string[];

  beforeEach(async () => {
    confirm = jasmine.createSpyObj('ConfirmService', ['ask']);
    await TestBed.configureTestingModule({
      imports: [ServiceCardComponent],
      providers: [
        { provide: OperationsService, useValue: jasmine.createSpyObj('OperationsService', ['getServiceEnv']) },
        { provide: ServiceStateService, useValue: jasmine.createSpyObj('ServiceStateService', ['refresh']) },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        { provide: ConfirmService, useValue: confirm },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ServiceCardComponent);
    component = fixture.componentInstance;
    emitted = [];
    component.actionRequested.subscribe((a) => emitted.push(a));
  });

  const use = (extra: Partial<ServiceStatus>) => {
    component.service = service('paperless', 'running', extra);
    component.allServices = [component.service];
    fixture.detectChanges();
  };

  it('asks before stopping an exposed app, naming where it goes offline', async () => {
    use({ exposedHostname: 'paperless.example.com' });
    confirm.ask.and.resolveTo(false);
    await component.requestAction('stop');
    expect(emitted).toEqual([]);
    const options = confirm.ask.calls.mostRecent().args[0];
    expect(options.message).toContain('paperless.example.com');
    expect(options.danger).toBeTrue();

    confirm.ask.and.resolveTo(true);
    await component.requestAction('stop');
    expect(emitted).toEqual(['stop']);
  });

  it('stops an app with no public address straight away, and never asks before a start', async () => {
    use({});
    await component.requestAction('stop');
    await component.requestAction('start');
    expect(confirm.ask).not.toHaveBeenCalled();
    expect(emitted).toEqual(['stop', 'start']);
  });

  it('leaves live announcements to the page, not each of ~36 row badges', () => {
    use({ exposedHostname: 'paperless.example.com' });
    expect((fixture.nativeElement as HTMLElement).querySelector('[aria-live]')).toBeNull();
  });
});

// Host ports are allocated by start.sh, not chosen by a human, so the config
// panel neither shows them nor submits them.
describe('ServiceCardComponent port fields', () => {
  let fixture: ComponentFixture<ServiceCardComponent>;
  let component: ServiceCardComponent;
  let el: HTMLElement;

  const field = (key: string, extra: Partial<ServiceEnvField> = {}): ServiceEnvField => ({
    key,
    required: false,
    secret: false,
    isSet: true,
    boolean: false,
    hidden: false,
    managed: false,
    managedValue: null,
    value: 'set-value',
    defaultValue: 'default-value',
    suggestedValue: null,
    isPort: false,
    locked: false,
    lockedReason: null,
    portInUse: false,
    suggestedPort: null,
    ...extra,
  });

  const open = async (fields: ServiceEnvField[]) => {
    const operations = jasmine.createSpyObj('OperationsService', ['getServiceEnv', 'listAppBackups']);
    operations.listAppBackups.and.returnValue(of({ items: [] }));
    operations.getServiceEnv.and.returnValue(of({ fields } as unknown as ServiceEnvStatus));
    await TestBed.configureTestingModule({
      imports: [ServiceCardComponent],
      providers: [
        { provide: OperationsService, useValue: operations },
        { provide: ServiceStateService, useValue: jasmine.createSpyObj('ServiceStateService', ['refresh']) },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        { provide: ConfirmService, useValue: jasmine.createSpyObj('ConfirmService', ['ask']) },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ServiceCardComponent);
    component = fixture.componentInstance;
    component.service = service('nginx-proxy-manager', 'running');
    component.allServices = [component.service];
    el = fixture.nativeElement;
    fixture.detectChanges();
    (el.querySelector('.service-row-actions button:last-child') as HTMLButtonElement).click();
    fixture.detectChanges();
  };

  it('renders no port field, locked or not, and keeps the others', async () => {
    await open([
      field('NPM_HTTP_PORT', { isPort: true, locked: true, lockedReason: 'Fixed' }),
      field('NPM_ADMIN_PORT', { isPort: true }),
      field('ADMIN_EMAIL'),
    ]);

    const labels = Array.from(el.querySelectorAll('.settings-section .form-label')).map((l) =>
      l.textContent?.trim()
    );
    expect(labels).toEqual(['Admin email']);
  });

  it('never submits a port value, so an unrelated save leaves the allocated port alone', async () => {
    await open([field('NPM_ADMIN_PORT', { isPort: true }), field('ADMIN_EMAIL')]);

    expect(Object.keys(component['envValues'])).toEqual(['ADMIN_EMAIL']);
  });

  it('offers no save button when ports were the only settings', async () => {
    await open([field('NPM_HTTP_PORT', { isPort: true, locked: true }), field('NPM_ADMIN_PORT', { isPort: true })]);

    const save = Array.from(el.querySelectorAll('.settings-section button')).find((b) =>
      b.textContent?.includes('Save configuration')
    ) as HTMLButtonElement | undefined;
    expect(save?.disabled ?? true).toBeTrue();
  });
});

// Dependency rows are read several times per change-detection pass (the chips,
// the blocked-start reason, the degraded note, the Start button's disabled
// state), and each read used to scan the whole service list once per declared
// dependency. On a 50-app box, with 50 cards on screen, that is tens of
// thousands of comparisons per mouse move.
describe('ServiceCardComponent dependency resolution', () => {
  let fixture: ComponentFixture<ServiceCardComponent>;
  let component: ServiceCardComponent;

  const all = [
    service('authelia', 'running'),
    service('tailscale', 'stopped'),
    ...Array.from({ length: 48 }, (_, i) => service(`filler-${i}`, 'running')),
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ServiceCardComponent],
      providers: [
        { provide: OperationsService, useValue: jasmine.createSpyObj('OperationsService', ['getServiceEnv']) },
        { provide: ServiceStateService, useValue: jasmine.createSpyObj('ServiceStateService', ['refresh']) },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        { provide: ConfirmService, useValue: jasmine.createSpyObj('ConfirmService', ['ask']) },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ServiceCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('service', service('netbird-vpn', 'stopped', { dependsOn: ['authelia'], requires: ['tailscale'] }));
    fixture.componentRef.setInput('allServices', all);
    fixture.detectChanges();
  });

  it('resolves the list once and reuses it', () => {
    const first = component.dependencies();
    fixture.detectChanges();
    expect(component.dependencies()).toBe(first);
    expect(component.dependencies().map((d) => d.name)).toEqual(['authelia', 'tailscale']);
  });

  it('re-resolves when a dependency changes state', () => {
    const first = component.dependencies();
    fixture.componentRef.setInput('allServices', [service('authelia', 'running'), service('tailscale', 'running')]);
    fixture.detectChanges();
    expect(component.dependencies()).not.toBe(first);
    expect(component.dependencies().every((d) => d.running)).toBeTrue();
  });

  it('re-resolves when the card is handed a different app', () => {
    const first = component.dependencies();
    fixture.componentRef.setInput('service', service('vaultwarden', 'running', { dependsOn: ['authelia'] }));
    fixture.detectChanges();
    expect(component.dependencies()).not.toBe(first);
    expect(component.dependencies().map((d) => d.name)).toEqual(['authelia']);
  });
});

// OnPush (plan.md §802/§808): with ~50 cards on the Apps page, every card's
// bindings were re-checked on every event anywhere. The cost of the strategy is
// that a state change arriving from a subscription, a timer or an EventSource
// no longer redraws the card by itself — each needs a markForCheck(), and a
// missed one is a card that silently shows stale data. These tests drive each
// asynchronous path and assert the DOM, with detectChanges() called only the way
// the framework would (a plain pass, which skips an unmarked OnPush view).
describe('ServiceCardComponent under OnPush', () => {
  const entry = (): AppBackupEntry => ({
    file: 'paperless-2026-10-01.tar.gz',
    createdAt: '2026-10-01T10:00:00.000Z',
    bytes: 423000,
    manifest: { engine: 'postgres', dumpFailures: [] } as unknown as AppBackupEntry['manifest'],
  });

  /** Just enough EventSource to hand the card a stream it can be told to finish. */
  class FakeEventSource {
    static last: FakeEventSource;
    listeners: Record<string, (e: MessageEvent) => void> = {};
    onerror: (() => void) | null = null;
    constructor(public url: string) {
      FakeEventSource.last = this;
    }
    addEventListener(name: string, fn: (e: MessageEvent) => void) {
      this.listeners[name] = fn;
    }
    close() {}
  }

  let fixture: ComponentFixture<ServiceCardComponent>;
  let el: HTMLElement;
  let operations: jasmine.SpyObj<OperationsService>;
  let confirm: jasmine.SpyObj<ConfirmService>;
  let translate: TranslateService;

  const settled = () => {
    fixture.detectChanges();
    return el;
  };

  beforeEach(async () => {
    localStorage.clear();
    operations = jasmine.createSpyObj('OperationsService', [
      'getServiceEnv',
      'listAppBackups',
      'createAppBackup',
      'deleteAppBackup',
      'getAutheliaAdminUser',
      'updateServiceEnv',
    ]);
    operations.listAppBackups.and.returnValue(of({ items: [] }));
    operations.getServiceEnv.and.returnValue(of({ fields: [] } as unknown as ServiceEnvStatus));
    confirm = jasmine.createSpyObj('ConfirmService', ['ask']);

    await TestBed.configureTestingModule({
      imports: [ServiceCardComponent],
      providers: [
        { provide: OperationsService, useValue: operations },
        { provide: ServiceStateService, useValue: jasmine.createSpyObj('ServiceStateService', ['refresh']) },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        { provide: ConfirmService, useValue: confirm },
      ],
    }).compileComponents();
    translate = TestBed.inject(TranslateService);
    translate.setLocale('en');
    fixture = TestBed.createComponent(ServiceCardComponent);
    el = fixture.nativeElement;
    fixture.componentRef.setInput('service', service('paperless', 'running'));
    fixture.componentRef.setInput('allServices', []);
    fixture.detectChanges();
  });

  afterEach(() => {
    translate.setLocale('en');
    localStorage.clear();
  });

  const openSettings = () => {
    (el.querySelector('.service-row-actions button:last-child') as HTMLButtonElement).click();
    return settled();
  };

  it('is OnPush', () => {
    expect((ServiceCardComponent as unknown as { ɵcmp: { onPush: boolean } }).ɵcmp.onPush).toBeTrue();
  });

  it('redraws when its inputs change', () => {
    fixture.componentRef.setInput('service', service('paperless', 'stopped'));
    expect(settled().querySelector('.service-row-actions')!.textContent).toContain('Start');
  });

  it('shows config fields that arrive after the settings dialog opened', () => {
    const pending = new Subject<ServiceEnvStatus>();
    operations.getServiceEnv.and.returnValue(pending as never);
    openSettings();
    expect(el.textContent).toContain('Loading');

    pending.next({
      fields: [
        { key: 'ADMIN_EMAIL', required: false, secret: false, isSet: true, boolean: false, hidden: false, managed: false,
          managedValue: null, value: 'a@b.c', defaultValue: null, suggestedValue: null, isPort: false, locked: false,
          lockedReason: null, portInUse: false, suggestedPort: null },
      ],
    } as unknown as ServiceEnvStatus);
    pending.complete();
    expect(settled().textContent).toContain('Admin email');
    expect(el.textContent).not.toContain('Loading');
  });

  it('shows snapshots that arrive late', () => {
    const pending = new Subject<{ items: AppBackupEntry[] }>();
    operations.listAppBackups.and.returnValue(pending as never);
    openSettings();
    pending.next({ items: [entry()] });
    pending.complete();
    expect(settled().textContent).not.toContain('No snapshots yet');
    expect(el.querySelectorAll('.app-backup-row, .settings-section li, .settings-section .list-group-item').length).toBeGreaterThan(0);
  });

  it('shows Back up now as busy while it runs, and idle again afterwards', () => {
    openSettings();
    const pending = new Subject<unknown>();
    operations.createAppBackup.and.returnValue(pending as never);
    const button = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Back up now'))!;
    button.click();
    expect(settled() && button.disabled).toBeTrue();

    pending.next({ dumpFailures: [], message: 'done' });
    pending.complete();
    settled();
    expect(button.disabled).toBeFalse();
  });

  it('follows a language switch', () => {
    expect(el.querySelector('.service-row-actions')!.textContent).toContain('Settings');
    translate.setLocale('pt-PT');
    expect(settled().querySelector('.service-row-actions')!.textContent).not.toContain('Settings');
  });

  it('shows the startup phase when the log stream finishes', fakeAsync(() => {
    const state = TestBed.inject(ServiceStateService) as jasmine.SpyObj<ServiceStateService>;
    (state as unknown as { startupEvents$: unknown }).startupEvents$ = new Subject();
    state.createStartupLogUrl = jasmine.createSpy().and.resolveTo('/stream');
    const original = window.EventSource;
    (window as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
    try {
      fixture.componentRef.setInput('service', service('paperless', 'stopped'));
      fixture.detectChanges();
      void fixture.componentInstance.requestAction('start');
      flushMicrotasks();
      fixture.detectChanges();
      expect(el.querySelector('.startup-logs-dialog')).not.toBeNull();

      // The stream ends while nothing in the template was clicked: only a mark
      // makes the OnPush card show the new phase.
      FakeEventSource.last.listeners['done']({ data: JSON.stringify({ state: 'running', healthy: true }) } as MessageEvent);
      fixture.detectChanges();
      expect(el.querySelector('.startup-logs-dialog')!.textContent).toContain('up and healthy');

      // ...and the 2.5 s auto-close that follows a good boot.
      tick(2500);
      fixture.detectChanges();
      expect(el.querySelector('.startup-logs-dialog')).toBeNull();
    } finally {
      (window as unknown as { EventSource: unknown }).EventSource = original;
    }
  }));
});

// The point of OnPush, measured: 50 idle cards and a burst of change-detection
// passes (what any event anywhere causes). `translate.t` runs once per
// translated binding per check, so its call count is the work done.
describe('ServiceCardComponent idle cost (plan.md §808)', () => {
  @Component({
    imports: [ServiceCardComponent],
    template: `@for (s of services; track s.name) {
      <app-service-card [service]="s" [allServices]="services"></app-service-card>
    }`
})
  class HostComponent {
    services = Array.from({ length: 50 }, (_, i) => service(`app-${i}`, 'running'));
  }

  const callsDuring = async (onPush: boolean): Promise<number> => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        { provide: OperationsService, useValue: jasmine.createSpyObj('OperationsService', ['getServiceEnv']) },
        { provide: ServiceStateService, useValue: jasmine.createSpyObj('ServiceStateService', ['refresh']) },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        { provide: ConfirmService, useValue: jasmine.createSpyObj('ConfirmService', ['ask']) },
      ],
    });
    if (!onPush) {
      TestBed.overrideComponent(ServiceCardComponent, { set: { changeDetection: ChangeDetectionStrategy.Default } });
    }
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const spy = spyOn(TestBed.inject(TranslateService), 't').and.callThrough();
    for (let i = 0; i < 10; i++) fixture.detectChanges();
    return spy.calls.count();
  };

  it('does no work on idle cards when change detection runs', async () => {
    const onPush = await callsDuring(true);
    const eager = await callsDuring(false);
    console.log(`IDLE-COST onPush=${onPush} default=${eager}`);
    expect(onPush).toBe(0);
    expect(eager).toBeGreaterThan(1000);
  });
});
