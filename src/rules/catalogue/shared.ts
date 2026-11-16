import { isKnownValue } from '@/domain/nutrients';
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
