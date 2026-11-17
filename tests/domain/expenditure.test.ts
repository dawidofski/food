import { describe, expect, test } from 'vitest';
import { REPORTED_BURN_CEILING_KCAL, reportedExpenditure } from '@/domain/expenditure';
import { MIN_LOGGED_DAYS } from '@/domain/trends';
import { BURN_IMPLAUSIBLY_HIGH_KCAL } from '@/ui/components/DayHealthForm';
import type { HealthDay } from '@/types/health';

// Local noon on 17 November 2026; yesterday is the 16th and the window is 10 to 16 November.
const ON = new Date(2026, 10, 17, 12);
const day = (date: string, energyBurnedKcal?: number, steps?: number): HealthDay => ({
  date,
  ...(energyBurnedKcal === undefined ? {} : { energyBurnedKcal }),
  ...(steps === undefined ? {} : { steps }),
});

describe('reportedExpenditure', () => {
  // Review Focus 1: the most damaging failure this feature has.
  test('a day with steps but no burn figure is ignored, never counted as zero', () => {
    const days = [
      day('2026-11-10', 2600), day('2026-11-11', 2600), day('2026-11-12', 2600),
      day('2026-11-13', 2600), day('2026-11-14', 2600), day('2026-11-15', undefined, 9000),
    ];
    expect(reportedExpenditure(days, ON)).toBe(2600); // a zero would give 2167
  });

  test('fewer than the minimum days gives undefined, so the formula is still used', () => {
    const days = Array.from({ length: MIN_LOGGED_DAYS - 1 }, (_, i) => day(`2026-11-1${i}`, 2600));
    expect(reportedExpenditure(days, ON)).toBeUndefined();
    expect(reportedExpenditure([...days, day('2026-11-14', 2600)], ON)).toBe(2600);
    expect(reportedExpenditure([], ON)).toBeUndefined();
  });

  test('days with only steps do not count towards the minimum', () => {
    const days = [day('2026-11-10', 2600), day('2026-11-11', 2600), day('2026-11-12', 2600), day('2026-11-13', undefined, 5000)];
    expect(reportedExpenditure(days, ON)).toBeUndefined();
  });

  test('today is excluded, because the day is not over', () => {
    const days = [day('2026-11-13', 2000), day('2026-11-14', 2000), day('2026-11-15', 2000), day('2026-11-16', 2000), day('2026-11-17', 900)];
    expect(reportedExpenditure(days, ON)).toBe(2000);
    // Today alone never makes a figure.
    expect(reportedExpenditure([day('2026-11-17', 2000)], ON)).toBeUndefined();
  });

  test('the mean is taken over the days that have a figure, oldest to yesterday', () => {
    const days = [
      day('2026-11-09', 9999), // before the window
      day('2026-11-10', 2000), day('2026-11-12', 2400), day('2026-11-14', 2800), day('2026-11-16', 3000),
    ];
    expect(reportedExpenditure(days, ON)).toBe(2550);
  });

  test('the mean is rounded to a whole kcal', () => {
    const days = [day('2026-11-13', 2000), day('2026-11-14', 2000), day('2026-11-15', 2000), day('2026-11-16', 2001)];
    expect(reportedExpenditure(days, ON)).toBe(2000);
  });

  test('a figure that is not a positive finite number is ignored, not averaged in', () => {
    const base = [day('2026-11-12', 2600), day('2026-11-13', 2600), day('2026-11-14', 2600), day('2026-11-15', 2600)];
    for (const bad of [0, -500, NaN, Infinity, 1e308, REPORTED_BURN_CEILING_KCAL + 1]) {
      expect(reportedExpenditure([...base, day('2026-11-16', bad)], ON)).toBe(2600);
    }
    // Four good days are still needed once a bad one is dropped.
    expect(reportedExpenditure([...base.slice(0, 3), day('2026-11-16', 1e308)], ON)).toBeUndefined();
  });

  test('a figure exactly at the ceiling is kept', () => {
    const days = [10, 11, 12, 13].map((d) => day(`2026-11-${d}`, REPORTED_BURN_CEILING_KCAL));
    expect(reportedExpenditure(days, ON)).toBe(REPORTED_BURN_CEILING_KCAL);
  });
});

// The domain must not import from ui/, so the order of the two thresholds is enforced here. The form flags a figure above
// its threshold but lets the person keep it; if the ceiling here fell to or below that threshold, a figure the form invited
// them to keep would be silently dropped from their energy target.
test('the domain ceiling stays above the form flag, so a kept figure is never silently dropped', () => {
  expect(REPORTED_BURN_CEILING_KCAL).toBeGreaterThan(BURN_IMPLAUSIBLY_HIGH_KCAL);
});
