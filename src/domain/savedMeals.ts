import type { FoodLookup } from '@/domain/foodLookup';
import { mergeClassification, scalePer100g, sumNutrients } from '@/domain/nutrients';
import type { DiaryEntry, FoodRef, Resolution } from '@/types/diary';

/** A meal the person named, so they can log it again without typing it out. */
export type SavedMeal = {
  id: string;
  /** Their own word for it. */
  name: string;
  /**
   * Exactly what the meal was made of, as it was logged: which food, from which provider, at what weight.
   *
   * The foods themselves are NOT copied. This is the whole point: a name pointing at foods, not a snapshot of
   * their figures. Every figure is looked up again when the meal is logged, so it keeps the source it always
   * had, its allergens are live rather than frozen, nothing is rounded on the way in or out, and a food that
   * has since gone can be reported instead of silently becoming a zero.
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
 * Returns undefined when the entry has nothing loggable behind it — no refs, or a weight that is not a real
 * number — because a meal that cannot be replayed is worse than no meal.
 */
export function mealFromEntry(entry: DiaryEntry, name: string, id: string, savedAt: string): SavedMeal | undefined {
  const trimmed = name.trim().slice(0, 80);
  if (trimmed === '') return undefined;
  const refs = entry.items.filter((r) => Number.isFinite(r.grams) && r.grams > MIN_GRAMS);
  if (refs.length === 0 || refs.length !== entry.items.length) return undefined;
  return { id, name: trimmed, refs: refs.map((r) => ({ ...r })), savedAt };
}

export type MealReplay = {
  resolution: Resolution;
  /** The foods that could not be found now. Named so the screen can say which, rather than quietly dropping them. */
  missing: FoodRef[];
};

/**
 * Work the meal out again, from the foods as they are today.
 *
 * Nothing here trusts a stored figure: each ref's food is looked up and its own per-100 g table is scaled by
 * the weight that was logged, exactly as `resolveKnownFood` does for one food. So the figures carry the source
 * they always had, and `sumNutrients` marks coverage honestly across the parts.
 *
 * A food that cannot be found is **reported, not skipped**. Skipping it would quietly log a smaller meal than
 * the person asked for — the same understating-while-looking-complete failure this app is built against.
 */
export function replaySavedMeal(meal: SavedMeal, lookup: FoodLookup): MealReplay {
  const found: { ref: FoodRef; per100g: ReturnType<typeof scalePer100g> }[] = [];
  const missing: FoodRef[] = [];
  for (const ref of meal.refs) {
    const food = lookup.get(ref.source, ref.foodId);
    if (!food) {
      missing.push(ref);
      continue;
    }
    found.push({ ref, per100g: scalePer100g(food.per100g, ref.grams) });
  }
  const { total, coverage } = sumNutrients(found.map((f) => f.per100g));
  return {
    resolution: {
      refs: found.map((f) => f.ref),
      nutrients: total,
      coverage,
      classification: mergeClassification(found.map((f) => f.ref.classification)),
      needsHelp: [],
      confidence: 1,
    },
    missing,
  };
}
