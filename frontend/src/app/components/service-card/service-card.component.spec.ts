import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ServiceCardComponent } from './service-card.component';
import { OperationsService } from '../../core/operations.service';
import { ServiceStateService } from '../../core/service-state.service';
import { ToastService } from '../../core/toast.service';
import { ServiceStatus } from '../../core/models';

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

  it('falls back to the raw name for a dependency the dashboard has no status for', () => {
    setUp({ dependsOn: ['authelia'] }, []);

    expect(component.dependencies()).toEqual([
      { name: 'authelia', label: 'authelia', running: false, blocking: true },
    ]);
  });
});
