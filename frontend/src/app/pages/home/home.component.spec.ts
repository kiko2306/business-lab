import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { HomeComponent } from './home.component';
import { AuthService } from '../../core/auth.service';
import { Capability } from '../../core/capabilities';
import { ServiceSummary } from '../../core/models';
import { ServiceStateService } from '../../core/service-state.service';
import { en } from '../../i18n/en';
import { ptPT } from '../../i18n/pt-pt';

// Plan.md §776/§781: Home answers "is everything OK?" before it lists areas,
// every tile leads to a real page, and no two tiles share a destination.
describe('HomeComponent', () => {
  let fixture: ComponentFixture<HomeComponent>;
  let el: HTMLElement;
  let summary$: BehaviorSubject<ServiceSummary>;
  let state: jasmine.SpyObj<ServiceStateService>;

  const setUp = (capabilities: Capability[] | 'all') => {
    summary$ = new BehaviorSubject<ServiceSummary>({ total: 0, running: 0, stopped: 0, error: 0, starting: 0 });
    state = jasmine.createSpyObj('ServiceStateService', ['startPolling', 'stopPolling'], { summary$ });
    TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [
        provideRouter([]),
        { provide: ServiceStateService, useValue: state },
        {
          provide: AuthService,
          useValue: { hasCapability: (c: Capability) => capabilities === 'all' || capabilities.includes(c) },
        },
      ],
    });
    fixture = TestBed.createComponent(HomeComponent);
    el = fixture.nativeElement;
    fixture.detectChanges();
  };

  const links = () => Array.from(el.querySelectorAll<HTMLAnchorElement>('a.menu-tile')).map((a) => a.getAttribute('href'));

  it('has one tile per destination, all of them real pages', () => {
    setUp('all');
    const hrefs = links();
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toContain('/updates');
    expect(el.querySelector('.menu-tile__badge')).toBeNull();
  });

  it('still shows Settings to a role that only holds exposure:settings', () => {
    setUp(['exposure:settings']);
    expect(links()).toEqual(['/settings', '/account']); // Account has no capability gate
  });

  it('says how the box is doing, from the live summary', () => {
    setUp('all');
    summary$.next({ total: 36, running: 30, stopped: 6, error: 0, starting: 0 });
    fixture.detectChanges();
    expect(el.querySelector('.home-status')?.textContent).toContain('All 36 apps are fine.');

    summary$.next({ total: 36, running: 30, stopped: 3, error: 3, starting: 0 });
    fixture.detectChanges();
    const status = el.querySelector('.home-status');
    expect(status?.textContent).toContain('3 of 36 apps need you.');
    expect(status?.querySelector('a')?.getAttribute('href')).toBe('/apps');
  });

  it('shows no status, and does not poll, for a role that cannot control apps', () => {
    setUp(['account' as Capability]);
    expect(el.querySelector('.home-status')).toBeNull();
    expect(state.startPolling).not.toHaveBeenCalled();
  });

  it('polls while it is on screen and stops when it leaves', () => {
    setUp('all');
    expect(state.startPolling).toHaveBeenCalledTimes(1);
    fixture.destroy();
    expect(state.stopPolling).toHaveBeenCalledTimes(1);
  });

  it('has plain copy in both languages and no leftover stub strings', () => {
    for (const dict of [en, ptPT]) {
      expect(dict['home.tiles.networking.title']).toBeUndefined();
      expect(dict['home.pendingBadge']).toBeUndefined();
      expect(dict['home.tiles.settings.description']).toBeTruthy();
    }
    const jargon = /registry|tunnel|provisioning|ntfy|snapshot|stack|image updates/i;
    for (const key of Object.keys(en).filter((k) => k.startsWith('home.'))) {
      expect(en[key]).withContext(key).not.toMatch(jargon);
    }
  });
});
