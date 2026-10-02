import { Overview } from '../models';
import { comparableTotal, comparisonDate, describeComparison } from './comparison';

const overview = (invoiced: number, hourly: { hour: number; total: number }[] = []): Overview =>
  ({
    asOf: '',
    totals: { invoiced, open: 0 },
    tables: { free: 0, occupied: 0, awaitingPayment: 0 },
    clients: { present: 0 },
    staff: [],
    payments: [],
    hourly,
  }) as Overview;

describe('comparisonDate', () => {
  // A shop owner compares Saturdays, not dates: the useful reference is the
  // same weekday a week back, not yesterday.
  it('steps back exactly seven days', () => {
    expect(comparisonDate('2026-10-03')).toBe('2026-09-26');
  });

  it('crosses a month boundary', () => {
    expect(comparisonDate('2026-10-02')).toBe('2026-09-25');
  });

  it('crosses a year boundary', () => {
    expect(comparisonDate('2026-01-03')).toBe('2025-12-27');
  });

  it('is null for a day it cannot read', () => {
    expect(comparisonDate(undefined)).toBeNull();
    expect(comparisonDate('')).toBeNull();
    expect(comparisonDate('not-a-day')).toBeNull();
  });
});

describe('comparableTotal', () => {
  const lastWeek = overview(900, [
    { hour: 8, total: 100 },
    { hour: 9, total: 150 },
    { hour: 10, total: 250 },
    { hour: 18, total: 400 },
  ]);

  // The real trap: a running day's takings so far against last week's *whole*
  // day reads as a collapse at 10am. Compare like for like in time.
  it('counts only the hours already reached, for a day still running', () => {
    expect(comparableTotal(lastWeek, 10)).toBe(500);
  });

  it('counts the whole day when no hour limit applies', () => {
    expect(comparableTotal(lastWeek, null)).toBe(900);
  });

  it('is null when the reference day has no hourly breakdown to cut', () => {
    expect(comparableTotal(overview(900), 10)).toBeNull();
  });

  it('still answers for the whole day without an hourly breakdown', () => {
    expect(comparableTotal(overview(900), null)).toBe(900);
  });
});

describe('describeComparison', () => {
  const saturday = '2026-10-03';

  it('says how much better, in words', () => {
    expect(describeComparison(1200, 800, saturday, 'en')).toEqual({
      direction: 'up',
      text: '€400.00 more than last Saturday',
    });
  });

  it('says how much worse, in words', () => {
    expect(describeComparison(800, 1200, saturday, 'en')).toEqual({
      direction: 'down',
      text: '€400.00 less than last Saturday',
    });
  });

  it('says level rather than inventing a difference', () => {
    expect(describeComparison(1000, 1000, saturday, 'en')!.direction).toBe('level');
  });

  // Rounding, not exactness: two cents apart is the same day's takings.
  it('treats a sub-cent difference as level', () => {
    expect(describeComparison(1000.001, 1000, saturday, 'en')!.direction).toBe('level');
  });

  it('says plainly when there is nothing to compare against', () => {
    expect(describeComparison(1200, null, saturday, 'en')).toEqual({
      direction: 'none',
      text: 'No figures for last Saturday',
    });
  });

  it('is nothing at all when the day itself is unknown', () => {
    expect(describeComparison(1200, 800, null, 'en')).toBeNull();
  });

  it('names the weekday in the reader’s language', () => {
    expect(describeComparison(1200, 800, saturday, 'pt-PT')!.text).toContain('sábado');
  });
});

// A running day's figure is cut to the hours already complete, so the sentence
// says by when — otherwise "€212 less than last Saturday" at 11:30 reads as a
// whole-day verdict (plan.md §806.7), and "by this hour" promised more precision
// than a cut at the last sale delivered (§806.8).
describe('describeComparison on a running day', () => {
  const saturday = '2026-10-03';

  it('names the hour it compares up to', () => {
    expect(describeComparison(1200, 800, saturday, 'en', 14)!.text).toBe('€400.00 more than last Saturday by 14:00');
    expect(describeComparison(800, 1200, saturday, 'en', 9)!.text).toBe('€400.00 less than last Saturday by 09:00');
    expect(describeComparison(1000, 1000, saturday, 'en', 14)!.text).toBe('The same as last Saturday by 14:00');
  });

  it('says nothing extra for a closed day, which is compared whole', () => {
    expect(describeComparison(1200, 800, saturday, 'en', null)!.text).toBe('€400.00 more than last Saturday');
  });

  it('does not claim an hour when there is nothing to compare', () => {
    expect(describeComparison(1200, null, saturday, 'en', 14)!.text).toBe('No figures for last Saturday');
  });
});

// A reference day that was shut is "no figures", not "€0": the whole-day path
// used to compare a €1,240 day against nothing and call it "€1,240 more than
// last Saturday" (plan.md §810).
describe('comparableTotal for a shut reference day', () => {
  const shut = overview(0, []);

  it('is null for a whole-day comparison against a day with no takings and no hours', () => {
    expect(comparableTotal(shut, null)).toBeNull();
  });

  it('still answers a genuine €0 day that had trading hours', () => {
    expect(comparableTotal(overview(0, [{ hour: 9, total: 0 }]), null)).toBe(0);
  });
});
