import type { FoodLookup } from '@/domain/foodLookup';
import { mergeClassification, sumNutrients } from '@/domain/nutrients';
import { resolveKnownFood } from '@/domain/resolveItems';
import type { DiaryEntry, FoodRef, Resolution } from '@/types/diary';

/** A meal the person named, so they can log it again without typing it out. */
export type SavedMeal = {
  id: string;
  /** Their own word for it. */
  name: string;
  /**
   * Which foods the meal was made of, from which provider, at what weight — and nothing else.
   *
   * The foods themselves are NOT copied. This is the whole point: a name pointing at foods, not a snapshot of
   * their figures. Everything about each food is read again when the meal is logged — its per-100 g table, its
   * classification, its FPED cup-equivalents — so the figures keep the source they always had, a correction to
   * a food reaches every meal that uses it, and a food that has since gone is reported rather than silently
   * becoming a zero. The weights are the only thing this remembers, because the weights are what the person
   * chose.
   */
  refs: FoodRef[];
  /** ISO datetime it was saved. */
  savedAt: string;
};

/** Below this there is nothing to log. */
const MIN_GRAMS = 0;

/**
 * A meal built from something already logged.
 *
 * Returns undefined unless every one of the entry's foods can be replayed — each needs a real, positive
 * weight. A meal that is only partly replayable is refused whole rather than saved as a quietly smaller
 * version of what the person logged.
 */
export function mealFromEntry(entry: DiaryEntry, name: string, id: string, savedAt: string): SavedMeal | undefined {
  const trimmed = name.trim().slice(0, 80);
  if (trimmed === '') return undefined;
  const refs = entry.items.filter((r) => Number.isFinite(r.grams) && r.grams > MIN_GRAMS);
  if (refs.length === 0 || refs.length !== entry.items.length) return undefined;
  return { id, name: trimmed, refs: refs.map((r) => ({ ...r })), savedAt };
}

/** Nothing can be logged from this. */
const NOTHING: Resolution = {
  refs: [],
  nutrients: {},
  coverage: {},
  classification: mergeClassification([]),
  needsHelp: [],
  confidence: 0,
};

export type MealReplay = {
  /** What logging the meal would add — empty whenever any part of it could not be replayed. */
  resolution: Resolution;
  /**
   * The foods that cannot be replayed now: deleted, or at a weight the app will not accept.
   *
   * When this is non-empty the resolution is empty, so a caller cannot log a short meal even by ignoring it.
   * No name is available for a food that has been deleted — the name lived on the food, not here — so a
   * screen can report how many are gone, not which.
   */
  missing: FoodRef[];
};

/**
 * Work the meal out again, from the foods as they are today.
 *
 * Nothing here trusts a stored figure, and nothing trusts a stored flag either: each ref is rebuilt by
 * `resolveKnownFood` from the food as it stands now, which is the one place a FoodRef is made from a food. So
 * a food whose energy you corrected, or that you have since marked as processed meat, reaches this meal — the
 * numbers, the safety rules and the veg and whole-grain progress all follow the food, not the day the meal was
 * named. `sumNutrients` then marks coverage honestly across the parts.
 *
 * **A meal is logged whole or not at all.** If any food cannot be replayed, this returns an empty resolution
 * and reports it. Logging the rest would write an entry whose coverage says `known` for a meal that is short a
 * food — understating the day while looking complete, which is the failure this app is built against.
 */
export function replaySavedMeal(meal: SavedMeal, lookup: FoodLookup): MealReplay {
  const parts: Resolution[] = [];
  const missing: FoodRef[] = [];
  for (const ref of meal.refs) {
    const food = lookup.get(ref.source, ref.foodId);
    if (!food) {
      missing.push(ref);
      continue;
    }
    // Rebuilt, not reused: this re-reads the food's classification and rescales its FPED, and refuses a weight
    // that is no longer usable, exactly as a scanned food goes in.
    const one = resolveKnownFood(ref.source, food, ref.grams, ref.portionLabel);
    if (one.refs.length === 0) {
      missing.push(ref);
      continue;
    }
    parts.push(one);
  }
  if (missing.length > 0 || parts.length === 0) return { resolution: NOTHING, missing };
  const { total, coverage } = sumNutrients(parts.map((p) => p.nutrients));
  return {
    resolution: {
      refs: parts.flatMap((p) => p.refs),
      nutrients: total,
      coverage,
      classification: mergeClassification(parts.map((p) => p.classification)),
      needsHelp: [],
      confidence: 1,
    },
    missing,
  };
}

/**
 * The text the diary keeps for a logged meal: the foods and their weights, the same shape the barcode path
 * records (`200 g Rice, cooked, NFS`).
 *
 * Not the meal's name. `rawText` is what reproduces the entry, and it is what "Log again" re-reads — a row
 * reading "my usual rice" would send the words "my usual rice" back through the search and could log one
 * unrelated portion of rice instead of the meal.
 */
export function mealEntryText(refs: FoodRef[], lookup: FoodLookup): string {
  return refs
    .map((r) => {
      const food = lookup.get(r.source, r.foodId);
      return `${Math.round(r.grams)} g ${food?.name ?? 'food'}`;
    })
    .join(' and ');
}
