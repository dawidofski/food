import { lastNDayKeys } from '@/domain/dayBoundary';
import { MIN_LOGGED_DAYS } from '@/domain/trends';
import type { HealthDay } from '@/types/health';

/** How many days, ending yesterday, the reported burn is averaged over. */
export const WINDOW_DAYS = 7;

/**
 * The app's own choice and not a published figure: a whole-day burn above this is not a real day, so it is left out of the
 * average rather than pulling someone's energy target up. It is deliberately well above the form's "check for an extra
 * digit" flag (`BURN_IMPLAUSIBLY_HIGH_KCAL`, guarded by a test), which only asks for a second look and lets the person keep a figure; this one is for a figure no
 * day produces, such as a hand-edited backup, which skips the form.
 */
export const REPORTED_BURN_CEILING_KCAL = 20000;

function usableBurn(day: HealthDay): number | undefined {
  const v = day.energyBurnedKcal;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= REPORTED_BURN_CEILING_KCAL ? v : undefined;
}



/** The day keys the reported burn is read from: the 7 days ending YESTERDAY, oldest first. The store is read over exactly these. */
export function reportedWindowKeys(on: Date): string[] {
  const yesterday = new Date(on.getFullYear(), on.getMonth(), on.getDate() - 1, 12);
  return lastNDayKeys(yesterday, WINDOW_DAYS);
}

export type ReportedExpenditure = {
  /** Whole kcal: the mean of the usable days. This is the only figure that may be handed to `computeTargets`. */
  kcal: number;
  /** How many of the window's days carried a usable figure, so a screen can say what the mean was taken over. */
  days: number;
};

/**
 * The person's own energy burn, as the mean whole-day figure over the last 7 days ending YESTERDAY, rounded to a whole
 * kcal, with the number of days it was taken over. Today is left out because the day is not over and its figure would be a partial.
 *
 * A day with no burn figure is absent, not zero: it is skipped, never averaged in (a day with only steps would otherwise
 * lower the energy target). Undefined when fewer than `MIN_LOGGED_DAYS` days carry a usable figure, so the formula is used.
 */
export function reportedExpenditureOver(days: HealthDay[], on: Date): ReportedExpenditure | undefined {
  if (!Number.isFinite(on.getTime())) return undefined;
  const window = new Set(reportedWindowKeys(on));
  const byDate = new Map<string, number>();
  for (const d of days) {
    const v = usableBurn(d);
    if (v !== undefined && window.has(d.date)) byDate.set(d.date, v);
  }
  if (byDate.size < MIN_LOGGED_DAYS) return undefined;
  let sum = 0;
  for (const v of byDate.values()) sum += v;
  return { kcal: Math.round(sum / byDate.size), days: byDate.size };
}

/** Just the figure; see `reportedExpenditureOver`. */
export function reportedExpenditure(days: HealthDay[], on: Date): number | undefined {
  return reportedExpenditureOver(days, on)?.kcal;
}
