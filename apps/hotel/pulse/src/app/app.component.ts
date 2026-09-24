import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from './api.service';
import { Feedback } from './models';

/**
 * One page, driven by the token in the URL path — no router (there is
 * nowhere else to go, same call as check-in). The guest's emailed link is
 * `https://<this hostname>/<token>`; `nginx.conf`'s SPA fallback serves this
 * bundle for any path, and the token is read straight from
 * `location.pathname` below.
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

  readonly stars = [1, 2, 3, 4, 5];

  token = '';
  feedback: Feedback | null = null;
  /** questionId -> answer, string for both a rating ("1"-"5") and free text. */
  answers: Record<string, string> = {};

  loading = true;
  saving = false;
  saved = false;
  error = '';

  ngOnInit(): void {
    this.token = location.pathname.replace(/^\/+/, '');
    if (!this.token) {
      this.loading = false;
      this.error = 'This link is missing its feedback code.';
      return;
    }
    this.api.get(this.token).subscribe({
      next: (feedback) => this.applyFeedback(feedback),
      error: (err) => this.fail(err),
    });
  }

  rate(questionId: string, value: number): void {
    this.answers[questionId] = String(value);
  }

  submit(): void {
    this.saving = true;
    this.saved = false;
    this.error = '';
    // hotel-core's `int()` util only accepts a real JSON number for a
    // `rating` question, not the numeric string a text input would give a
    // free-text one — so the cast has to happen per question, not once.
    const responses = (this.feedback?.questions ?? [])
      .map((q) => ({ q, raw: this.answers[q.id] }))
      .filter(({ raw }) => raw !== undefined && raw.trim() !== '')
      .map(({ q, raw }) => ({
        questionId: q.id,
        answer: q.type === 'rating' ? Number(raw) : raw,
      }));
    this.api.submit(this.token, responses).subscribe({
      next: (feedback) => {
        this.applyFeedback(feedback);
        this.saving = false;
        this.saved = true;
      },
      error: (err) => {
        this.saving = false;
        this.fail(err);
      },
    });
  }

  private applyFeedback(feedback: Feedback): void {
    this.feedback = feedback;
    this.answers = Object.fromEntries(
      feedback.questions.filter((q) => q.answer !== null).map((q) => [q.id, q.answer as string])
    );
    this.loading = false;
  }

  private fail(err: HttpErrorResponse): void {
    this.loading = false;
    if (err.status === 404) {
      this.error = 'This feedback link is no longer valid.';
    } else {
      this.error = 'Something went wrong. Please try again in a moment.';
    }
  }
}
