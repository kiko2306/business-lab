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

/** A real calendar day as yyyy-MM-dd. Round-trips rather than trusting Date.parse, which rolls 2026-02-30 forward to 2 March. */
export function isRealDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

/** yyyy-MM-dd in the *local* zone — the shop's wall-clock day, not UTC's. */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
