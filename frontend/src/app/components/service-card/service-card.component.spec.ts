import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of } from 'rxjs';
import { ServiceCardComponent } from './service-card.component';
import { ConfirmService } from '../../core/confirm.service';
import { OperationsService } from '../../core/operations.service';
import { ServiceStateService } from '../../core/service-state.service';
import { ToastService } from '../../core/toast.service';
import { AppBackupEntry, ServiceEnvStatus, ServiceStatus } from '../../core/models';

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

  it('prefers the self-update digest pin when there is one', () => {
    component.service = service('itflow', 'running', {
      pinnedImages: ['itfloworg/itflow:latest@sha256:abc'],
      versionPinned: [],
    });
    expect(component['installedVersion']()).toBe('itfloworg/itflow:latest@sha256:abc');
  });

  it('falls back to the base compose tag when nothing is digest-pinned yet', () => {
    component.service = service('guacamole', 'running', { pinnedImages: [], versionPinned: ['1.6.0'] });
    expect(component['installedVersion']()).toBe('1.6.0');
  });

  it('falls back to "latest" when neither is set', () => {
    component.service = service('clamav', 'running', { pinnedImages: [], versionPinned: [] });
    expect(component['installedVersion']()).toBe('latest');
  });

  it('renders a single ⓥ badge with the version in its title, and no pinned badges or Unpin button', () => {
    component.service = service('guacamole', 'running', { pinnedImages: [], versionPinned: ['1.6.0'] });
    component.allServices = [component.service];
    fixture.detectChanges();

    const root: HTMLElement = fixture.nativeElement;
    const versionBadge = Array.from(root.querySelectorAll('span')).find((el) => el.textContent?.trim() === 'ⓥ');
    expect(versionBadge).withContext('ⓥ badge should render').toBeTruthy();
    expect(versionBadge?.getAttribute('title')).toBe('Installed: 1.6.0');

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
    expect(link?.textContent?.trim()).toBe('lanOnly');
    expect(link?.getAttribute('href')).toBe(`http://${window.location.hostname}:10450`);
  });

  it('renders an overlayOnly link, tagged, when the app is overlay-only', () => {
    component.service = service('guacamole', 'running', { overlayOnly: true, webPort: 10240 });
    component.allServices = [component.service];
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector('a.badge') as HTMLAnchorElement | null;
    expect(link?.textContent?.trim()).toBe('overlayOnly');
  });

  it('does not render the LAN/overlay link when the app is publicly exposed instead', () => {
    component.service = service('nextcloud', 'running', { exposedHostname: 'nextcloud.example.com' });
    component.allServices = [component.service];
    fixture.detectChanges();

    const badges = Array.from(fixture.nativeElement.querySelectorAll('a.badge')) as HTMLAnchorElement[];
    expect(badges.some((b) => b.textContent?.trim() === 'lanOnly' || b.textContent?.trim() === 'overlayOnly')).toBe(
      false
    );
  });
});
