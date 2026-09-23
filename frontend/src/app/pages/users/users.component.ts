import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { extractErrorMessage } from '../../core/api';
import { AuthService } from '../../core/auth.service';
import { AdminUser, AppAccessOption, Role } from '../../core/models';
import { ALL_CAPABILITIES, Capability } from '../../core/capabilities';
import { OperationsService } from '../../core/operations.service';
import { SettingsService } from '../../core/settings.service';
import { ConfirmService } from '../../core/confirm.service';
import { ToastService } from '../../core/toast.service';
import { PanelComponent } from '../../components/panel/panel.component';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { TranslateService } from '../../i18n/translate.service';

const ALL_ROLES: Role[] = ['webmaster', 'admin', 'user'];

function allCapsRecord(on: boolean): Record<Capability, boolean> {
  return ALL_CAPABILITIES.reduce(
    (acc, cap) => ({ ...acc, [cap]: on }),
    {} as Record<Capability, boolean>
  );
}

function capsRecord(caps: readonly string[] | undefined): Record<Capability, boolean> {
  return ALL_CAPABILITIES.reduce(
    (acc, cap) => ({ ...acc, [cap]: (caps ?? []).includes(cap) }),
    {} as Record<Capability, boolean>
  );
}

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, RouterLink, PanelComponent, TranslatePipe],
  templateUrl: './users.component.html',
  styleUrl: './users.component.css'
})
export class UsersComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly operations = inject(OperationsService);
  private readonly settings = inject(SettingsService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  protected readonly translate = inject(TranslateService);

  protected readonly allRoles = ALL_ROLES;
  protected readonly allCapabilities = ALL_CAPABILITIES;

  protected readonly createForm = this.formBuilder.nonNullable.group({
    username: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(64)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(255)]],
  });
  // The new account is invited by email (§158) — creation needs a working
  // mailbox. Null until the check resolves.
  protected mailConfigured: boolean | null = null;
  protected resendingId: number | null = null;
  // Roles for the create form, kept outside the reactive group so the
  // checkboxes bind with plain ngModel. At least one is required (§149).
  protected newRoles: Record<Role, boolean> = { webmaster: false, admin: true, user: false };
  // Feature grants for a new admin (§152b). Shown only when Admin is picked
  // and Webmaster is not; starts all-on (which equals "no grant rows").
  protected newCaps: Record<Capability, boolean> = allCapsRecord(true);
  // App access for the create form (§151/2b, §480) — a checkbox per
  // grantable app, all off by default (an explicit allowlist). Covers both
  // Authelia-gated apps and the no-SSO apps that mirror the user's real
  // credentials instead (currently just DocuSeal).
  protected newAppAccess: Record<string, boolean> = {};
  // Filters the visible grid only — never touches newAppAccess/accessApps,
  // so a filtered-out app stays checked or unchecked as it was.
  protected newAppFilter = '';
  protected accessAppFilter = '';

  // The grantable apps — exposed + Authelia-protected, or exposed + a
  // no-SSO credential-fanout provisioner (§480) — loaded once.
  protected appOptions: AppAccessOption[] = [];

  protected items: AdminUser[] = [];
  protected loading = false;
  protected creating = false;
  protected currentUserId: number | null = null;

  // Per-user role edit state: a working copy of the checkboxes, and which row
  // is currently saving.
  protected roleDraft: Record<number, Record<Role, boolean>> = {};
  protected savingRolesId: number | null = null;

  // Per-user Features edit state — populated for admin rows only (§152b).
  protected capDraft: Record<number, Record<Capability, boolean>> = {};
  protected savingCapsId: number | null = null;

  // Per-user Access edit state (§151/2b) — an expanded row, like password reset.
  protected accessEditId: number | null = null;
  protected accessEmail = '';
  protected accessApps: Record<string, boolean> = {};
  protected savingAccess = false;

  protected resetPasswordId: number | null = null;
  protected resetPasswordValue = '';
  protected resetting = false;

  ngOnInit(): void {
    this.auth.user$.subscribe((user) => (this.currentUserId = user?.id ?? null));
    this.load();
    this.settings.getMailSettings().subscribe({
      next: (mail) => (this.mailConfigured = mail.configured),
      error: () => (this.mailConfigured = false),
    });
    this.operations.listAppAccessOptions().subscribe({
      next: (response) => {
        this.appOptions = response.items;
        for (const option of this.appOptions) {
          this.newAppAccess[option.serviceName] ??= false;
        }
      },
      // A soft failure — the picker just stays empty, user creation still works.
      error: () => (this.appOptions = []),
    });
  }

  load(): void {
    this.loading = true;
    this.operations.listUsers().subscribe({
      next: (response) => {
        this.items = response.items;
        this.roleDraft = {};
        this.capDraft = {};
        for (const user of this.items) {
          this.roleDraft[user.id] = this.toRecord(user.roles);
          if (this.showFeatures(user)) {
            this.capDraft[user.id] = capsRecord(user.capabilities);
          }
        }
        this.loading = false;
      },
      error: (error) => {
        this.loading = false;
        this.toast.error(extractErrorMessage(error, this.translate.t('users.errors.load')));
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

  private selectedCaps(record: Record<Capability, boolean>): Capability[] {
    return ALL_CAPABILITIES.filter((cap) => record[cap]);
  }

  /** The create form needs a feature set only for an admin that isn't also a webmaster. */
  protected newCapsShown(): boolean {
    return this.newRoles.admin && !this.newRoles.webmaster;
  }

  protected newCapsValid(): boolean {
    return !this.newCapsShown() || this.selectedCaps(this.newCaps).length > 0;
  }

  /** A row gets the Features editor when it is an admin and not a webmaster. */
  protected showFeatures(user: AdminUser): boolean {
    return user.roles.includes('admin') && !user.roles.includes('webmaster');
  }

  protected capsDirty(user: AdminUser): boolean {
    const draft = this.capDraft[user.id];
    if (!draft) {
      return false;
    }
    const now = this.selectedCaps(draft).sort().join(',');
    return now !== [...(user.capabilities ?? [])].sort().join(',');
  }

  private pickedApps(record: Record<string, boolean>): string[] {
    return this.appOptions.map((o) => o.serviceName).filter((name) => record[name]);
  }

  protected pickedAppCount(record: Record<string, boolean>): number {
    return this.pickedApps(record).length;
  }

  protected setAllApps(record: Record<string, boolean>, value: boolean): void {
    for (const option of this.appOptions) {
      record[option.serviceName] = value;
    }
  }

  protected filterAppOptions(filter: string): AppAccessOption[] {
    const q = filter.trim().toLowerCase();
    if (!q) return this.appOptions;
    return this.appOptions.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.hostname ?? '').toLowerCase().includes(q)
    );
  }

  createUser(): void {
    if (this.createForm.invalid || !this.newRolesValid() || !this.newCapsValid()) {
      this.createForm.markAllAsTouched();
      if (!this.newRolesValid()) {
        this.toast.error(this.translate.t('users.validation.pickRole'));
      } else if (!this.newCapsValid()) {
        this.toast.error(this.translate.t('users.validation.needFeature'));
      }
      return;
    }

    const { username, email } = this.createForm.getRawValue();
    // Only send a feature set for an admin-not-webmaster; the backend ignores
    // it otherwise, and an all-on set is equivalent to sending none.
    const caps = this.newCapsShown() ? this.selectedCaps(this.newCaps) : undefined;
    const appAccess = this.pickedApps(this.newAppAccess);
    this.creating = true;
    this.operations
      .createUser(username, email.trim(), this.selected(this.newRoles), {
        capabilities: caps,
        appAccess: appAccess.length ? appAccess : undefined,
      })
      .pipe(finalize(() => (this.creating = false)))
      .subscribe({
        next: (response) => {
          if (response.warning) {
            this.toast.error(response.warning);
          } else {
            this.toast.success(this.translate.t('users.toast.inviteSent', { email: email.trim() }));
          }
          this.createForm.reset();
          this.newRoles = { webmaster: false, admin: true, user: false };
          this.newCaps = allCapsRecord(true);
          this.newAppAccess = {};
          this.newAppFilter = '';
          this.load();
        },
        error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('users.errors.create'))),
      });
  }

  protected resendInvite(user: AdminUser): void {
    this.resendingId = user.id;
    this.operations
      .resendInvite(user.id)
      .pipe(finalize(() => (this.resendingId = null)))
      .subscribe({
        next: (response) =>
          response.warning
            ? this.toast.error(response.warning)
            : this.toast.success(this.translate.t('users.toast.inviteResent', { username: user.username })),
        error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('users.errors.resendInvite'))),
      });
  }

  // --- Per-row Access editor (email + app-access list) ---

  protected startAccessEdit(user: AdminUser): void {
    this.accessEditId = user.id;
    this.accessEmail = user.email ?? '';
    this.accessApps = {};
    this.accessAppFilter = '';
    for (const option of this.appOptions) {
      this.accessApps[option.serviceName] = (user.appAccess ?? []).includes(option.serviceName);
    }
  }

  protected cancelAccessEdit(): void {
    this.accessEditId = null;
    this.accessEmail = '';
    this.accessApps = {};
    this.accessAppFilter = '';
  }

  private emailLooksValid(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  }

  protected submitAccessEdit(): void {
    if (this.accessEditId === null) {
      return;
    }
    if (!this.emailLooksValid(this.accessEmail)) {
      this.toast.error(this.translate.t('users.validation.validEmail'));
      return;
    }
    this.savingAccess = true;
    this.operations
      .updateUserAccess(this.accessEditId, this.accessEmail.trim(), this.pickedApps(this.accessApps))
      .pipe(finalize(() => (this.savingAccess = false)))
      .subscribe({
        next: () => {
          this.toast.success(this.translate.t('users.toast.accessUpdated'));
          this.cancelAccessEdit();
          this.load();
        },
        error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('users.errors.updateAccess'))),
      });
  }

  saveRoles(user: AdminUser): void {
    const roles = this.selected(this.roleDraft[user.id]);
    if (roles.length === 0) {
      this.toast.error(this.translate.t('users.validation.keepRole'));
      return;
    }
    this.savingRolesId = user.id;
    this.operations
      .updateUserRoles(user.id, roles)
      .pipe(finalize(() => (this.savingRolesId = null)))
      .subscribe({
        next: () => {
          this.toast.success(this.translate.t('users.toast.rolesUpdated', { username: user.username }));
          this.load();
        },
        error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('users.errors.updateRoles'))),
      });
  }

  saveCaps(user: AdminUser): void {
    const caps = this.selectedCaps(this.capDraft[user.id] ?? {});
    if (caps.length === 0) {
      this.toast.error(this.translate.t('users.validation.keepFeature'));
      return;
    }
    this.savingCapsId = user.id;
    this.operations
      .updateUserCapabilities(user.id, caps)
      .pipe(finalize(() => (this.savingCapsId = null)))
      .subscribe({
        next: () => {
          this.toast.success(this.translate.t('users.toast.featuresUpdated', { username: user.username }));
          this.load();
        },
        error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('users.errors.updateFeatures'))),
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
      this.toast.error(this.translate.t('users.validation.passwordLength'));
      return;
    }

    this.resetting = true;
    this.operations
      .updateUserPassword(this.resetPasswordId, this.resetPasswordValue)
      .pipe(finalize(() => (this.resetting = false)))
      .subscribe({
        next: () => {
          this.toast.success(this.translate.t('users.toast.passwordUpdated'));
          this.cancelPasswordReset();
        },
        error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('users.errors.updatePassword'))),
      });
  }

  deleteUser(user: AdminUser): void {
    void this.confirm
      .ask({
        title: this.translate.t('users.confirmDelete.title'),
        message: this.translate.t('users.confirmDelete.message', { username: user.username }),
        confirmText: this.translate.t('users.confirmDelete.confirmText'),
        danger: true,
      })
      .then((confirmed) => {
        if (!confirmed) {
          return;
        }
        this.operations.deleteUser(user.id).subscribe({
          next: () => {
            this.toast.success(this.translate.t('users.toast.userDeleted'));
            this.load();
          },
          error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('users.errors.deleteUser'))),
        });
      });
  }
}
