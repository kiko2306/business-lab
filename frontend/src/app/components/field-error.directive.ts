import { Directive, ElementRef, Input, OnDestroy, OnInit, inject } from '@angular/core';

/**
 * Ties an inline validation message to the field it belongs to.
 *
 * The app had 25 of these messages and not one `aria-describedby`: a sighted
 * user saw red text under the input, while someone on a screen reader tabbed
 * into the field, heard the label, and got nothing — the message was an
 * unconnected text node beside it (WCAG 3.3.1, 1.3.1).
 *
 * Put it on the message, naming the control's `id`. Because the message is
 * rendered by an `*ngIf`, the directive's own lifecycle *is* the error state:
 * it wires the attributes when the message appears and removes them when it
 * goes, so nothing has to track validity twice.
 *
 *   <input id="smtpHost" formControlName="smtpHost" />
 *   <div class="form-text text-danger" *ngIf="…invalid" appFieldError="smtpHost">…</div>
 */
@Directive({
  selector: '[appFieldError]',
  standalone: true,
})
export class FieldErrorDirective implements OnInit, OnDestroy {
  /** The `id` of the control this message is about. */
  @Input({ required: true, alias: 'appFieldError' }) controlId!: string;

  private readonly host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;

  private get control(): HTMLElement | null {
    return document.getElementById(this.controlId);
  }

  ngOnInit(): void {
    const id = `${this.controlId}-error`;
    this.host.id = id;
    // The message appears after the page has settled, so announce it rather
    // than waiting for the user to find it.
    this.host.setAttribute('role', 'alert');

    const control = this.control;
    if (!control) {
      return;
    }
    control.setAttribute('aria-invalid', 'true');
    // A field may already point at a hint; keep it and add the error.
    const existing = (control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    control.setAttribute('aria-describedby', [...existing.filter((ref) => ref !== id), id].join(' '));
  }

  ngOnDestroy(): void {
    const control = this.control;
    if (!control) {
      return;
    }
    control.removeAttribute('aria-invalid');
    const remaining = (control.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter((ref) => ref && ref !== `${this.controlId}-error`);
    if (remaining.length) {
      control.setAttribute('aria-describedby', remaining.join(' '));
    } else {
      control.removeAttribute('aria-describedby');
    }
  }
}
