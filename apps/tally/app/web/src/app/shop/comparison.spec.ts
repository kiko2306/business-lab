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

// A running day's figure is cut to the hour already reached, so the sentence
// has to say "by this hour" — otherwise an owner reading "€212 less than last
// Saturday" at 11:30 takes it as a whole-day verdict, which is exactly the
// reading the cut exists to avoid (plan.md §806.7).
describe('describeComparison on a running day', () => {
  const saturday = '2026-10-03';

  it('says it is by this hour when the day is still running', () => {
    expect(describeComparison(1200, 800, saturday, 'en', true)!.text).toBe('€400.00 more than last Saturday by this hour');
    expect(describeComparison(800, 1200, saturday, 'en', true)!.text).toBe('€400.00 less than last Saturday by this hour');
    expect(describeComparison(1000, 1000, saturday, 'en', true)!.text).toBe('The same as last Saturday by this hour');
  });

  it('says nothing extra for a closed day, which is compared whole', () => {
    expect(describeComparison(1200, 800, saturday, 'en', false)!.text).toBe('€400.00 more than last Saturday');
  });

  it('does not claim an hour when there is nothing to compare', () => {
    expect(describeComparison(1200, null, saturday, 'en', true)!.text).toBe('No figures for last Saturday');
  });
});
