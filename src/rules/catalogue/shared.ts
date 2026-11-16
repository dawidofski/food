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

/** Whole-number display with thousands separators, e.g. 1240 -> "1,240". */
export function whole(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
