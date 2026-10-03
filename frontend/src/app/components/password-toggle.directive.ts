import { Directive, Input } from '@angular/core';

/**
 * A show/hide button for a password field (plan.md §827 fix 4): a long
 * password typed blind on a phone is the commonest reason for a second try.
 *
 * Put it on the button, naming the input's `id`, and export it to label the
 * button from its state:
 *
 *   <input id="pw" type="password" />
 *   <button type="button" appPasswordToggle="pw" #t="appPasswordToggle">{{ t.shown ? 'Hide' : 'Show' }}</button>
 *
 * Focus stays on the button, so a screen reader hears the pressed state; what
 * was typed is untouched because only the input's `type` changes.
 */
@Directive({
  selector: '[appPasswordToggle]',
  standalone: true,
  exportAs: 'appPasswordToggle',
  host: {
    '(click)': 'toggle()',
    '[attr.aria-pressed]': 'shown',
    '[attr.aria-controls]': 'controlId',
  },
})
export class PasswordToggleDirective {
  /** The `id` of the password input this button reveals. */
  @Input({ required: true, alias: 'appPasswordToggle' }) controlId!: string;

  shown = false;

  toggle(): void {
    const input = document.getElementById(this.controlId) as HTMLInputElement | null;
    if (!input) {
      return;
    }
    this.shown = !this.shown;
    input.type = this.shown ? 'text' : 'password';
  }
}
