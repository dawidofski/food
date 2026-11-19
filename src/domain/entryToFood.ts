import type { FoodLookup } from '@/domain/foodLookup';
import { isKnownValue } from '@/domain/nutrients';
import type { CustomFood, DiaryEntry } from '@/types/diary';
import { NUTRIENT_KEYS, type NutrientSet } from '@/types/nutrients';

/** Below this there is no sensible per-100 g figure to work out, and dividing by it would invent one. */
const MIN_GRAMS = 1;

export type FoodDraft = Omit<CustomFood, 'id'>;

/** The weight the entry was logged at, or undefined when any item's grams are missing or absurd. */
export function entryGrams(entry: DiaryEntry): number | undefined {
  let total = 0;
  for (const item of entry.items) {
    if (!isKnownValue(item.grams) || item.grams <= 0) return undefined;
    total += item.grams;
  }
  return total >= MIN_GRAMS ? total : undefined;
}

/**
 * A diary entry, turned into a draft of one of the person's own foods — the thing they can type the name of
 * tomorrow and have it resolve straight away, instead of the app reading the words again and perhaps reading
 * them differently.
 *
 * Three rules make this honest rather than convenient:
 *
 * 1. **Only figures the entry could fully vouch for are carried.** A figure whose coverage is `partial` is a
 *    FLOOR — part of the meal had no value for it — and writing a floor into a per-100 g table would restate
 *    "at least this much" as "this much", for every future portion. Those keys are left absent, which is the
 *    app's word for unknown, and the editor shows them empty for the person to fill if they know better.
 * 2. **Allergens come from the foods the entry was built from**, unioned, because a saved food with an empty
 *    allergen list would silently stop the allergen warning firing for something that always triggered it. An
 *    empty list is never "allergen-free" (see `src/types/food.ts`), so a food whose sources cannot be found
 *    keeps an empty list and the editor says the list came out empty.
 * 3. **Nothing is saved here.** This builds a draft; the editor shows every figure for checking first, and
 *    saving marks it self-reported like any other food of theirs — which is the honest label once a snapshot
 *    has been frozen out of the database it came from.
 */
export function entryToFoodDraft(entry: DiaryEntry, lookup: FoodLookup): FoodDraft | undefined {
  const grams = entryGrams(entry);
  if (grams === undefined) return undefined;

  const per100g: NutrientSet = {};
  for (const key of NUTRIENT_KEYS) {
    const v = entry.nutrients[key];
    // `known` only: a partial figure is a floor, and a floor scaled to 100 g is a floor pretending to be a fact.
    if (!isKnownValue(v) || entry.coverage[key] !== 'known') continue;
    const scaled = (v * 100) / grams;
    // Rounded the way this app prints every other figure: whole numbers from ten up, one decimal below.
    // Three decimals would claim a precision a scaled figure does not have — 148.714 kcal per 100 g reads
    // as a measurement, and it is arithmetic on a portion someone estimated.
    if (Number.isFinite(scaled)) {
      per100g[key] = Math.abs(scaled) < 10 ? Math.round(scaled * 10) / 10 : Math.round(scaled);
    }
  }

  const allergens = new Set<string>();
  for (const item of entry.items) {
    const found = lookup.get(item.source, item.foodId);
    for (const a of found?.allergens ?? []) allergens.add(a);
  }

  return {
    name: entry.rawText.trim().slice(0, 80),
    nutrientsPer100g: per100g,
    classification: entry.classification,
    allergens: [...allergens].sort(),
    // The amount they actually ate, so logging it again by name gives the portion they already know.
    referencePortion: { label: 'as you logged it', grams: Math.round(grams * 10) / 10 },
    synonyms: [],
  };
}
