import { ComponentFixture, TestBed, fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { HealthSummaryComponent } from './health-summary.component';
import { HealthStatus } from '../../core/models';
import { OperationsService } from '../../core/operations.service';
import { TranslateService } from '../../i18n/translate.service';

// plan.md §841 fix 1: health lives on Home as sentences, a state word beside
// every bar (colour is never the only signal), a "checked at" time, and a
// Retry instead of a "Loading…" that never ends.
const health = (extra: Partial<HealthStatus> = {}): HealthStatus => ({
  status: 'ok',
  database: 'ok',
  disks: [{ name: 'docker', path: '/', percentUsed: 20, totalBytes: 500e9, usedBytes: 100e9, availableBytes: 400e9 }],
  cpu: { percentUsed: 13 },
  memory: { percentUsed: 42, totalBytes: 16 * 1024 ** 3, usedBytes: 6.72 * 1024 ** 3 },
  load: { oneMinute: 0.5, loadPerCpu: 0.25 },
  thresholds: { diskPercent: 85, memoryPercent: 90, loadPerCpu: 1.5 },
  alerts: [],
  timestamp: '2026-10-06T10:02:00Z',
  ...extra,
});

describe('HealthSummaryComponent', () => {
  let fixture: ComponentFixture<HealthSummaryComponent>;
  let el: HTMLElement;
  let operations: jasmine.SpyObj<OperationsService>;

  const setUp = () => {
    operations = jasmine.createSpyObj('OperationsService', ['getHealth']);
    TestBed.configureTestingModule({
      imports: [HealthSummaryComponent],
      providers: [{ provide: OperationsService, useValue: operations }],
    });
    TestBed.inject(TranslateService).setLocale('en');
    fixture = TestBed.createComponent(HealthSummaryComponent);
    el = fixture.nativeElement;
  };
  const text = () => el.textContent?.replace(/\s+/g, ' ') ?? '';

  it('says it is checking while the first read is out, in a live region', () => {
    setUp();
    operations.getHealth.and.returnValue(new Subject<HealthStatus>());
    fixture.detectChanges();
    expect(text()).toContain('Checking the server…');
    expect(el.querySelector('[role="status"]')).not.toBeNull();
  });

  it('leads with a plain sentence, never the API words', () => {
    setUp();
    operations.getHealth.and.returnValue(of(health()));
    fixture.detectChanges();
    expect(text()).toContain('Everything is running normally.');
    expect(text()).not.toMatch(/\bok\b|degraded/);
    expect(text()).toContain('Checked');
  });

  it('puts a state word on every row, and names the one that needs attention', () => {
    setUp();
    operations.getHealth.and.returnValue(
      of(
        health({
          status: 'degraded',
          memory: { percentUsed: 95, totalBytes: 16 * 1024 ** 3, usedBytes: 15.2 * 1024 ** 3 },
          alerts: [{ metric: 'memory', value: 95, threshold: 90 }],
        })
      )
    );
    fixture.detectChanges();
    const rows = Array.from(el.querySelectorAll('.health-row'));
    expect(rows.length).toBe(4);
    const states = rows.map((r) => r.querySelector('.health-row__state')?.textContent?.trim());
    expect(states).toEqual(['Fine', 'Fine', 'Needs attention', 'Fine']);
    expect(text()).toContain('Memory is running low: 95% in use.');
  });

  it('draws a bar for disk and memory only, labelled for assistive tech', () => {
    setUp();
    operations.getHealth.and.returnValue(of(health()));
    fixture.detectChanges();
    const bars = Array.from(el.querySelectorAll('[role="progressbar"]'));
    expect(bars.length).toBe(2);
    expect(bars[0].getAttribute('aria-valuenow')).toBe('20');
    expect(bars[0].getAttribute('aria-label')).toBe('Disk space');
  });

  it('shows an inline error with Try again when the read fails, and recovers', () => {
    setUp();
    operations.getHealth.and.returnValue(throwError(() => new Error('boom')));
    fixture.detectChanges();
    expect(text()).toContain('Could not read the server’s health.');
    operations.getHealth.and.returnValue(of(health()));
    el.querySelector<HTMLButtonElement>('.health-summary__retry')!.click();
    fixture.detectChanges();
    expect(text()).toContain('Everything is running normally.');
    expect(el.querySelector('.health-summary__retry')).toBeNull();
  });

  it('keeps the last good read when a later poll fails', fakeAsync(() => {
    setUp();
    operations.getHealth.and.returnValue(of(health()));
    fixture.detectChanges();
    operations.getHealth.and.returnValue(throwError(() => new Error('blip')));
    tick(30_000);
    fixture.detectChanges();
    expect(text()).toContain('Everything is running normally.');
    expect(text()).not.toContain('Could not read');
    discardPeriodicTasks();
  }));
});
