import { NgClass } from '@angular/common';
import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';
import { HealthSummary, summarizeHealth } from '../../core/health-summary';
import { HealthStatus } from '../../core/models';
import { OperationsService } from '../../core/operations.service';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { TranslateService } from '../../i18n/translate.service';

/**
 * How the box is doing, in sentences and bars, on Home (plan.md §841). It
 * replaces the Utils page's four lines of text: state is a word beside every
 * bar, so colour is never the only signal, and the last good read stays up if
 * a later poll fails (the header strip behaves the same way).
 */
@Component({
    selector: 'app-health-summary',
    imports: [NgClass, TranslatePipe],
    templateUrl: './health-summary.component.html',
    styleUrl: './health-summary.component.css'
})
export class HealthSummaryComponent implements OnInit {
  private readonly operations = inject(OperationsService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly translate = inject(TranslateService);

  protected health: HealthStatus | null = null;
  /** Only the first read can fail visibly — afterwards the last good one stays. */
  protected failed = false;

  ngOnInit(): void {
    this.load();
    interval(30_000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load());
  }

  protected load(): void {
    this.operations.getHealth().subscribe({
      next: (health) => {
        this.health = health;
        this.failed = false;
      },
      error: () => {
        this.failed = this.health === null;
      },
    });
  }

  private summaryCache?: { health: HealthStatus; locale: string; summary: HealthSummary };

  // A getter so it follows the active language, but memoised on (read, language):
  // a fresh object per call made `@if (summary; as s)` trip NG0100 in dev mode,
  // since the alias is re-evaluated by the check-no-changes pass (Angular 21).
  protected get summary(): HealthSummary | null {
    if (!this.health) return null;
    const locale = this.translate.locale();
    if (this.summaryCache?.health !== this.health || this.summaryCache.locale !== locale) {
      const summary = summarizeHealth(this.health, (key, params) => this.translate.t(key, params));
      this.summaryCache = { health: this.health, locale, summary };
    }
    return this.summaryCache.summary;
  }

  protected get checkedAt(): string {
    return new Date(this.health?.timestamp ?? 0).toLocaleTimeString(this.translate.locale(), { hour: '2-digit', minute: '2-digit' });
  }

  protected barClass(ok: boolean): string {
    return ok ? 'bg-success' : 'bg-danger';
  }
}
