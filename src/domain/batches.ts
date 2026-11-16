/**
 * Batch cooking: a pot of food divided into portions.
 *
 * THE ARITHMETIC DECISION: portions, not weight, are the unit of division. The ingredients' nutrients are summed and
 * the total is divided by the portion count. Cooking changes weight (water loss, absorption), so a per-100-g figure
 * for the cooked dish is unreliable while "total / 4" is exact. `totalCookedGrams` is recorded ONLY to say how much one
 * portion weighs; nothing here ever multiplies a nutrient by it.
 *
 * Unknown stays unknown: a nutrient no ingredient knew is absent from the batch, and one that only some ingredients
 * knew is marked 'partial'. An ingredient that could not be resolved is reported, never dropped, and while any is
 * missing every known nutrient reads 'partial' so the total is never mistaken for a clean one.
 */
import { allBatches, onEraseEverything, putBatch } from '@/data/db';
import { buildSearchIndex, normalizeTokens, search, type SearchIndex } from '@/data/foodSearch';
import { combineLookups, type FoodLookup } from '@/domain/foodLookup';
import { isKnownValue, mergeClassification, sumNutrients } from '@/domain/nutrients';
import { parseEntry, type ParsedItem } from '@/domain/parseEntry';
import { resolveItems } from '@/domain/resolveItems';
import type { Batch, FoodRef } from '@/types/diary';
import type { DatasetFood } from '@/types/food';
import { NUTRIENT_KEYS, type Coverage, type NutrientSet } from '@/types/nutrients';

const MAX_PORTIONS = 100;
const MAX_COOKED_GRAMS = 100_000;
/** Without a cooked weight a portion has no honest gram figure; this nominal 100 g only keeps the per-100g maths simple. */
const NOMINAL_PORTION_GRAMS = 100;

export type BatchInput = {
  name: string;
  ingredientLines: string[];
  portionCount: number;
  totalCookedGrams?: number | undefined;
};

/** An ingredient weighed by the person that resolved to a COOKED grain: dry weight would be about twice the energy. */
export type CookedWeightNote = { ingredient: string; foodName: string; grams: number };

export type BuildResult = { batch: Batch; needsHelp: ParsedItem[]; cookedWeightNotes: CookedWeightNote[] };

const GRAIN_NAME = /\b(pasta|spaghetti|macaroni|noodles?|rice|couscous|quinoa|bulgur|barley|penne|fusilli|rigatoni|oats?|oatmeal)\b/i;
const NOT_COOKED = /\b(dry|dried|uncooked|raw)\b/i;

function validate(input: BatchInput): void {
  if (input.name.trim() === '') throw new RangeError('A batch needs a name');
  const n = input.portionCount;
  if (!Number.isInteger(n) || n < 1 || n > MAX_PORTIONS) {
    throw new RangeError(`The number of portions must be a whole number from 1 to ${MAX_PORTIONS}`);
  }
  const g = input.totalCookedGrams;
  if (g !== undefined && (!Number.isFinite(g) || g <= 0 || g > MAX_COOKED_GRAMS)) {
    throw new RangeError(`The cooked weight must be more than 0 and at most ${MAX_COOKED_GRAMS} g`);
  }
}

/** Splits free text into items, one per ingredient. A fragment with no usable food word is reported, not discarded. */
function itemsOf(lines: string[]): ParsedItem[] {
  const { items, unparseable } = parseEntry(lines.join('\n'));
  return [...items, ...unparseable.map((u): ParsedItem => ({ rawFragment: u, quantity: { count: 1 }, foodQuery: u }))];
}

type Computed = Pick<Batch, 'ingredients' | 'nutrientsPerPortion' | 'coverage' | 'classification'> & {
  allergens: string[];
  needsHelp: ParsedItem[];
  cookedWeightNotes: CookedWeightNote[];
};

function compute(input: BatchInput, lookup: FoodLookup): Computed {
  validate(input);
  const ingredients: Batch['ingredients'] = [];
  const sets: NutrientSet[] = [];
  const refs: FoodRef[] = [];
  const allergens = new Set<string>();
  const needsHelp: ParsedItem[] = [];
  const cookedWeightNotes: CookedWeightNote[] = [];

  for (const item of itemsOf(input.ingredientLines)) {
    const r = resolveItems([item], lookup);
    const ref = r.refs[0];
    if (r.needsHelp.length > 0 || !ref) {
      needsHelp.push(item);
      ingredients.push({ text: item.rawFragment, refs: [] }); // kept, so editing can retry it
      continue;
    }
    ingredients.push({ text: item.rawFragment, refs: r.refs });
    sets.push(r.nutrients);
    refs.push(ref);
    const food = lookup.get(ref.source, ref.foodId);
    for (const a of food?.allergens ?? []) allergens.add(a);
    if (food && item.quantity.grams !== undefined && GRAIN_NAME.test(food.name) && !NOT_COOKED.test(food.name)) {
      cookedWeightNotes.push({ ingredient: item.rawFragment, foodName: food.name, grams: ref.grams });
    }
  }

  const { total, coverage } = sumNutrients(sets);
  const perPortion: NutrientSet = {};
  for (const key of NUTRIENT_KEYS) {
    const v = total[key];
    if (isKnownValue(v)) perPortion[key] = v / input.portionCount;
  }
  // A missing ingredient means every figure is a floor, whatever the resolved ingredients knew.
  const covered: Coverage = {};
  for (const key of NUTRIENT_KEYS) {
    const c = coverage[key];
    covered[key] = needsHelp.length > 0 && c === 'known' ? 'partial' : c;
  }
  return {
    ingredients, nutrientsPerPortion: perPortion, coverage: covered,
    classification: mergeClassification(refs.map((r) => r.classification)),
    allergens: [...allergens].sort(), needsHelp, cookedWeightNotes,
  };
}

export function buildBatch(input: BatchInput, lookup: FoodLookup): BuildResult {
  const c = compute(input, lookup);
  const batch: Batch = {
    id: `batch-${globalThis.crypto.randomUUID()}`,
    name: input.name.trim(),
    ingredients: c.ingredients,
    portionCount: input.portionCount,
    nutrientsPerPortion: c.nutrientsPerPortion,
    coverage: c.coverage,
    classification: c.classification,
    ...(c.allergens.length > 0 ? { allergens: c.allergens } : {}),
    portionsRemaining: input.portionCount,
    cookedAt: new Date().toISOString(),
  };
  if (input.totalCookedGrams !== undefined) batch.totalCookedGrams = input.totalCookedGrams;
  return { batch, needsHelp: c.needsHelp, cookedWeightNotes: c.cookedWeightNotes };
}

/** Cooked again: the counter goes back to the full count, nothing is re-entered. */
export function recook(b: Batch, now: Date = new Date()): Batch {
  return { ...b, portionsRemaining: b.portionCount, cookedAt: now.toISOString() };
}

export type BatchChanges = Partial<BatchInput>;

/**
 * Re-divides after an edit. It returns a new Batch value and touches nothing else: portions already logged are
 * DiaryEntry rows that snapshotted their own nutrients at commit, so they are not and cannot be altered here.
 * When the count changes, the portions left move by the same amount (cooking for 8 instead of 4 adds 4), within 0..count.
 * Returns the unresolved ingredients too, because an edit can introduce one.
 */
export function rebuildBatch(b: Batch, changes: BatchChanges, lookup: FoodLookup): BuildResult {
  const input: BatchInput = {
    name: changes.name ?? b.name,
    ingredientLines: changes.ingredientLines ?? b.ingredients.map((i) => i.text),
    portionCount: changes.portionCount ?? b.portionCount,
    totalCookedGrams: 'totalCookedGrams' in changes ? changes.totalCookedGrams : b.totalCookedGrams,
  };
  const c = compute(input, lookup);
  const remaining = Math.min(input.portionCount, Math.max(0, b.portionsRemaining + (input.portionCount - b.portionCount)));
  const { totalCookedGrams: _cooked, allergens: _allergens, ...rest } = b;
  const batch: Batch = {
    ...rest,
    name: input.name.trim(),
    ingredients: c.ingredients,
    portionCount: input.portionCount,
    nutrientsPerPortion: c.nutrientsPerPortion,
    coverage: c.coverage,
    classification: c.classification,
    ...(c.allergens.length > 0 ? { allergens: c.allergens } : {}),
    portionsRemaining: remaining,
  };
  if (input.totalCookedGrams !== undefined) batch.totalCookedGrams = input.totalCookedGrams;
  return { batch, needsHelp: c.needsHelp, cookedWeightNotes: c.cookedWeightNotes };
}

/** Grams one portion weighs, from the cooked weight; the nominal figure when it was not given. */
export function portionGrams(b: Batch): number {
  return b.totalCookedGrams !== undefined ? b.totalCookedGrams / b.portionCount : NOMINAL_PORTION_GRAMS;
}

// ---- the provider: batches as a food you can log by name ----

/** Adapts a batch to the dataset shape. One portion is the unit: the per-100g figures are the portion's own, rescaled. */
export function batchToDatasetShape(b: Batch): DatasetFood {
  const grams = portionGrams(b);
  const per100g: NutrientSet = {};
  for (const key of NUTRIENT_KEYS) {
    const v = b.nutrientsPerPortion[key];
    if (isKnownValue(v)) per100g[key] = (v * 100) / grams;
  }
  return {
    id: b.id,
    name: b.name,
    // "a portion of chicken pasta" parses to the query "portion of chicken pasta"; every query word must be in a name
    // or synonym, so those phrasings are listed.
    synonyms: [`portion of ${b.name}`, `portions of ${b.name}`],
    per100g,
    // The portion ranking is English-label heuristics built for FNDDS names, so the label is the plain "1 portion".
    portions: [{ label: '1 portion', grams }],
    classification: { ...b.classification },
    allergens: [...(b.allergens ?? [])],
  };
}

let cache: { foods: Map<string, DatasetFood>; index: SearchIndex } = { foods: new Map(), index: buildSearchIndex([]) };

function install(list: Batch[]): void {
  const adapted = list.map(batchToDatasetShape);
  cache = { foods: new Map(adapted.map((f) => [f.id, f])), index: buildSearchIndex(adapted) };
}

export async function refreshBatches(): Promise<void> {
  install(await allBatches());
}

onEraseEverything(() => install([]));

/** Saves and makes the batch findable by name at once. */
export async function saveBatch(b: Batch): Promise<void> {
  await putBatch(b);
  await refreshBatches();
}

const sameWords = (a: string, b: string): boolean => normalizeTokens(a).join(' ') === normalizeTokens(b).join(' ');

/**
 * Batches as a FoodLookup. resolveItems only ever calls search(query, 1), so a batch that name search cannot find is
 * unreachable. As with custom foods, an exact name or "portion of <name>" scores 0 and beats the dataset's ~0.03.
 */
export const batchLookup: FoodLookup = {
  search(query, limit = 10) {
    return search(cache.index, query, limit).map((h) => {
      const exact = sameWords(h.food.name, query) || h.food.synonyms.some((s) => sameWords(s, query));
      return { source: 'batch' as const, food: h.food, score: exact ? 0 : h.score };
    });
  },
  get: (source, id) => (source === 'batch' ? cache.foods.get(id) : undefined),
};

/** Batches first, then the given provider. */
export function withBatches(base: FoodLookup): FoodLookup {
  return combineLookups(batchLookup, base);
}

/** How many portions a logged amount of a batch counts for (at least one). */
export function portionsFor(grams: number, perPortionGrams: number): number {
  const n = Math.round(grams / perPortionGrams);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}
