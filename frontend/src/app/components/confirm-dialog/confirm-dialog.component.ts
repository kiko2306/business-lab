import { CommonModule } from '@angular/common';
import { Component, HostListener, inject } from '@angular/core';
import { ConfirmService } from '../../core/confirm.service';

/**
 * The single confirm modal for the whole app (mounted in AppComponent, beside
 * the toast container). It shows whenever `ConfirmService.request$` is
 * non-null. Enter confirms, Escape / backdrop click / Cancel dismiss.
 */
@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './confirm-dialog.component.html',
  styleUrl: './confirm-dialog.component.css',
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

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.confirm.respond(false);
  }

  @HostListener('document:keydown.enter')
  onEnter(): void {
    this.confirm.respond(true);
  }
}
