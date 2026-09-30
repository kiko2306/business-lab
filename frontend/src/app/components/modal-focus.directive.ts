import { AfterViewInit, Directive, ElementRef, EventEmitter, HostListener, Input, OnDestroy, Output, inject } from '@angular/core';

/**
 * Focus behaviour for a hand-rolled `role="dialog"`: `aria-modal` alone does not
 * stop Tab reaching the page behind it. On open, focus moves to the dialog; Tab
 * and Shift+Tab wrap inside it; Escape emits `dismiss` while `dismissible`; on
 * close, focus returns to whatever opened it. The dialog names itself with
 * `aria-label`/`aria-labelledby`, as before.
 */
@Directive({ selector: '[appModalFocus]', standalone: true })
export class ModalFocusDirective implements AfterViewInit, OnDestroy {
  /** False while the work behind the dialog is running and there is no way out yet. */
  @Input() dismissible = true;
  @Output() dismiss = new EventEmitter<void>();

  private readonly host: HTMLElement = inject(ElementRef).nativeElement;
  private opener: HTMLElement | null = null;

  ngAfterViewInit(): void {
    this.opener = document.activeElement as HTMLElement | null;
    this.host.setAttribute('tabindex', '-1');
    this.host.focus();
  }

  ngOnDestroy(): void {
    this.opener?.focus();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.dismissible) {
      this.dismiss.emit();
    }
  }

  @HostListener('keydown', ['$event'])
  trapTab(event: KeyboardEvent): void {
    if (event.key !== 'Tab') {
      return;
    }
    const focusable = this.host.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
    );
    if (!focusable.length) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === this.host)) {
      last.focus();
      event.preventDefault();
    } else if (!event.shiftKey && active === last) {
      first.focus();
      event.preventDefault();
    }
  }
}
