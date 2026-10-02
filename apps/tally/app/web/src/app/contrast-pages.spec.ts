import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AppComponent } from './app.component';
import { StoresComponent } from './stores/stores.component';
import { ApiService } from './api.service';

/**
 * §806.3's contrast spec covered only the shop view, so the shell's tagline
 * (2.84:1 in dark) and the Shops page (outline buttons and a success-coloured
 * version at ~3.2:1) shipped unmeasured. Same method: computed colour over the
 * resolved painted background, both modes. Disabled controls are exempt
 * (WCAG 1.4.3 excludes inactive components).
 */
function lum(colour: string): number {
  const [r, g, b] = colour.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
  const f = (c: number) => ((c / 255) <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
function backgroundOf(el: Element): string {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const c = getComputedStyle(n).backgroundColor;
    if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c;
  }
  return 'rgb(255, 255, 255)';
}
function failures(root: HTMLElement): string[] {
  const out: string[] = [];
  for (const el of Array.from(root.querySelectorAll('a, p, span, td, th, button, code, h1, h2, h3, small, label'))) {
    const node = el as HTMLElement;
    const own = Array.from(node.childNodes).filter((c) => c.nodeType === Node.TEXT_NODE).map((c) => c.textContent?.trim()).join('');
    if (!own || (node as HTMLButtonElement).disabled || node.classList.contains('disabled')) continue;
    const s = getComputedStyle(node);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    const r = ratio(s.color, backgroundOf(node));
    if (r < 4.5) out.push(`${own.slice(0, 24)} — ${r.toFixed(2)}:1`);
  }
  return out;
}

describe('contrast beyond the shop view (plan.md §806.6)', () => {
  afterEach(() => document.documentElement.removeAttribute('data-bs-theme'));

  for (const theme of ['light', 'dark'] as const) {
    it(`keeps the shell readable in ${theme} mode`, async () => {
      document.documentElement.setAttribute('data-bs-theme', theme);
      await TestBed.configureTestingModule({ imports: [AppComponent], providers: [provideRouter([])] }).compileComponents();
      const fixture = TestBed.createComponent(AppComponent);
      document.body.appendChild(fixture.nativeElement);
      fixture.detectChanges();
      expect(failures(fixture.nativeElement)).toEqual([]);
      fixture.nativeElement.remove();
    });

    it(`keeps the Shops page readable in ${theme} mode, as an admin`, async () => {
      document.documentElement.setAttribute('data-bs-theme', theme);
      const api = jasmine.createSpyObj('ApiService', ['listStores', 'me', 'agentPackage', 'listAccess']);
      api.listStores.and.returnValue(
        of([
          { id: 'abc', name: 'Pastelaria Central', isActive: true, agentEnrolled: true, connected: true,
            lastSeenAt: '2026-10-03T12:42:00Z', agentVersion: '1.4.0' },
        ])
      );
      api.me.and.returnValue(of({ user: 'admin', isAdmin: true }) as never);
      api.agentPackage.and.returnValue(of({ version: '1.4.0' }) as never);
      api.listAccess.and.returnValue(of([]));
      await TestBed.configureTestingModule({
        imports: [StoresComponent],
        providers: [provideRouter([]), { provide: ApiService, useValue: api }],
      }).compileComponents();
      const fixture = TestBed.createComponent(StoresComponent);
      document.body.appendChild(fixture.nativeElement);
      fixture.detectChanges();
      expect(failures(fixture.nativeElement)).toEqual([]);
      fixture.nativeElement.remove();
    });
  }
});
