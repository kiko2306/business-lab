import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from './api.service';
import { AgentStatus, EnrolmentCode, FLOWS, FlowKey, Identity, Unit } from './models';

/**
 * One page: the properties, who may see them, and the agent. No router —
 * there is nowhere else to go, and a route only earns its place when there is.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  private api = inject(ApiService);

  readonly flows = FLOWS;

  identity: Identity | null = null;
  units: Unit[] = [];
  agent: AgentStatus | null = null;
  loading = true;
  error = '';

  openId: string | null = null;
  access: string[] = [];
  newIdentity = '';

  /**
   * Held in memory only: the API returns a code once and stores its hash
   * (plan.md §638), so there is nothing to re-fetch.
   */
  issued: EnrolmentCode | null = null;
  copied = false;

  get isAdmin(): boolean {
    return this.identity?.isAdmin === true;
  }

  ngOnInit(): void {
    this.api.me().subscribe({
      next: (identity) => {
        this.identity = identity;
        // Only an admin can read the agent's status, so asking as a viewer
        // would just log a 403 for something they cannot act on anyway.
        if (identity.isAdmin) this.loadAgent();
      },
      error: (err) => this.fail(err),
    });
    this.load();
  }

  load(): void {
    this.api.listUnits().subscribe({
      next: (units) => {
        this.units = units;
        this.loading = false;
      },
      error: (err) => this.fail(err),
    });
  }

  private loadAgent(): void {
    this.api.agent().subscribe({
      next: (agent) => (this.agent = agent),
      error: () => undefined,
    });
  }

  toggleFlow(unit: Unit, flow: FlowKey): void {
    this.api.setFlow(unit.id, flow, !unit[flow]).subscribe({
      next: (updated) => Object.assign(unit, updated),
      error: (err) => this.fail(err),
    });
  }

  toggleActive(unit: Unit): void {
    this.api.setActive(unit.id, !unit.isActive).subscribe({
      next: (updated) => Object.assign(unit, updated),
      error: (err) => this.fail(err),
    });
  }

  toggleOpen(unit: Unit): void {
    if (this.openId === unit.id) {
      this.openId = null;
      return;
    }
    this.openId = unit.id;
    this.access = [];
    this.api.listAccess(unit.id).subscribe({
      next: (access) => (this.access = access),
      error: (err) => this.fail(err),
    });
  }

  grant(unit: Unit): void {
    const identity = this.newIdentity.trim();
    if (!identity) return;
    this.api.grantAccess(unit.id, identity).subscribe({
      next: () => {
        this.newIdentity = '';
        this.toggleOpen(unit);
        this.toggleOpen(unit);
      },
      error: (err) => this.fail(err),
    });
  }

  revoke(unit: Unit, identity: string): void {
    this.api.revokeAccess(unit.id, identity).subscribe({
      next: () => (this.access = this.access.filter((a) => a !== identity)),
      error: (err) => this.fail(err),
    });
  }

  issueCode(): void {
    this.error = '';
    this.copied = false;
    this.api.issueEnrolmentCode().subscribe({
      next: (code) => (this.issued = code),
      error: (err) => this.fail(err),
    });
  }

  async copyCode(): Promise<void> {
    if (!this.issued) return;
    try {
      await navigator.clipboard.writeText(this.issued.code);
      this.copied = true;
    } catch {
      // Clipboard access needs a secure context and a gesture; the code is on
      // screen to read either way, so this is not worth an error.
      this.copied = false;
    }
  }

  revokeAgent(): void {
    if (!confirm('Revoke the property agent? It stops syncing on its next call.')) return;
    this.api.revokeAgent().subscribe({
      next: () => {
        this.issued = null;
        this.loadAgent();
      },
      error: (err) => this.fail(err),
    });
  }

  private fail(err: HttpErrorResponse): void {
    this.loading = false;
    if (err.status === 401) {
      // The Authelia session lapsed: a reload goes back through the gate.
      // Guarded, because if the identity headers are missing entirely — a
      // proxy misconfiguration rather than an expiry — it would loop for ever.
      if (!sessionStorage.getItem('hotel-reauth')) {
        sessionStorage.setItem('hotel-reauth', '1');
        location.reload();
        return;
      }
      this.error = 'Not signed in, and reloading did not help. The proxy may not be forwarding identity headers.';
      return;
    }
    sessionStorage.removeItem('hotel-reauth');
    this.error = err.error?.error ?? `Request failed (${err.status})`;
  }
}
