import type { DatasetFood } from '@/types/food';
import type { ParsedItem } from '@/domain/parseEntry';

export const TINY_GRAMS = 5;
export const HUGE_GRAMS = 1000;
/** Below this share of the food's largest listed portion, a defaulted pick is suspect. */
export const SMALL_SHARE = 0.2;

export type UnusualServing = { kind: 'tiny' | 'huge' | 'small-share'; largestPortionGrams?: number };

/**
 * A bare count ("a meat pie", "2 hot dogs") resolves to a portion chosen by a ranking heuristic, and about a tenth of
 * the dataset yields a pick under 5 g, over 1 kg, or under 20% of that food's largest portion. Those picks are shown
 * to the user as a question rather than a silent figure. Only DEFAULTED servings are checked: a weight or unit the
 * person typed ("3 g salt", "2 tbsp oil") is their own statement and is not second-guessed.
 */
export function unusualServing(item: ParsedItem, grams: number, food: DatasetFood | undefined): UnusualServing | null {
  const q = item.quantity;
  if (q.grams !== undefined || q.unitLabel !== undefined) return null;
  if (!Number.isFinite(grams) || grams <= 0) return null;
  if (grams < TINY_GRAMS) return { kind: 'tiny' };
  if (grams > HUGE_GRAMS) return { kind: 'huge' };
  const largest = Math.max(0, ...(food?.portions ?? []).map((p) => (Number.isFinite(p.grams) ? p.grams : 0)));
  if (largest > 0 && grams < SMALL_SHARE * largest) return { kind: 'small-share', largestPortionGrams: largest };
  return null;
}
