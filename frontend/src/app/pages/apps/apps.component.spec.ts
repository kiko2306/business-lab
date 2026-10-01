import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { AppsComponent } from './apps.component';
import { ServiceStateService } from '../../core/service-state.service';
import { ServiceCategory, ServiceStatus } from '../../core/models';

const service = (name: string, category: ServiceCategory, state: ServiceStatus['state'] = 'running'): ServiceStatus => ({
  name,
  label: name,
  description: `${name} description`,
  icon: '',
  category,
  state,
  healthy: state === 'running',
  lastChecked: '',
});

// 50 apps across the registry's categories — what a real box looks like, and
// the size that makes re-grouping on every change-detection pass expensive.
const manyServices = Array.from({ length: 50 }, (_, i) =>
  service(`app-${i}`, i % 2 ? 'Media' : 'Productivity', i % 5 === 0 ? 'stopped' : 'running')
);

describe('AppsComponent grouping', () => {
  let fixture: ComponentFixture<AppsComponent>;
  let component: AppsComponent;
  let services$: BehaviorSubject<ServiceStatus[]>;

  beforeEach(async () => {
    localStorage.clear();
    services$ = new BehaviorSubject<ServiceStatus[]>(manyServices);
    const serviceState = {
      services$,
      summary$: of({ total: 50, running: 40, stopped: 10, error: 0, starting: 0 }),
      refreshing$: of(false),
      lastUpdated$: of(null),
      connectionStatus$: of('connected'),
      operating$: of({}),
      hostLanIp$: of(null),
      startPolling: () => undefined,
      stopPolling: () => undefined,
      refresh: () => undefined,
    };

    await TestBed.configureTestingModule({
      imports: [AppsComponent],
      providers: [provideRouter([]), { provide: ServiceStateService, useValue: serviceState }],
    }).compileComponents();
    fixture = TestBed.createComponent(AppsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // The list used to be filtered and re-grouped by calling both functions from
  // the template, so ~50 services were re-bucketed and re-ordered on every
  // change-detection pass — every keystroke, every click, anywhere on the page
  // — not only when the data or the filter actually moved.
  it('groups once and reuses the result until something changes', () => {
    const first = component.groups();
    fixture.detectChanges();
    fixture.detectChanges();
    expect(component.groups()).toBe(first);
  });

  it('regroups when the search text changes', () => {
    const first = component.groups();
    component.appFilter.set('app-1');
    const narrowed = component.groups();
    expect(narrowed).not.toBe(first);
    expect(narrowed.flatMap((group) => group.services).length).toBeLessThan(manyServices.length);
  });

  it('regroups when a new status payload arrives', () => {
    const first = component.groups();
    services$.next(manyServices.slice(0, 10));
    expect(component.groups()).not.toBe(first);
    expect(component.groups().flatMap((group) => group.services).length).toBe(10);
  });

  it('regroups when a summary tile sets a state filter', () => {
    component.toggleStateFilter('stopped');
    expect(component.groups().flatMap((group) => group.services).every((s) => s.state === 'stopped')).toBeTrue();

    component.toggleStateFilter('stopped');
    expect(component.groups().flatMap((group) => group.services).length).toBe(manyServices.length);
  });

});
