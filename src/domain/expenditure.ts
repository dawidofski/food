import { lastNDayKeys } from '@/domain/dayBoundary';
import { MIN_LOGGED_DAYS } from '@/domain/trends';
import type { HealthDay } from '@/types/health';

/** How many days, ending yesterday, the reported burn is averaged over. */
export const WINDOW_DAYS = 7;

/**
 * The app's own choice and not a published figure: a whole-day burn above this is not a real day, so it is left out of the
 * average rather than pulling someone's energy target up.
 *
 * Nothing the person can keep is ever dropped here, because `DayHealthForm` REFUSES a figure above this ceiling outright
 * instead of offering to keep it. Its own "check for an extra digit" flag sits lower and only asks for a second look, so
 * everything it lets through is averaged. This guard is therefore for a figure that never passed the form at all — a
 * hand-edited backup, say.
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
  /**
   * Whole kcal: the mean of the usable days, and the only figure that may be handed to `computeTargets`. ABSENT, never
   * zero, when fewer than `MIN_LOGGED_DAYS` of the window's days carry a figure: the formula is used then, and `days`
   * still says how many have arrived, so a screen can say how far off the switch-over is.
   */
  kcal?: number;
  /** How many of the window's days carried a usable figure, whether or not that reached the minimum. */
  days: number;
};

/**
 * The person's own energy burn, as the mean whole-day figure over the last 7 days ending YESTERDAY, rounded to a whole
 * kcal, with the number of days it was taken over. Today is left out because the day is not over and its figure would be a partial.
 *
 * A day with no burn figure is absent, not zero: it is skipped, never averaged in (a day with only steps would otherwise
 * lower the energy target). Below `MIN_LOGGED_DAYS` usable days there is no `kcal` at all, so the formula is used; the
 * day count is still reported, because a feature that silently collects for three days reads as broken. Undefined only
 * when `on` is not a real date, which is a programming error rather than a state of the data.
 */
export function reportedExpenditureOver(days: HealthDay[], on: Date): ReportedExpenditure | undefined {
  if (!Number.isFinite(on.getTime())) return undefined;
  const window = new Set(reportedWindowKeys(on));
  const byDate = new Map<string, number>();
  for (const d of days) {
    const v = usableBurn(d);
    if (v !== undefined && window.has(d.date)) byDate.set(d.date, v);
  }
  if (byDate.size < MIN_LOGGED_DAYS) return { days: byDate.size };
  let sum = 0;
  for (const v of byDate.values()) sum += v;
  return { kcal: Math.round(sum / byDate.size), days: byDate.size };
}

/** Just the figure; see `reportedExpenditureOver`. */
export function reportedExpenditure(days: HealthDay[], on: Date): number | undefined {
  return reportedExpenditureOver(days, on)?.kcal;
}
