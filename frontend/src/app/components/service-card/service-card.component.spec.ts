import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ServiceCardComponent } from './service-card.component';
import { ConfirmService } from '../../core/confirm.service';
import { OperationsService } from '../../core/operations.service';
import { ServiceStateService } from '../../core/service-state.service';
import { ToastService } from '../../core/toast.service';
import { AppBackupEntry, ServiceEnvStatus, ServiceExposureConfig, ServiceStatus } from '../../core/models';

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
        { provide: OperationsService, useValue: jasmine.createSpyObj('OperationsService', ['getServiceExposure']) },
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
      'getServiceExposure',
      'getServiceEnv',
      'listAppBackups',
      'createAppBackup',
      'restoreAppBackup',
      'deleteAppBackup',
      'downloadAppBackup',
    ]);
    operations.listAppBackups.and.returnValue(of({ items: [] }));
    operations.getServiceExposure.and.returnValue(
      of({ enabled: false, exposable: false } as unknown as ServiceExposureConfig)
    );
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
