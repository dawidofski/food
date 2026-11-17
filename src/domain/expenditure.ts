import { lastNDayKeys } from '@/domain/dayBoundary';
import { MIN_LOGGED_DAYS } from '@/domain/trends';
import type { HealthDay } from '@/types/health';

/** How many days, ending yesterday, the reported burn is averaged over. */
const WINDOW_DAYS = 7;

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

/**
 * The person's own energy burn, as the mean whole-day figure over the last 7 days ending YESTERDAY, rounded to a whole
 * kcal. Today is left out because the day is not over and its figure would be a partial.
 *
 * A day with no burn figure is absent, not zero: it is skipped, never averaged in (a day with only steps would otherwise
 * lower the energy target). Undefined when fewer than `MIN_LOGGED_DAYS` days carry a usable figure, so the formula is used.
 */
export function reportedExpenditure(days: HealthDay[], on: Date): number | undefined {
  if (!Number.isFinite(on.getTime())) return undefined;
  const yesterday = new Date(on.getFullYear(), on.getMonth(), on.getDate() - 1, 12);
  const window = new Set(lastNDayKeys(yesterday, WINDOW_DAYS));
  const byDate = new Map<string, number>();
  for (const d of days) {
    const v = usableBurn(d);
    if (v !== undefined && window.has(d.date)) byDate.set(d.date, v);
  }
  if (byDate.size < MIN_LOGGED_DAYS) return undefined;
  let sum = 0;
  for (const v of byDate.values()) sum += v;
  return Math.round(sum / byDate.size);
}
