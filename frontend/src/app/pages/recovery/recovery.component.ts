import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { extractErrorMessage } from '../../core/api';
import { OperationsService } from '../../core/operations.service';
import { ToastService } from '../../core/toast.service';

@Component({
  selector: 'app-recovery',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './recovery.component.html',
  styleUrl: './recovery.component.css'
})
export class RecoveryComponent implements OnInit {
  private readonly operations = inject(OperationsService);
  private readonly toast = inject(ToastService);

  protected enabled = false;
  protected username = '';
  protected password = '';

  ngOnInit(): void {
    this.loadStatus();
  }

  loadStatus(): void {
    this.operations.getRecoveryStatus().subscribe({
      next: (response) => (this.enabled = response.enabled),
      error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to load recovery status.')),
    });
  }

  enable(): void {
    this.operations.enableRecoveryMode().subscribe({
      next: (response) => {
        this.enabled = response.enabled;
        this.toast.success(response.message);
      },
      error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to enable recovery mode.')),
    });
  }

  disable(): void {
    this.operations.disableRecoveryMode().subscribe({
      next: (response) => {
        this.enabled = response.enabled;
        this.toast.success(response.message);
      },
      error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to disable recovery mode.')),
    });
  }

  resetPassword(): void {
    this.operations.resetAdminPassword(this.username, this.password).subscribe({
      next: (response) => {
        this.password = '';
        this.toast.success(response.message);
      },
      error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to reset password.')),
    });
  }
}
