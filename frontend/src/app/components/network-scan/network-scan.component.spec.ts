import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, throwError } from 'rxjs';
import { NetworkScanComponent } from './network-scan.component';
import { DiscoveredHost } from '../../core/models';
import { OperationsService } from '../../core/operations.service';
import { TranslateService } from '../../i18n/translate.service';
import { en } from '../../i18n/en';
import { ptPT } from '../../i18n/pt-pt';

// plan.md §841 fix 2: the LAN scan moved from Utils to Settings. A 10-second
// wait now keeps keyboard focus on the button, says so in a live region, and
// every outcome — hosts, none, failure — says what to do next.
describe('NetworkScanComponent', () => {
  let fixture: ComponentFixture<NetworkScanComponent>;
  let el: HTMLElement;
  let operations: jasmine.SpyObj<OperationsService>;
  let scan$: Subject<{ hosts: DiscoveredHost[] }>;

  beforeEach(() => {
    localStorage.clear();
    operations = jasmine.createSpyObj('OperationsService', ['scanNetwork']);
    scan$ = new Subject();
    operations.scanNetwork.and.returnValue(scan$);
    TestBed.configureTestingModule({
      imports: [NetworkScanComponent],
      providers: [{ provide: OperationsService, useValue: operations }],
    });
    TestBed.inject(TranslateService).setLocale('en');
    fixture = TestBed.createComponent(NetworkScanComponent);
    el = fixture.nativeElement;
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.panel__toggle')!.click(); // panels start collapsed
    fixture.detectChanges();
  });

  const text = () => el.textContent?.replace(/\s+/g, ' ') ?? '';
  const scanButton = () => el.querySelector<HTMLButtonElement>('.network-scan__button')!;
  const status = () => el.querySelector('[role="status"]')?.textContent?.trim();

  it('does not scan until asked, and says what a scan is in plain words', () => {
    expect(operations.scanNetwork).not.toHaveBeenCalled();
    expect(text()).toContain('Find devices connected to your network');
    expect(text()).not.toMatch(/ping|MAC|sweep/i);
  });

  it('keeps focus on the button while scanning and says so in a live region', () => {
    const button = scanButton();
    button.focus();
    button.click();
    fixture.detectChanges();
    // `disabled` would drop focus to <body>; aria-disabled keeps the place.
    expect(button.disabled).toBeFalse();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(button);
    expect(status()).toBe('Scanning your network. This takes about 10 seconds.');
  });

  it('ignores a second click while a scan is running', () => {
    scanButton().click();
    fixture.detectChanges();
    scanButton().click();
    expect(operations.scanNetwork).toHaveBeenCalledTimes(1);
  });

  it('announces how many devices answered and lists them, unknowns in words', () => {
    scanButton().click();
    scan$.next({
      hosts: [
        { ip: '192.168.1.1', hostname: 'router.lan', type: 'Router' },
        { ip: '192.168.1.40', hostname: null, type: null },
      ],
    });
    fixture.detectChanges();
    expect(status()).toBe('Found 2 devices.');
    const rows = Array.from(el.querySelectorAll('tbody tr')).map((r) => r.textContent?.replace(/\s+/g, ' ').trim());
    expect(rows[2]).toContain('Unknown');
    expect(rows[2]).not.toContain('—');
    expect(text()).toContain('Device maker');
    expect(scanButton().getAttribute('aria-disabled')).toBeNull();
    expect(scanButton().textContent).toContain('Scan again');
  });

  // plan.md §841 fix 4: this server first, devices with a name or maker next, the rest under a heading.
  it('puts this server first, tags it, and sets unrecognised devices apart at the end', () => {
    scanButton().click();
    scan$.next({
      hosts: [
        { ip: '192.168.1.40', hostname: null, type: null },
        { ip: '192.168.1.1', hostname: 'router.lan', type: 'Router' },
        { ip: '192.168.1.236', hostname: null, type: null, isServer: true },
        { ip: '192.168.1.9', hostname: null, type: 'Printer Co' },
      ],
    });
    fixture.detectChanges();
    const rows = Array.from(el.querySelectorAll('tbody tr')).map((r) => r.textContent?.replace(/\s+/g, ' ').trim() ?? '');
    expect(rows[0]).toContain('192.168.1.236');
    expect(rows[0]).toContain(en['settings.networkScan.thisServer']);
    expect(rows[1]).toContain('192.168.1.1');
    expect(rows[2]).toContain('192.168.1.9');
    expect(rows[3]).toContain(en['settings.networkScan.notRecognised']);
    expect(rows[4]).toContain('192.168.1.40');
    expect(rows).toHaveSize(5);
  });

  it('shows no heading when every device is recognised', () => {
    scanButton().click();
    scan$.next({ hosts: [{ ip: '192.168.1.1', hostname: 'router.lan', type: null }] });
    fixture.detectChanges();
    expect(text()).not.toContain(en['settings.networkScan.notRecognised']);
  });

  it('says "1 device" for one', () => {
    scanButton().click();
    scan$.next({ hosts: [{ ip: '192.168.1.1', hostname: 'router.lan', type: null }] });
    fixture.detectChanges();
    expect(status()).toBe('Found 1 device.');
  });

  it('tells you what to try when nothing answers', () => {
    scanButton().click();
    scan$.next({ hosts: [] });
    fixture.detectChanges();
    expect(status()).toContain('No devices answered.');
    expect(status()).toContain('same network');
  });

  it('shows a failure beside the button, as an alert, and lets you retry from it', () => {
    operations.scanNetwork.and.returnValue(throwError(() => new Error('502')));
    scanButton().click();
    fixture.detectChanges();
    const alert = el.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('The scan did not finish.');
    expect(scanButton().textContent).toContain('Scan again');
    expect(scanButton().getAttribute('aria-disabled')).toBeNull();
  });

  it('has every settings.networkScan.* string in both languages', () => {
    for (const key of Object.keys(en).filter((k) => k.startsWith('settings.networkScan.'))) {
      expect(ptPT[key]).withContext(key).toBeTruthy();
    }
    expect(Object.keys(en).filter((k) => k.startsWith('settings.networkScan.')).length).toBeGreaterThan(5);
  });
});
