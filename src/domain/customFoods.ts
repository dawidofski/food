/**
 * User-defined foods: the things the USDA dataset has never heard of (frikandel, bitterballen).
 *
 * THE INVARIANT: a nutrient the person leaves blank is UNKNOWN, never zero. Every path in here
 * therefore treats "no value" as an absent key. `parseNutrientField` is the only place text
 * becomes a number, and it answers "blank" with `undefined`, never with `Number('')` (which is 0).
 * `buildCustomFood` copies only keys holding a finite number, so undefined, null and NaN are
 * dropped or refused, never defaulted.
 */
import { allCustomFoods, deleteCustomFood as removeCustomFood, getCustomFood, onEraseEverything, putCustomFood } from '@/data/db';
import { buildSearchIndex, normalizeTokens, search, type SearchIndex } from '@/data/foodSearch';
import { combineLookups, type FoodLookup } from '@/domain/foodLookup';
import type { CustomFood } from '@/types/diary';
import type { DatasetFood } from '@/types/food';
import { NUTRIENT_KEYS, type ClassificationFlags, type NutrientKey, type NutrientSet } from '@/types/nutrients';

/** novaGroup 1 here means "not flagged", not "unprocessed": see the NOVA ASSUMPTION in buildCustomFood. */
export const NO_FLAGS: ClassificationFlags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};

/** The dataset's allergen vocabulary (the EU's 14 groups), so a custom tag meets the allergen rule's flags. */
export const ALLERGEN_TAGS = [
  'gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soybeans', 'milk', 'nuts', 'celery', 'mustard', 'sesame',
  'sulphites', 'lupin', 'molluscs',
] as const;

/** Plausibility ceilings per 100 g. A typo like 28000 kcal must be refused, not silently logged. */
const CEILING: Record<NutrientKey, number> = {
  energyKcal: 1000, proteinG: 100, fatG: 100, satFatG: 100, transFatG: 100, carbG: 100, sugarsG: 100, addedSugarsG: 100,
  fibreG: 100, sodiumMg: 100_000, potassiumMg: 100_000, calciumMg: 100_000, ironMg: 100_000, magnesiumMg: 100_000,
  zincMg: 100_000, vitaminCMg: 100_000, vitaminDUg: 1_000_000, vitaminB12Ug: 1_000_000, folateUg: 1_000_000,
};
const MAX_PORTION_GRAMS = 5000;

export type ParsedField = { ok: true; value: number | undefined } | { ok: false };

/** Blank is unknown (`undefined`), a typed number is that number (comma decimals allowed), anything else is an error. */
export function parseNutrientField(text: string): ParsedField {
  const t = text.trim();
  if (t === '') return { ok: true, value: undefined };
  if (!/^\d+(?:[.,]\d+)?$/.test(t)) return { ok: false };
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
}

export type CustomFoodInput = {
  name: string;
  synonyms?: string[];
  /** A key that is missing, undefined or null is unknown. */
  per100g?: Partial<Record<NutrientKey, number | undefined>>;
  classification?: Partial<ClassificationFlags>;
  allergens?: string[];
  referencePortion?: { label: string; grams: number };
};

/**
 * A nutrient figure outside what a per-100 g field can hold.
 *
 * Carries the key rather than only a sentence, so the screen can name the field the way the person sees it
 * ("Energy (kcal)") instead of showing them the internal `energyKcal`. The message is a readable fallback for
 * anywhere that only logs the error.
 */
export class NutrientRangeError extends RangeError {
  constructor(readonly key: NutrientKey, readonly ceiling: number) {
    super(`${key} must be a number between 0 and ${ceiling}`);
    this.name = 'NutrientRangeError';
  }
}

function cleanNutrients(input: CustomFoodInput['per100g']): NutrientSet {
  const out: NutrientSet = {};
  if (!input) return out;
  for (const key of NUTRIENT_KEYS) {
    const v = input[key] as number | undefined | null;
    if (v === undefined || v === null) continue; // unknown: the key stays absent
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > CEILING[key]) {
      throw new NutrientRangeError(key, CEILING[key]);
    }
    out[key] = v;
  }
  return out;
}

function buildCustomFood(id: string, input: CustomFoodInput): CustomFood {
  const name = input.name.trim();
  if (name === '') throw new RangeError('A food needs a name');
  const portion = input.referencePortion ?? { label: '1 serving', grams: 100 };
  const grams = portion.grams;
  if (!Number.isFinite(grams) || grams <= 0 || grams > MAX_PORTION_GRAMS) {
    throw new RangeError(`The portion weight must be more than 0 and at most ${MAX_PORTION_GRAMS} g`);
  }
  const label = portion.label.trim() === '' ? '1 serving' : portion.label.trim();
  // NOVA ASSUMPTION (a recorded choice, not an accident of the type): ClassificationFlags.novaGroup cannot say
  // "unknown", so a custom food not ticked as ultra-processed is stored as group 1. The daily ultra-processed share
  // therefore counts it as NOT ultra-processed, and that card under-fires rather than over-fires. That is the safe
  // direction for a rule whose evidence is 'limited'. Only group 4 is read by any rule.
  const flags: ClassificationFlags = { ...NO_FLAGS, ...(input.classification ?? {}) };
  if (![1, 2, 3, 4].includes(flags.novaGroup)) flags.novaGroup = 1;
  const dedupe = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter((x) => x !== ''))];
  return {
    id, name,
    nutrientsPer100g: cleanNutrients(input.per100g),
    classification: flags,
    allergens: dedupe(input.allergens ?? []),
    referencePortion: { label, grams },
    synonyms: dedupe(input.synonyms ?? []),
  };
}

export async function createCustomFood(input: CustomFoodInput): Promise<CustomFood> {
  const food = buildCustomFood(`custom-${globalThis.crypto.randomUUID()}`, input);
  await putCustomFood(food);
  await refreshCustomFoods();
  return food;
}

/** Replaces the whole food. A field missing from `input` becomes unknown again, which is how a value is cleared. */
export async function updateCustomFood(id: string, input: CustomFoodInput): Promise<CustomFood> {
  if (!(await getCustomFood(id))) throw new RangeError('That food no longer exists');
  const food = buildCustomFood(id, input);
  await putCustomFood(food);
  await refreshCustomFoods();
  return food;
}

/**
 * The portion label's one word, lower-cased ("Stuk (approx.)" -> "stuk"). resolveItems ranks English labels built
 * for FNDDS, so the adapter emits only "1 serving" plus "1 <word>", which rank predictably and let "2 pieces of it" work.
 */
function portionWord(label: string): string | null {
  const m = /[a-zA-Z]+/.exec(label.replace(/^[\s\d./]+/, ''));
  const w = m?.[0]?.toLowerCase();
  return w && w !== 'serving' ? w : null;
}

/** Adapts a custom food to the dataset shape so resolveItems and the rules treat it like any other food. */
export function customFoodToDatasetShape(c: CustomFood): DatasetFood {
  const grams = c.referencePortion.grams;
  const portions = [{ label: '1 serving', grams }];
  const word = portionWord(c.referencePortion.label);
  if (word) portions.push({ label: `1 ${word}`, grams });
  return {
    id: c.id,
    name: c.name,
    synonyms: [...c.synonyms],
    // Copied as stored: an absent key stays absent.
    per100g: { ...c.nutrientsPer100g },
    portions,
    classification: { ...c.classification },
    allergens: [...c.allergens],
  };
}

// ---- the provider ----

let cache: { foods: Map<string, DatasetFood>; index: SearchIndex } = { foods: new Map(), index: buildSearchIndex([]) };

function install(list: CustomFood[]): void {
  const adapted = list.map(customFoodToDatasetShape);
  cache = { foods: new Map(adapted.map((f) => [f.id, f])), index: buildSearchIndex(adapted) };
}

/** Reloads the in-memory index from storage. The flow calls this before each lookup via loadData. */
export async function refreshCustomFoods(): Promise<void> {
  install(await allCustomFoods());
}

// A wipe of the stored foods must also empty this cache, or erased foods stay searchable and loggable.
onEraseEverything(() => install([]));

export async function deleteCustomFood(id: string): Promise<void> {
  await removeCustomFood(id);
  await refreshCustomFoods();
}

const sameWords = (a: string, b: string): boolean => normalizeTokens(a).join(' ') === normalizeTokens(b).join(' ');

/**
 * Custom foods as a FoodLookup. A name or synonym that is exactly what was typed scores 0, which beats the dataset's
 * ~0.03 on purpose: the user's own food wins for their own word. A looser match keeps its search score and loses ties
 * to nothing (custom is listed first in withCustomFoods).
 */
export const customLookup: FoodLookup = {
  search(query, limit = 10) {
    return search(cache.index, query, limit).map((h) => {
      const exact = sameWords(h.food.name, query) || h.food.synonyms.some((s) => sameWords(s, query));
      return { source: 'custom' as const, food: h.food, score: exact ? 0 : h.score };
    });
  },
  get: (source, id) => (source === 'custom' ? cache.foods.get(id) : undefined),
};

/** Custom foods first, then the given provider. */
export function withCustomFoods(base: FoodLookup): FoodLookup {
  return combineLookups(customLookup, base);
}
