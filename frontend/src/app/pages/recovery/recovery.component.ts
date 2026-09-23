import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { extractErrorMessage } from '../../core/api';
import { OperationsService } from '../../core/operations.service';
import { ToastService } from '../../core/toast.service';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { TranslateService } from '../../i18n/translate.service';

@Component({
  selector: 'app-recovery',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe],
  templateUrl: './recovery.component.html',
  styleUrl: './recovery.component.css'
})
export class RecoveryComponent implements OnInit {
  private readonly operations = inject(OperationsService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);

  protected enabled = false;
  protected username = '';
  protected password = '';

  ngOnInit(): void {
    this.loadStatus();
  }

  loadStatus(): void {
    this.operations.getRecoveryStatus().subscribe({
      next: (response) => (this.enabled = response.enabled),
      error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('recovery.errors.loadStatus'))),
    });
  }

  enable(): void {
    this.operations.enableRecoveryMode().subscribe({
      next: (response) => {
        this.enabled = response.enabled;
        this.toast.success(response.message);
      },
      error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('recovery.errors.enable'))),
    });
  }

  disable(): void {
    this.operations.disableRecoveryMode().subscribe({
      next: (response) => {
        this.enabled = response.enabled;
        this.toast.success(response.message);
      },
      error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('recovery.errors.disable'))),
    });
  }

  resetPassword(): void {
    this.operations.resetAdminPassword(this.username, this.password).subscribe({
      next: (response) => {
        this.password = '';
        this.toast.success(response.message);
      },
      error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('recovery.errors.resetPassword'))),
    });
  }
}
