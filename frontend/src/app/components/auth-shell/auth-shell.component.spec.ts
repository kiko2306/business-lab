import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AuthShellComponent } from './auth-shell.component';

// plan.md §827 fix 5: login, setup and set-password each carried their own copy
// of the card, and /recovery was a different design again. One shell, so the
// four pages read as one flow.
@Component({
  standalone: true,
  imports: [AuthShellComponent],
  template: `
    <app-auth-shell kicker="Initial setup" title="Create the first administrator" [size]="size">
      <span auth-subtitle>A subtitle</span>
      <p id="body">The body</p>
      <a auth-footer id="footer" href="/login">Back</a>
    </app-auth-shell>`,
})
class HostComponent {
  size: 'narrow' | 'wide' = 'narrow';
}

describe('AuthShellComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  const host = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('names the page once, as its only h1, under a kicker and the product mark', () => {
    expect(host().querySelectorAll('h1').length).toBe(1);
    expect(host().querySelector('h1')?.textContent).toContain('Create the first administrator');
    expect(host().querySelector('.auth-kicker')?.textContent).toContain('Initial setup');
    expect(host().querySelector('img')?.getAttribute('alt')).toBe('');
  });

  it('puts the subtitle under the title, the body in the card and the footer last', () => {
    const card = host().querySelector('.auth-card') as HTMLElement;
    const order = ['h1', '[auth-subtitle]', '#body', '#footer'].map((s) => card.innerHTML.indexOf(host().querySelector(s)!.outerHTML));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBeTrue();
  });

  it('is the page\'s <main> landmark, once', () => {
    expect(host().querySelectorAll('main').length).toBe(1);
  });

  it('is narrow by default and wide when asked', () => {
    const col = () => host().querySelector('.row > div') as HTMLElement;
    expect(col().classList).toContain('col-xxl-4');

    fixture.componentInstance.size = 'wide';
    fixture.detectChanges();
    expect(col().classList).toContain('col-xl-7');
    expect(col().classList).not.toContain('col-xxl-4');
  });
});
