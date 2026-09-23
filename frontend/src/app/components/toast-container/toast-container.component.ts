import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ToastService } from '../../core/toast.service';
import { TranslatePipe } from '../../i18n/translate.pipe';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './toast-container.component.html',
  styleUrl: './toast-container.component.css'
})
export class ToastContainerComponent {
  protected readonly toastService = inject(ToastService);

  dismiss(id: number): void {
    this.toastService.dismiss(id);
  }
}
