import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { extractErrorMessage } from '../../core/api';
import { AuthService } from '../../core/auth.service';
import { AdminUser, Role } from '../../core/models';
import { ROLE_LABELS } from '../../core/capabilities';
import { OperationsService } from '../../core/operations.service';
import { ConfirmService } from '../../core/confirm.service';
import { ToastService } from '../../core/toast.service';
import { PanelComponent } from '../../components/panel/panel.component';

const ALL_ROLES: Role[] = ['webmaster', 'admin', 'user'];

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, PanelComponent],
  templateUrl: './users.component.html',
  styleUrl: './users.component.css'
})
export class UsersComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly operations = inject(OperationsService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  protected readonly allRoles = ALL_ROLES;
  protected readonly roleLabel = ROLE_LABELS;

  protected readonly createForm = this.formBuilder.nonNullable.group({
    username: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(64)]],
    password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128)]],
  });
  // Roles for the create form, kept outside the reactive group so the
  // checkboxes bind with plain ngModel. At least one is required (§149).
  protected newRoles: Record<Role, boolean> = { webmaster: false, admin: true, user: false };
  // §152b adds the per-admin Features editor here; 152a keeps the role
  // checkboxes only.

  protected items: AdminUser[] = [];
  protected loading = false;
  protected creating = false;
  protected currentUserId: number | null = null;

  // Per-user role edit state: a working copy of the checkboxes, and which row
  // is currently saving.
  protected roleDraft: Record<number, Record<Role, boolean>> = {};
  protected savingRolesId: number | null = null;

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
        this.roleDraft = {};
        for (const user of this.items) {
          this.roleDraft[user.id] = this.toRecord(user.roles);
        }
        this.loading = false;
      },
      error: (error) => {
        this.loading = false;
        this.toast.error(extractErrorMessage(error, 'Unable to load users.'));
      },
    });
  }

  private toRecord(roles: Role[]): Record<Role, boolean> {
    return {
      webmaster: roles.includes('webmaster'),
      admin: roles.includes('admin'),
      user: roles.includes('user'),
    };
  }

  private selected(record: Record<Role, boolean>): Role[] {
    return ALL_ROLES.filter((role) => record[role]);
  }

  protected newRolesValid(): boolean {
    return this.selected(this.newRoles).length > 0;
  }

  protected rolesDirty(user: AdminUser): boolean {
    const draft = this.selected(this.roleDraft[user.id] ?? this.toRecord(user.roles)).sort().join(',');
    return draft !== [...user.roles].sort().join(',');
  }

  createUser(): void {
    if (this.createForm.invalid || !this.newRolesValid()) {
      this.createForm.markAllAsTouched();
      if (!this.newRolesValid()) {
        this.toast.error('Pick at least one role for the new account.');
      }
      return;
    }

    const { username, password } = this.createForm.getRawValue();
    this.creating = true;
    this.operations
      .createUser(username, password, this.selected(this.newRoles))
      .pipe(finalize(() => (this.creating = false)))
      .subscribe({
        next: () => {
          this.toast.success('User created successfully.');
          this.createForm.reset();
          this.newRoles = { webmaster: false, admin: true, user: false };
          this.load();
        },
        error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to create user.')),
      });
  }

  saveRoles(user: AdminUser): void {
    const roles = this.selected(this.roleDraft[user.id]);
    if (roles.length === 0) {
      this.toast.error('An account must keep at least one role.');
      return;
    }
    this.savingRolesId = user.id;
    this.operations
      .updateUserRoles(user.id, roles)
      .pipe(finalize(() => (this.savingRolesId = null)))
      .subscribe({
        next: () => {
          this.toast.success(`Roles updated for ${user.username}.`);
          this.load();
        },
        error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to update roles.')),
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
    void this.confirm
      .ask({
        title: 'Delete user',
        message: `Delete user "${user.username}"?\nThis cannot be undone.`,
        confirmText: 'Delete',
        danger: true,
      })
      .then((confirmed) => {
        if (!confirmed) {
          return;
        }
        this.operations.deleteUser(user.id).subscribe({
          next: () => {
            this.toast.success('User deleted successfully.');
            this.load();
          },
          error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to delete user.')),
        });
      });
  }
}
