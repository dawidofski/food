import { isKnownValue } from '@/domain/nutrients';
import { PATTERN_WINDOW_DAYS, type PatternNutrient } from '@/domain/totals';
import { MIN_LOGGED_DAYS } from '@/domain/trends';
import type { NutrientKey } from '@/types/nutrients';
import type { Context } from '../types';

/** A usable reference figure: finite and above zero. Anything else means the rule has nothing to compare with. */
export function usable(n: number | undefined): n is number {
  return isKnownValue(n) && n > 0;
}

/** The pending entry's value, or null when unknown. Absent is never read as zero. */
export function pending(ctx: Context, key: NutrientKey): number | null {
  const v = ctx.pending.nutrients[key];
  return isKnownValue(v) ? v : null;
}

/**
 * Today's committed total plus the pending entry, with no extrapolation. A day with no entries has nothing to add, so
 * the projection is the pending entry alone; a day WITH entries but an unknown total is unknown, not zero.
 */
export function projectedDay(ctx: Context, key: NutrientKey): number | null {
  const p = pending(ctx, key);
  if (p === null) return null;
  if (ctx.today.entryCount === 0) return p;
  const t = ctx.today.nutrients[key];
  return isKnownValue(t) ? t + p : null;
}

/**
 * Grams of the pending entry's items whose OWN classification carries the flag. A mixed dish counts only its flagged
 * items, so a chicken-and-beef dish contributes the beef alone. Unknown or non-finite grams count as nothing.
 */
export function pendingGramsOf(ctx: Context, flag: 'processedMeat' | 'redMeat' | 'sweetDrink'): number {
  let total = 0;
  for (const r of ctx.pending.refs) {
    if (r.classification[flag] && isKnownValue(r.grams) && r.grams > 0) total += r.grams;
  }
  return total;
}

/** A week count that can be trusted: finite and not negative. Anything else reads as unknown. */
export function weekCount(n: number): number | null {
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Whole-number display with thousands separators, e.g. 1240 -> "1,240". */
export function whole(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

// ---------- frequency notes (spec G3: whether a concern is about occasional or habitual consumption) ----------
//
// A frequency note states the APP'S OWN COUNT of what the diary holds. It introduces no threshold: no source in this
// project gives a number of days or occasions a week at which anything changes for sodium, added sugar, saturated fat,
// sweetened drinks or ultra-processed food, so no note may imply one. A note never reaches `level`.

/** A count in words where a bare 0 would read oddly mid-sentence. Factual either way: a zero is a count, not praise. */
function tally(n: number): string {
  return n === 0 ? 'none' : String(n);
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * The six days BEFORE today, for a nutrient: how many had a complete figure, and how many of those were above
 * `figure`. Today is excluded — the card already states today, and today is still being logged.
 * Null when fewer than `MIN_LOGGED_DAYS` of the six can be vouched for: a count over two days says nothing, and a
 * day whose figure is a floor is absent from the window rather than counted as a day under the figure.
 */
export function daysBeforeToday(
  ctx: Context,
  key: PatternNutrient,
  figure: number,
): { complete: number; above: number } | null {
  const values = ctx.week.completeDayTotalsBeforeToday?.[key] ?? [];
  if (!Array.isArray(values) || values.length < MIN_LOGGED_DAYS) return null;
  return { complete: values.length, above: values.filter((v) => isKnownValue(v) && v > figure).length };
}

/** "Of the 6 days before today, 5 had complete sodium data and 4 of those were above 2,000 mg." */
export function daysBeforeTodayNote(d: { complete: number; above: number }, label: string, figure: string): string {
  return (
    `Of the ${PATTERN_WINDOW_DAYS} days before today, ${d.complete} had complete ${label} data and ` +
    `${tally(d.above)} of those were above ${figure}.`
  );
}

/**
 * Occasions over the seven-day window, with the pending entry counted in it: the committed count plus this one.
 * Null when fewer than `MIN_LOGGED_DAYS` days of the window were logged — "3 in 7 days" is misleading when only three
 * days were logged at all — or when either count cannot be trusted.
 */
export function occasionsWithThisEntry(ctx: Context, occasions: number): { total: number; loggedDays: number } | null {
  const before = weekCount(occasions);
  const logged = weekCount(ctx.week.loggedDays);
  if (before === null || logged === null || logged < MIN_LOGGED_DAYS) return null;
  return { total: before + 1, loggedDays: logged };
}

/**
 * "Counting this entry, sugar-sweetened drinks appear in 3 entries in the last 7 days, over 5 days with entries."
 * `phrase` carries its own verb, so a mass noun ("NOVA group 4 food appears") reads as well as a plural one.
 */
export function occasionsNote(o: { total: number; loggedDays: number }, phrase: string): string {
  return (
    `Counting this entry, ${phrase} in ${plural(o.total, 'entry', 'entries')} in the last 7 days, ` +
    `over ${plural(o.loggedDays, 'day', 'days')} with entries.`
  );
}
