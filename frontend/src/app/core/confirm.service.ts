import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface ConfirmOptions {
  /** Bold heading; omit for a message-only dialog. */
  title?: string;
  /** Body text. `\n` renders as a line break. */
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** Paint the confirm button as a destructive action. */
  danger?: boolean;
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

/**
 * App-level replacement for `window.confirm()` — a real in-page modal instead
 * of the browser chrome dialog. `ConfirmDialogComponent` (mounted once in
 * AppComponent) renders whatever `request$` holds; `ask()` resolves to the
 * user's choice.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly request = new BehaviorSubject<ConfirmRequest | null>(null);
  readonly request$ = this.request.asObservable();

  ask(options: ConfirmOptions): Promise<boolean> {
    // One dialog at a time: a new request cancels whatever was open.
    this.request.value?.resolve(false);
    return new Promise<boolean>((resolve) => {
      this.request.next({ ...options, resolve });
    });
  }

  /** Called by the dialog component when the user picks an option. */
  respond(confirmed: boolean): void {
    const pending = this.request.value;
    if (!pending) {
      return;
    }
    pending.resolve(confirmed);
    this.request.next(null);
  }
}
