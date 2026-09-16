import { TestBed, fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import { of } from 'rxjs';
import { ResourceStripComponent } from './resource-strip.component';
import { OperationsService } from '../../core/operations.service';
import { HealthStatus } from '../../core/models';

const health = (extra: Partial<HealthStatus> = {}): HealthStatus => ({
  status: 'ok',
  database: 'ok',
  disks: [{ name: 'docker', path: '/', percentUsed: 20, totalBytes: 500e9, usedBytes: 100e9, availableBytes: 400e9 }],
  cpu: { percentUsed: 13 },
  memory: { percentUsed: 42, totalBytes: 16 * 1024 ** 3, usedBytes: 6.72 * 1024 ** 3 },
  load: { oneMinute: 0.5, loadPerCpu: 0.25 },
  thresholds: { diskPercent: 85, memoryPercent: 90, loadPerCpu: 1.5 },
  alerts: [],
  timestamp: new Date().toISOString(),
  ...extra,
});

describe('ResourceStripComponent', () => {
  let component: ResourceStripComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ResourceStripComponent],
      providers: [{ provide: OperationsService, useValue: jasmine.createSpyObj('OperationsService', ['getHealth']) }],
    }).compileComponents();

    component = TestBed.createComponent(ResourceStripComponent).componentInstance;
  });

  it('shows CPU as a percent, matching gethomepage\'s own CPU widget', () => {
    const [cpu] = component['toMeters'](health());
    expect(cpu.primary).toBe('13%');
    expect(cpu.label).toBe('CPU');
    expect(cpu.percent).toBe(13);
  });

  it('shows memory as free GiB (binary), not percent used', () => {
    const [, memory] = component['toMeters'](health());
    expect(memory.primary).toBe('9.3 GiB');
    expect(memory.label).toBe('Free');
    expect(memory.percent).toBe(42);
  });

  it('shows disk as free GB (decimal) for the fullest filesystem', () => {
    const [, , disk] = component['toMeters'](
      health({
        disks: [
          { name: 'docker', path: '/', percentUsed: 20, totalBytes: 500e9, usedBytes: 100e9, availableBytes: 400e9 },
          { name: 'system', path: '/hostfs', percentUsed: 55, totalBytes: 500e9, usedBytes: 275e9, availableBytes: 225e9 },
        ],
      })
    );
    expect(disk.primary).toBe('225 GB');
    expect(disk.percent).toBe(55);
  });

  it('reports "—" for disk when nothing could be measured, rather than a fake number', () => {
    const [, , disk] = component['toMeters'](health({ disks: [] }));
    expect(disk.primary).toBe('—');
    expect(disk.percent).toBe(0);
  });

  it('colours a meter by its own warn/crit thresholds, not a shared one', () => {
    const [cpu, memory] = component['toMeters'](health({ cpu: { percentUsed: 92 }, memory: { percentUsed: 50, totalBytes: 16 * 1024 ** 3, usedBytes: 8 * 1024 ** 3 } }));
    expect(component['level'](cpu)).toBe('crit');
    expect(component['level'](memory)).toBe('ok');
  });

  it('polls on mount and applies each response', fakeAsync(() => {
    const operations = TestBed.inject(OperationsService) as jasmine.SpyObj<OperationsService>;
    operations.getHealth.and.returnValue(of(health()));

    component.ngOnInit();
    tick(0);

    expect(component['meters']?.map((m) => m.key)).toEqual(['cpu', 'memory', 'disk']);
    discardPeriodicTasks();
  }));

  it('renders one line-art SVG icon per meter, not emoji text', fakeAsync(() => {
    const fixture = TestBed.createComponent(ResourceStripComponent);
    const operations = TestBed.inject(OperationsService) as jasmine.SpyObj<OperationsService>;
    operations.getHealth.and.returnValue(of(health()));

    fixture.componentInstance.ngOnInit();
    tick(0);
    fixture.detectChanges();

    const icons = fixture.nativeElement.querySelectorAll('svg.rs__icon');
    expect(icons.length).toBe(3);
    expect(fixture.nativeElement.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    discardPeriodicTasks();
  }));
});
