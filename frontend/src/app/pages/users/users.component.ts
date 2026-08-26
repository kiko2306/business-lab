import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { extractErrorMessage } from '../../core/api';
import { AuthService } from '../../core/auth.service';
import { AdminUser } from '../../core/models';
import { OperationsService } from '../../core/operations.service';
import { ToastService } from '../../core/toast.service';

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, RouterLink],
  templateUrl: './users.component.html',
  styleUrl: './users.component.css'
})
export class UsersComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly operations = inject(OperationsService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  protected readonly createForm = this.formBuilder.nonNullable.group({
    username: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(64)]],
    password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128)]],
  });

  protected items: AdminUser[] = [];
  protected loading = false;
  protected creating = false;
  protected currentUserId: number | null = null;

  protected resetPasswordId: number | null = null;
  protected resetPasswordValue = '';
  protected resetting = false;

  ngOnInit(): void {
    this.auth.user$.subscribe((user) => (this.currentUserId = user?.id ?? null));
    this.load();
  }

  load(): void {
    this.loading = true;
    this.operations.listUsers().subscribe({
      next: (response) => {
        this.items = response.items;
        this.loading = false;
      },
      error: (error) => {
        this.loading = false;
        this.toast.error(extractErrorMessage(error, 'Unable to load users.'));
      },
    });
  }

  createUser(): void {
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }

    const { username, password } = this.createForm.getRawValue();
    this.creating = true;
    this.operations
      .createUser(username, password)
      .pipe(finalize(() => (this.creating = false)))
      .subscribe({
        next: () => {
          this.toast.success('User created successfully.');
          this.createForm.reset();
          this.load();
        },
        error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to create user.')),
      });
  }

  startPasswordReset(id: number): void {
    this.resetPasswordId = id;
    this.resetPasswordValue = '';
  }

  cancelPasswordReset(): void {
    this.resetPasswordId = null;
    this.resetPasswordValue = '';
  }

  submitPasswordReset(): void {
    if (this.resetPasswordId === null || this.resetPasswordValue.length < 8) {
      this.toast.error('Password must be at least 8 characters.');
      return;
    }

    this.resetting = true;
    this.operations
      .updateUserPassword(this.resetPasswordId, this.resetPasswordValue)
      .pipe(finalize(() => (this.resetting = false)))
      .subscribe({
        next: () => {
          this.toast.success('Password updated successfully.');
          this.cancelPasswordReset();
        },
        error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to update password.')),
      });
  }

  deleteUser(user: AdminUser): void {
    if (!confirm(`Delete user "${user.username}"? This cannot be undone.`)) {
      return;
    }

    this.operations.deleteUser(user.id).subscribe({
      next: () => {
        this.toast.success('User deleted successfully.');
        this.load();
      },
      error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to delete user.')),
    });
  }
}
