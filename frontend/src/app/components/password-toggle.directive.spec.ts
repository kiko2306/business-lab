import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PasswordToggleDirective } from './password-toggle.directive';

// plan.md §827 fix 4: a 16-character password typed blind on a phone, with no
// way to see it, is the commonest reason for a second attempt.
@Component({
    imports: [PasswordToggleDirective],
    template: `
    <input id="pw" type="password" />
    <button type="button" appPasswordToggle="pw" #toggle="appPasswordToggle">{{ toggle.shown ? 'Hide' : 'Show' }}</button>`
})
class HostComponent {}

describe('PasswordToggleDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  const input = () => fixture.nativeElement.querySelector('#pw') as HTMLInputElement;
  const button = () => fixture.nativeElement.querySelector('button') as HTMLButtonElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('starts hidden, and says so to a screen reader', () => {
    expect(input().type).toBe('password');
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(button().textContent).toBe('Show');
  });

  it('shows the password on click, and hides it again on the next', () => {
    button().click();
    fixture.detectChanges();
    expect(input().type).toBe('text');
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(button().textContent).toBe('Hide');

    button().click();
    fixture.detectChanges();
    expect(input().type).toBe('password');
  });

  it('keeps what was typed, and leaves focus on the button so the pressed state is announced', () => {
    input().value = 'hunter2hunter2';
    button().focus();

    button().click();
    fixture.detectChanges();

    expect(input().value).toBe('hunter2hunter2');
    expect(document.activeElement).toBe(button());
  });

  it('does not submit the form it sits in', () => {
    expect(button().type).toBe('button');
  });
});
