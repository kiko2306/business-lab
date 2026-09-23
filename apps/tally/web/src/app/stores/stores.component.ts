import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../api.service';
import { EnrolmentCode, Store } from '../models';

@Component({
  selector: 'app-stores',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './stores.component.html',
  styleUrl: './stores.component.css',
})
export class StoresComponent implements OnInit {
  private api = inject(ApiService);

  stores: Store[] = [];
  loading = true;
  error = '';

  newName = '';
  creating = false;

  /** The expanded store's id, or null. One open at a time keeps the page short. */
  openId: string | null = null;
  access: string[] = [];
  accessLoading = false;
  newIdentity = '';

  /**
   * The issued code, held in memory only. The API returns it once and stores
   * only its hash (plan.md §631), so there is nothing to re-fetch — losing it
   * means issuing another. The UI has to say so.
   */
  issued: { storeId: string; code: EnrolmentCode } | null = null;
  copied = false;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.api.listStores().subscribe({
      next: (stores) => {
        this.stores = stores;
        this.loading = false;
      },
      error: (err) => this.fail(err),
    });
  }

  create(): void {
    const name = this.newName.trim();
    if (!name || this.creating) return;
    this.creating = true;
    this.error = '';
    this.api.createStore(name).subscribe({
      next: () => {
        this.newName = '';
        this.creating = false;
        this.load();
      },
      error: (err) => {
        this.creating = false;
        this.fail(err);
      },
    });
  }

  rename(store: Store): void {
    const name = prompt('New name', store.name)?.trim();
    if (!name || name === store.name) return;
    this.api.updateStore(store.id, { name }).subscribe({
      next: () => this.load(),
      error: (err) => this.fail(err),
    });
  }

  toggleActive(store: Store): void {
    this.api.updateStore(store.id, { isActive: !store.isActive }).subscribe({
      next: () => this.load(),
      error: (err) => this.fail(err),
    });
  }

  remove(store: Store): void {
    // Deleting cascades to the store's access grants and its agent, so say so
    // rather than letting it be a surprise.
    if (!confirm(`Delete "${store.name}"? Its access grants and enrolled agent go with it.`)) return;
    this.api.deleteStore(store.id).subscribe({
      next: () => {
        if (this.openId === store.id) this.openId = null;
        this.load();
      },
      error: (err) => this.fail(err),
    });
  }

  toggleOpen(store: Store): void {
    if (this.openId === store.id) {
      this.openId = null;
      return;
    }
    this.openId = store.id;
    this.issued = null;
    this.loadAccess(store.id);
  }

  private loadAccess(id: string): void {
    this.accessLoading = true;
    this.api.listAccess(id).subscribe({
      next: (access) => {
        this.access = access;
        this.accessLoading = false;
      },
      error: (err) => {
        this.accessLoading = false;
        this.fail(err);
      },
    });
  }

  grant(store: Store): void {
    const identity = this.newIdentity.trim();
    if (!identity) return;
    this.api.grantAccess(store.id, identity).subscribe({
      next: () => {
        this.newIdentity = '';
        this.loadAccess(store.id);
      },
      error: (err) => this.fail(err),
    });
  }

  revoke(store: Store, identity: string): void {
    this.api.revokeAccess(store.id, identity).subscribe({
      next: () => this.loadAccess(store.id),
      error: (err) => this.fail(err),
    });
  }

  issueCode(store: Store): void {
    this.error = '';
    this.copied = false;
    this.api.issueEnrolmentCode(store.id).subscribe({
      next: (code) => (this.issued = { storeId: store.id, code }),
      error: (err) => this.fail(err),
    });
  }

  async copyCode(): Promise<void> {
    if (!this.issued) return;
    try {
      await navigator.clipboard.writeText(this.issued.code.code);
      this.copied = true;
    } catch {
      // Clipboard access needs a secure context and a user gesture; if it is
      // refused the code is still on screen to read, so this is not an error
      // worth interrupting anyone for.
      this.copied = false;
    }
  }

  revokeAgent(store: Store): void {
    if (!confirm(`Revoke the agent for "${store.name}"? It stops reporting on its next call.`)) return;
    this.api.revokeAgent(store.id).subscribe({
      next: () => this.load(),
      error: (err) => this.fail(err),
    });
  }

  private fail(err: HttpErrorResponse): void {
    this.loading = false;
    // 401 means the Authelia session lapsed — a reload goes back through the
    // gate rather than leaving a dead page with a confusing message.
    if (err.status === 401) {
      location.reload();
      return;
    }
    this.error = err.error?.error ?? `Request failed (${err.status})`;
  }
}
