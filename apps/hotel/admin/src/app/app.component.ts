import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from './api.service';
import {
  AgentStatus,
  Checkout,
  EnrolmentCode,
  FLOWS,
  FlowKey,
  GUEST_TEXT_GROUPS,
  GuestTextTemplate,
  Identity,
  Question,
  SmtpSettings,
  Unit,
} from './models';

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

  // Set before first paint by theme-init.js: saved choice, else the OS preference.
  theme = signal(document.documentElement.getAttribute('data-bs-theme') ?? 'dark');

  toggleTheme(): void {
    const next = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(next);
    document.documentElement.setAttribute('data-bs-theme', next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      // Blocked storage: the choice applies to this page only.
    }
  }

  readonly flows = FLOWS;
  readonly guestTextGroups = GUEST_TEXT_GROUPS;

  identity: Identity | null = null;
  units: Unit[] = [];
  agent: AgentStatus | null = null;
  loading = true;
  error = '';

  questions: Question[] = [];
  newQuestionText = '';
  newQuestionType: Question['type'] = 'rating';

  smtp: SmtpSettings | null = null;
  smtpForm = { host: '', port: 587, encryption: 'tls' as SmtpSettings['encryption'], username: '', password: '', fromAddress: '', fromName: '', alertEmail: '' };
  savingSmtp = false;
  testingSmtp = false;
  smtpFeedback = '';
  smtpTestResult: { success: boolean; message: string } | null = null;

  guestText: GuestTextTemplate[] = [];

  checkouts: Checkout[] = [];

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
        // Only an admin can read the agent's status or the questions, so
        // asking as a viewer would just log a 403 for something they cannot
        // act on anyway.
        if (identity.isAdmin) {
          this.loadAgent();
          this.loadQuestions();
          this.loadSmtp();
          this.loadGuestText();
          this.loadCheckouts();
        }
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

  /** Blurring a changed offset field patches it; an unchanged one is left alone. */
  setOffset(unit: Unit, key: 'checkinOffsetDays' | 'quizOffsetDays', value: string): void {
    const days = Number(value);
    if (!Number.isInteger(days) || days < 0 || days > 60 || days === unit[key]) return;
    this.api.setOffset(unit.id, key, days).subscribe({
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

  toggleCheckoutActive(unit: Unit): void {
    this.api.setCheckoutActive(unit.id, !unit.checkoutActive).subscribe({
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

  private loadQuestions(): void {
    this.api.listQuestions().subscribe({
      next: (questions) => (this.questions = questions),
      error: (err) => this.fail(err),
    });
  }

  addQuestion(): void {
    const value = this.newQuestionText.trim();
    if (!value) return;
    this.api.createQuestion(value, this.newQuestionType).subscribe({
      next: (question) => {
        this.questions.push(question);
        this.newQuestionText = '';
      },
      error: (err) => this.fail(err),
    });
  }

  saveQuestionText(question: Question, value: string): void {
    const trimmed = value.trim();
    if (!trimmed || trimmed === question.text) return;
    this.api.updateQuestion(question.id, { text: trimmed }).subscribe({
      next: (updated) => Object.assign(question, updated),
      error: (err) => this.fail(err),
    });
  }

  setQuestionType(question: Question, type: Question['type']): void {
    this.api.updateQuestion(question.id, { type }).subscribe({
      next: (updated) => Object.assign(question, updated),
      error: (err) => this.fail(err),
    });
  }

  toggleQuestionActive(question: Question): void {
    this.api.updateQuestion(question.id, { isActive: !question.isActive }).subscribe({
      next: (updated) => Object.assign(question, updated),
      error: (err) => this.fail(err),
    });
  }

  /**
   * Order swaps with a neighbour rather than a typed number: two PATCH calls
   * against the already-known adjacent sortOrder, no separate move endpoint.
   */
  moveQuestion(question: Question, direction: -1 | 1): void {
    const index = this.questions.indexOf(question);
    const neighbour = this.questions[index + direction];
    if (!neighbour) return;
    const [a, b] = [question.sortOrder, neighbour.sortOrder];
    this.api.updateQuestion(question.id, { sortOrder: b }).subscribe({
      next: (updated) => Object.assign(question, updated),
      error: (err) => this.fail(err),
    });
    this.api.updateQuestion(neighbour.id, { sortOrder: a }).subscribe({
      next: (updated) => {
        Object.assign(neighbour, updated);
        this.questions.sort((x, y) => x.sortOrder - y.sortOrder);
      },
      error: (err) => this.fail(err),
    });
  }

  private loadSmtp(): void {
    this.api.getSmtp().subscribe({
      next: (smtp) => {
        this.smtp = smtp;
        // The password never comes back from the server, so the field is
        // left blank — typing something is how it gets changed.
        this.smtpForm = { ...smtp, password: '' };
      },
      error: (err) => this.fail(err),
    });
  }

  saveSmtp(): void {
    this.savingSmtp = true;
    this.smtpFeedback = '';
    this.smtpTestResult = null;
    const body = { ...this.smtpForm, password: this.smtpForm.password || undefined };
    this.api.saveSmtp(body).subscribe({
      next: (smtp) => {
        this.smtp = smtp;
        this.smtpForm = { ...smtp, password: '' };
        this.savingSmtp = false;
        this.smtpFeedback = 'Saved.';
      },
      error: (err) => {
        this.savingSmtp = false;
        this.fail(err);
      },
    });
  }

  testSmtp(): void {
    this.testingSmtp = true;
    this.smtpTestResult = null;
    this.api.testSmtp().subscribe({
      next: (result) => {
        this.testingSmtp = false;
        this.smtpTestResult = result;
      },
      error: (err: HttpErrorResponse) => {
        this.testingSmtp = false;
        this.smtpTestResult = err.error ?? { success: false, message: `Request failed (${err.status})` };
      },
    });
  }

  private loadGuestText(): void {
    this.api.listGuestText().subscribe({
      next: (templates) => (this.guestText = templates),
      error: (err) => this.fail(err),
    });
  }

  guestTextValue(key: string, locale: 'en' | 'pt-pt'): string {
    return this.guestText.find((t) => t.key === key && t.locale === locale)?.value ?? '';
  }

  saveGuestTextValue(key: string, locale: 'en' | 'pt-pt', value: string): void {
    const trimmed = value.trim();
    if (!trimmed) return;
    const existing = this.guestText.find((t) => t.key === key && t.locale === locale);
    if (existing && trimmed === existing.value) return;
    this.api.saveGuestText(key, locale, trimmed).subscribe({
      next: (updated) => {
        if (existing) Object.assign(existing, updated);
        else this.guestText.push(updated);
      },
      error: (err) => this.fail(err),
    });
  }

  private loadCheckouts(): void {
    this.api.listCheckouts().subscribe({
      next: (checkouts) => (this.checkouts = checkouts),
      error: (err) => this.fail(err),
    });
  }

  /** Blank `entityCodeInput` bills the reservation's own guest — checkout.ts's default. */
  settleCheckout(checkout: Checkout, entityCodeInput: string): void {
    this.api.settleCheckout(checkout.id, entityCodeInput.trim()).subscribe({
      next: () => (this.checkouts = this.checkouts.filter((c) => c.id !== checkout.id)),
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
