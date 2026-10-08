import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ConfirmService } from '../../core/confirm.service';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { ModalFocusDirective } from '../modal-focus.directive';

/**
 * The single confirm modal for the whole app (mounted in AppComponent, beside
 * the toast container). It shows whenever `ConfirmService.request$` is
 * non-null. Escape / backdrop click / Cancel dismiss. There is deliberately no
 * document-level Enter: it confirmed from anywhere on the page, so Enter with
 * focus on a page control could answer "delete this user?" yes (plan.md §813).
 * Focus moves into the dialog and Enter works on the focused button, as usual.
 */
@Component({
    selector: 'app-confirm-dialog',
    imports: [CommonModule, TranslatePipe, ModalFocusDirective],
    templateUrl: './confirm-dialog.component.html',
    styleUrl: './confirm-dialog.component.css'
})
export class ConfirmDialogComponent {
  protected readonly confirm = inject(ConfirmService);

  respond(confirmed: boolean): void {
    this.confirm.respond(confirmed);
  }

  onBackdrop(event: MouseEvent): void {
    // Only a click on the backdrop itself, not one bubbling from the dialog.
    if (event.target === event.currentTarget) {
      this.confirm.respond(false);
    }
  }
}
