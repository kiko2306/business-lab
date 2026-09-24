import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from './api.service';
import { AGE_GROUPS, Checkin, CheckinExtra, CheckinGuest, DOCUMENT_TYPES, emptyExtra, emptyGuest } from './models';

/**
 * One page, driven by the token in the URL path — no router (there is
 * nowhere else to go, same call as hotel-admin). The guest's emailed link is
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

  readonly documentTypes = DOCUMENT_TYPES;
  readonly ageGroups = AGE_GROUPS;

  token = '';
  checkin: Checkin | null = null;
  guest: CheckinGuest = emptyGuest();
  extras: CheckinExtra[] = [];

  loading = true;
  saving = false;
  saved = false;
  error = '';

  ngOnInit(): void {
    this.token = location.pathname.replace(/^\/+/, '');
    if (!this.token) {
      this.loading = false;
      this.error = 'This link is missing its check-in code.';
      return;
    }
    this.api.get(this.token).subscribe({
      next: (checkin) => this.applyCheckin(checkin),
      error: (err) => this.fail(err),
    });
  }

  submit(): void {
    this.saving = true;
    this.saved = false;
    this.error = '';
    this.api.submit(this.token, this.guest, this.extras).subscribe({
      next: (checkin) => {
        this.applyCheckin(checkin);
        this.saving = false;
        this.saved = true;
      },
      error: (err) => {
        this.saving = false;
        this.fail(err);
      },
    });
  }

  /** Slots come from the reservation's own occupant count, not the guest —
   *  the primary guest fills one adult slot, the rest are `extras` forms. */
  private applyCheckin(checkin: Checkin): void {
    this.checkin = checkin;
    this.guest = checkin.guest ?? emptyGuest();
    const slots = Math.max(
      0,
      checkin.occupants.adults + checkin.occupants.children + checkin.occupants.babies - 1
    );
    this.extras = Array.from({ length: slots }, (_, i) => checkin.extras[i] ?? emptyExtra());
    this.loading = false;
  }

  private fail(err: HttpErrorResponse): void {
    this.loading = false;
    if (err.status === 404) {
      this.error = 'This check-in link is no longer valid.';
    } else if (err.status === 409) {
      this.error = err.error?.error ?? 'This reservation is not ready for check-in yet.';
    } else {
      this.error = 'Something went wrong. Please try again in a moment.';
    }
  }
}
