import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { UsersComponent } from './users.component';
import { AuthService } from '../../core/auth.service';
import { ConfirmService } from '../../core/confirm.service';
import { OperationsService } from '../../core/operations.service';
import { SettingsService } from '../../core/settings.service';
import { ToastService } from '../../core/toast.service';
import { TranslateService } from '../../i18n/translate.service';

/**
 * The Users table has to fit the screen it is on (plan.md §813, P0). The
 * stacked-card layout and the `.table-responsive` scroller both live behind
 * media queries, and Karma's own window is neither a phone nor a laptop, so
 * the page is moved into an iframe of the width being checked: the media
 * queries then evaluate against that width, not Karma's.
 *
 * `shell` is the gutter the real shell and panel leave around the table —
 * measured on the rendered page: a 1280 viewport leaves the table 1222 wide, a
 * 390 one leaves 332.
 */
const GUTTER = 29;
const LONG_EMAIL = `${'a'.repeat(50)}.${'b'.repeat(20)}@padariasilva.pt`;

const users = [
  { id: 1, username: 'admin', email: 'admin@example.com', created_at: '2026-01-01', roles: ['webmaster', 'admin', 'user'], capabilities: [], appAccess: [], active: true },
  { id: 2, username: 'ines.costa.contabilidade', email: LONG_EMAIL, created_at: '2026-01-02', roles: ['admin'], capabilities: [], appAccess: ['paperless', 'kimai'], active: true },
  { id: 3, username: 'novo.colaborador', email: 'novo@padariasilva.pt', created_at: '2026-01-03', roles: ['user'], capabilities: [], appAccess: [], active: false },
];

async function mountUsersAt(width: number): Promise<{ frame: HTMLIFrameElement; doc: Document; clean: () => void }> {
  const operations = jasmine.createSpyObj('OperationsService', ['listUsers', 'listAppAccessOptions']);
  operations.listUsers.and.returnValue(of({ items: users }));
  operations.listAppAccessOptions.and.returnValue(of({ items: [] }));
  await TestBed.configureTestingModule({
    imports: [UsersComponent],
    providers: [
      provideRouter([]),
      { provide: OperationsService, useValue: operations },
      { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
      { provide: SettingsService, useValue: { getMailSettings: () => of({ configured: true }) } },
      { provide: AuthService, useValue: { user$: of({ id: 1 }), hasCapability: () => of(true), isWebmaster: () => true } },
      { provide: ConfirmService, useValue: jasmine.createSpyObj('ConfirmService', ['ask']) },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(UsersComponent);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  // Panels start collapsed, so the table is not in the DOM until they are opened.
  host.querySelectorAll<HTMLButtonElement>('.panel__toggle[aria-expanded="false"]').forEach((toggle) => toggle.click());
  (fixture.componentInstance as unknown as { startPasswordReset(id: number): void }).startPasswordReset(2);
  fixture.detectChanges();

  const frame = document.createElement('iframe');
  frame.style.cssText = `width:${width}px;height:900px;border:0;position:fixed;left:0;top:0;visibility:hidden`;
  document.body.appendChild(frame);
  const doc = frame.contentDocument as Document;
  // Component styles are injected into the main document's <head>; copy them in.
  document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => doc.head.appendChild(node.cloneNode(true)));
  doc.body.style.cssText = `margin:0;padding:0 ${GUTTER}px`;
  doc.body.appendChild(doc.adoptNode(host));
  fixture.detectChanges();
  // Let the cloned stylesheets load before anything is measured.
  await new Promise((resolve) => setTimeout(resolve, 150));

  return { frame, doc, clean: () => frame.remove() };
}

function overflowing(doc: Document): string[] {
  const failures: string[] = [];
  const viewport = doc.documentElement.clientWidth;
  if (doc.documentElement.scrollWidth > viewport) {
    failures.push(`page ${doc.documentElement.scrollWidth}px wide in a ${viewport}px viewport`);
  }
  doc.querySelectorAll<HTMLElement>('.table-responsive').forEach((wrap) => {
    if (wrap.scrollWidth > wrap.clientWidth + 1) {
      failures.push(`table scrolls sideways: ${wrap.scrollWidth}px in a ${wrap.clientWidth}px box`);
    }
  });
  doc.querySelectorAll<HTMLElement>('tbody button').forEach((button) => {
    if (button.getBoundingClientRect().right > viewport) {
      failures.push(`"${button.textContent?.trim()}" ends past the right edge of the screen`);
    }
  });
  return failures;
}

describe('Users table fits the screen (plan.md §813)', () => {
  const translate = () => TestBed.inject(TranslateService);

  // Panel open/closed state persists in localStorage; a leftover "open" would
  // make the spec's toggle click close the panels instead.
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  for (const [label, width] of [['laptop', 1280], ['phone', 390]] as const) {
    for (const locale of ['en', 'pt-PT'] as const) {
      it(`has no horizontal overflow on a ${label} in ${locale}, with a 70-character email and the reset-password editor open`, async () => {
        localStorage.setItem('locale', locale);
        const { doc, clean } = await mountUsersAt(width);
        try {
          expect(translate().locale()).toBe(locale);
          expect(doc.querySelectorAll('tbody tr').length).toBeGreaterThanOrEqual(users.length);
          expect(overflowing(doc)).toEqual([]);
        } finally {
          clean();
        }
      });
    }
  }
});
