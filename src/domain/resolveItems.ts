import type { DatasetFood } from '@/types/food';
import type { FoodRef, Resolution } from '@/types/diary';
import type { NutrientSet } from '@/types/nutrients';
import type { ParsedItem } from '@/domain/parseEntry';
import type { Quantity } from '@/domain/quantity';
import type { FoodLookup } from '@/domain/foodLookup';
import { mergeClassification, scalePer100g, sumNutrients } from '@/domain/nutrients';

// Task 6 parses faithfully and does not judge magnitude, so this module is the boundary that does.
// 100 kg for a single item is far beyond any real meal yet keeps every nutrient total finite and
// meaningful; "1e299 kg" or a typo like "5000000 g" must go to needsHelp, never into a total.
export const MAX_ITEM_GRAMS = 100_000;
// 1000 of anything is a typo, not a meal. (The gram ceiling above also bounds count x portion.)
export const MAX_COUNT = 1000;

/**
 * Sanity guard only. The search layer requires every query token to appear in the candidate name
 * and has no length normalisation, so every hit scores ~0.03 and a non-match returns no hit at all.
 * This threshold therefore passes everything the search returns; it must not be mistaken for the
 * thing that separates good matches from bad ones. The real decision is "was there a hit".
 */
const SCORE_SANITY_LIMIT = 0.25;

const UNIT_ALIASES: Record<string, string> = {
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbsps: 'tbsp',
  teaspoon: 'tsp', teaspoons: 'tsp', tsps: 'tsp',
  cups: 'cup', slices: 'slice', pieces: 'piece',
};
// Portion words that are measures of volume or weight, not a single natural serving of the food.
const MEASURE_WORDS = new Set([
  'cup', 'tbsp', 'tsp', 'oz', 'fl', 'lb', 'g', 'gram', 'ml', 'l', 'pint', 'quart', 'gallon', 'liter', 'litre',
]);

function unitWord(w: string): string {
  const x = w.toLowerCase().replace(/[^a-z]/g, '');
  return UNIT_ALIASES[x] ?? x;
}

/** Splits a portion label into its leading number and unit word: "1 tbsp", "1 cup, chopped", "2 slices". */
function parsePortionLabel(label: string): { n: number; word: string } {
  const m = /^\s*(\d+(?:\.\d+)?)?\s*([a-zA-Z]+)/.exec(label);
  const n = m?.[1] !== undefined ? Number(m[1]) : 1;
  return { n: n > 0 ? n : 1, word: unitWord(m?.[2] ?? '') };
}

function boundedGrams(g: number): number | null {
  return Number.isFinite(g) && g > 0 && g <= MAX_ITEM_GRAMS ? g : null;
}

/**
 * Grams for a quantity of a food, or null when it cannot be determined safely: no matching
 * portion row, or a non-positive, non-finite or absurd amount. Absolute `grams` win; otherwise
 * count x the matching portion. A bare count uses the first portion that is a single item
 * ("1 frankfurter", "1 regular") rather than a measure ("1 cup", "1 tbsp", "1 oz"): FNDDS lists
 * the natural serving first, and a measure would give nonsense for "two hot dogs".
 */
export function quantityToGrams(q: Quantity, food: DatasetFood): number | null {
  if (q.grams !== undefined) return boundedGrams(q.grams);
  const count = q.count;
  if (count === undefined || !Number.isFinite(count) || count <= 0 || count > MAX_COUNT) return null;

  const wanted = q.unitLabel === undefined ? undefined : unitWord(q.unitLabel);
  for (const p of food.portions) {
    const { n, word } = parsePortionLabel(p.label);
    const matches = wanted !== undefined ? word === wanted : n === 1 && word !== '' && !MEASURE_WORDS.has(word);
    if (matches) return boundedGrams((count * p.grams) / n);
  }
  return null;
}

/**
 * Resolves parsed items against a lookup. An item that cannot be resolved safely goes to
 * `needsHelp` and the rest still count; nothing is guessed. Nutrients come from scalePer100g and
 * sumNutrients, so an unrecorded value stays absent (coverage 'unknown' or 'partial'), never zero.
 */
export function resolveItems(items: ParsedItem[], lookup: FoodLookup): Resolution {
  const refs: FoodRef[] = [];
  const sets: NutrientSet[] = [];
  const foods: DatasetFood[] = [];
  const scores: number[] = [];
  const needsHelp: ParsedItem[] = [];

  for (const item of items) {
    const hit = lookup.search(item.foodQuery, 1)[0];
    if (!hit || !(hit.score <= SCORE_SANITY_LIMIT)) {
      needsHelp.push(item);
      continue;
    }
    const grams = quantityToGrams(item.quantity, hit.food);
    if (grams === null) {
      needsHelp.push(item);
      continue;
    }
    const ref: FoodRef = { source: hit.source, foodId: hit.food.id, grams };
    const unit = item.quantity.unitLabel;
    if (item.quantity.grams === undefined && unit !== undefined) {
      const label = hit.food.portions.find((p) => parsePortionLabel(p.label).word === unitWord(unit))?.label;
      if (label !== undefined) ref.portionLabel = label;
    }
    refs.push(ref);
    sets.push(scalePer100g(hit.food.per100g, grams));
    foods.push(hit.food);
    scores.push(hit.score);
  }

  const { total, coverage } = sumNutrients(sets);
  const confidence = scores.length === 0 ? 0 : 1 - scores.reduce((a, b) => a + b, 0) / scores.length;
  return {
    refs,
    nutrients: total,
    coverage,
    classification: mergeClassification(foods.map((f) => f.classification)),
    needsHelp,
    confidence,
  };
}
