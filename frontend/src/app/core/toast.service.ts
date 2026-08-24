import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ToastMessage } from './models';

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  private readonly toastsSubject = new BehaviorSubject<ToastMessage[]>([]);
  private nextId = 1;

  readonly toasts$ = this.toastsSubject.asObservable();

  success(text: string): void {
    this.show('success', text);
  }

  error(text: string): void {
    this.show('danger', text);
  }

  info(text: string): void {
    this.show('info', text);
  }

  warning(text: string): void {
    this.show('warning', text);
  }

  dismiss(id: number): void {
    this.toastsSubject.next(this.toastsSubject.value.filter((toast) => toast.id !== id));
  }

  private show(variant: ToastMessage['variant'], text: string): void {
    const toast = { id: this.nextId++, variant, text };
    this.toastsSubject.next([...this.toastsSubject.value, toast]);
    window.setTimeout(() => this.dismiss(toast.id), 5000);
  }
}
