import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ShellComponent } from './shell.component';
import { AuthService } from '../../core/auth.service';
import { OperationsService } from '../../core/operations.service';

describe('ShellComponent', () => {
  let fixture: ComponentFixture<ShellComponent>;
  let element: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ShellComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: { user$: of(null), capabilities$: of(new Set<string>()), logout: () => of(null) },
        },
        {
          provide: OperationsService,
          // getHealth feeds the header's resource strip, which renders inside the shell.
          useValue: { getAppVersion: () => of({ version: '0.0.0' }), getHealth: () => of(null) },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ShellComponent);
    element = fixture.nativeElement;
    fixture.detectChanges();
  });

  // The header repeats 11 nav links plus the language, theme and logout
  // controls on every route. Without this, reaching the page itself by
  // keyboard means tabbing through all of them, every single navigation.
  it('offers a skip link as the first focusable thing on the page', () => {
    const first = element.querySelector('a, button, input, select') as HTMLElement;
    expect(first.classList).toContain('skip-link');
    expect(first.getAttribute('href')).toBe('#main-content');
  });

  it('gives that link something to land on', () => {
    const target = element.querySelector('#main-content') as HTMLElement;
    expect(target).not.toBeNull();
    // Programmatically focusable, so the skip actually moves the caret rather
    // than only scrolling.
    expect(target.getAttribute('tabindex')).toBe('-1');
  });
});
