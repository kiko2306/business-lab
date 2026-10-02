import { Injectable } from '@angular/core';

/**
 * The browser's clock, behind a seam. The shop view reasons about "now" — is
 * the agent's business day today's calendar day, and which hours of it are
 * complete — and a spec that depends on the machine's real date cannot assert
 * any of it. Specs provide a fixed one.
 */
@Injectable({ providedIn: 'root' })
export class Clock {
  now(): Date {
    return new Date();
  }
}

/** yyyy-MM-dd in the *local* zone — the shop's wall-clock day, not UTC's. */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
