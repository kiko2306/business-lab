import { Overview } from '../models';
import { currency, t } from '../i18n';

/**
 * "Is today good?" — the question the shop day view never answered.
 *
 * An absolute figure only answers it for someone already holding last week's
 * number in their head, which is work the screen can do instead (plan.md §806,
 * from the critique's P1). The reference is the **same weekday a week back**,
 * because a shop compares Saturdays to Saturdays, not to Fridays.
 */

export type ComparisonDirection = 'up' | 'down' | 'level' | 'none';

export interface Comparison {
  direction: ComparisonDirection;
  text: string;
}

/** The same weekday a week earlier, or null when the day is unreadable. */
export function comparisonDate(businessDate: string | undefined | null): string | null {
  if (!businessDate || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    return null;
  }
  const day = new Date(`${businessDate}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) {
    return null;
  }
  day.setUTCDate(day.getUTCDate() - 7);
  return day.toISOString().slice(0, 10);
}

/**
 * What to compare the reference day against.
 *
 * `uptoHour` is the trap this function exists for: at 10am a running day's
 * takings are a few hours old, and holding them up against last week's *whole*
 * day reads as a collapse. Given an hour, only the hours already reached count,
 * so both sides describe the same stretch of the day. A closed day passes null
 * and is compared whole.
 *
 * Returns null when the reference day cannot be cut to the hour — an older
 * agent sends no hourly breakdown, and a day with no breakdown cannot honestly
 * answer "by this time last week".
 */
export function comparableTotal(reference: Overview | null, uptoHour: number | null): number | null {
  if (!reference) {
    return null;
  }
  if (uptoHour === null) {
    // A day with no takings and no trading hours was shut, not a €0 day: the
    // whole-day path used to call that "€1,240 more than last Saturday".
    if (reference.totals.invoiced === 0 && !(reference.hourly ?? []).length) {
      return null;
    }
    return reference.totals.invoiced;
  }
  if (!reference.hourly?.length) {
    return null;
  }
  return reference.hourly.filter((h) => h.hour <= uptoHour).reduce((sum, h) => sum + h.total, 0);
}

/**
 * One sentence, in words, with the direction available separately so the arrow
 * reinforces the text rather than carrying it (colour and glyph alone are not
 * a message — see the dashboard's meaning-only colour rule).
 */
export function describeComparison(
  today: number,
  reference: number | null,
  referenceDate: string | null,
  locale: string,
  /**
   * For a running day, the hour both sides were cut to ("by 14:00" = every
   * hour before it, complete). Null for a closed day, which is compared whole.
   * Saying the hour matters: at 11:30 "€212 less than last Saturday" reads as a
   * whole-day verdict, which is the reading the cut exists to avoid.
   */
  byHour: number | null = null
): Comparison | null {
  if (!referenceDate) {
    return null;
  }
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(`${referenceDate}T00:00:00Z`)
  );
  if (reference === null) {
    return { direction: 'none', text: t('No figures for last {weekday}', { weekday }) };
  }

  const money = (value: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
  const hour = byHour === null ? '' : String(byHour).padStart(2, '0');
  const difference = today - reference;
  // Money, so a cent is the smallest difference worth a word; anything under
  // that is the same takings arrived at by a different rounding path.
  if (Math.abs(difference) < 0.01) {
    return {
      direction: 'level',
      text: t(byHour === null ? 'The same as last {weekday}' : 'The same as last {weekday} by {hour}:00', { weekday, hour }),
    };
  }
  // Whole translated sentences per case, not a suffix: the Portuguese puts the
  // weekday inside "da semana passada" so it needs no gender agreement, which
  // "segunda-feira passado" got wrong for Monday to Friday.
  const up = difference > 0;
  const key = up
    ? byHour === null ? '{amount} more than last {weekday}' : '{amount} more than last {weekday} by {hour}:00'
    : byHour === null ? '{amount} less than last {weekday}' : '{amount} less than last {weekday} by {hour}:00';
  return { direction: up ? 'up' : 'down', text: t(key, { amount: money(Math.abs(difference)), weekday, hour }) };
}
