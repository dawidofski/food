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
  // A glass is not an FNDDS portion; the dataset's drink serving is the cup (~240 ml).
  glass: 'cup', glasses: 'cup',
};
// Leading words of portion labels that are measuring units, not servings. Matching is on the
// label's FIRST word only, so "1 can (12 fl oz)" (first word "can") is a container, not a measure.
const SUB_SERVING = new Set([
  'fl', 'oz', 'cubic', 'surface', 'tbsp', 'tsp', 'lb', 'g', 'gram', 'ml', 'l', 'pint', 'quart', 'gallon', 'liter', 'litre',
]);
const MIDDLE_SIZE = /\b(medium|regular)\b/;
const OTHER_SIZE = /\b(small|large|big)\b/;
// Variants that are not the ordinary item: they lose to a plain label of the same group.
const QUALIFIED = /\b(not eaten|without|no |mini|miniature|cocktail|extra|jumbo|king|thin|thick|crust|nfs|school|child|senior|foot ?long)\b|\bno\b/;

function unitWord(w: string): string {
  const x = w.toLowerCase().replace(/[^a-z]/g, '');
  return UNIT_ALIASES[x] ?? x;
}

/** Splits a portion label into leading number and unit word: "1 tbsp", "1/2 cup", "2 slices", "1 cup, cooked". */
function parsePortionLabel(label: string): { n: number; word: string; words: string[] } {
  const m = /^\s*(?:(\d+(?:\.\d+)?)(?:\/(\d+))?\s*)?([a-zA-Z]+)/.exec(label);
  let n = m?.[1] !== undefined ? Number(m[1]) : 1;
  if (m?.[2] !== undefined) n /= Number(m[2]);
  // Every word before the first comma or bracket, so an explicit unit still finds "1 medium or
  // regular slice" (first word "medium") and "1 can (12 fl oz)" is never read as a fluid ounce.
  const head = label.split(/[,(]/)[0] ?? '';
  const words = (head.match(/[a-zA-Z]+/g) ?? []).map(unitWord);
  return { n: Number.isFinite(n) && n > 0 ? n : 1, word: unitWord(m?.[3] ?? ''), words };
}

const CONTAINER = new Set(['can', 'bottle', 'package', 'packet', 'bar', 'box', 'carton', 'pouch', 'jar']);

/**
 * Lower is better. Orders portions of the same group: a real container (so cola is the can, not
 * the fast-food "medium drink"), middle size, plain, other sizes, then qualified variants.
 */
function tier(label: string, word: string): number {
  const l = label.toLowerCase();
  if (QUALIFIED.test(l)) return 4;
  if (CONTAINER.has(word)) return 0;
  if (MIDDLE_SIZE.test(l)) return 1;
  if (OTHER_SIZE.test(l)) return 3;
  return 2;
}

/**
 * 0 whole item or container, 1 cup (and qualified whole items, which tier() then ranks below a
 * plain cup: "1 individual school container" must not beat "1 cup" for milk), 2 sub-serving measure.
 */
function group(word: string, label: string): number {
  if (word === 'cup') return 1;
  if (SUB_SERVING.has(word)) return 2;
  return QUALIFIED.test(label.toLowerCase()) ? 1 : 0;
}

function boundedGrams(g: number): number | null {
  return Number.isFinite(g) && g > 0 && g <= MAX_ITEM_GRAMS ? g : null;
}

/**
 * Picks the portion for a quantity and returns its grams and label, or null when it cannot be
 * determined safely: no usable portion, or a non-positive, non-finite or absurd amount.
 *
 * Absolute `grams` need no portion. An explicit `unitLabel` wins: only portions whose unit word
 * matches are considered. A bare count is "one natural serving" and ranks every portion:
 *   1. whole items and containers (medium, regular, piece, slice, can, bottle...), by label tier;
 *   2. a cup (FNDDS's canonical serving: rice, milk);
 *   3. sub-serving measures (fl oz, oz, tbsp...), only as a last resort.
 * Within a group, a middle size beats small/large (apple takes "1 medium"), and qualified variants
 * ("crust not eaten", "cocktail/miniature") lose; ties keep dataset order. Only a food with no
 * usable portion at all returns null. The gate shows the user the chosen label and grams before
 * anything is saved, so a defaulted serving is visible and correctable.
 */
function choosePortion(q: Quantity, food: DatasetFood): { grams: number; label?: string } | null {
  if (q.grams !== undefined) {
    const g = boundedGrams(q.grams);
    return g === null ? null : { grams: g };
  }
  const count = q.count;
  if (count === undefined || !Number.isFinite(count) || count <= 0 || count > MAX_COUNT) return null;

  const wanted = q.unitLabel === undefined ? undefined : unitWord(q.unitLabel);
  const candidates = food.portions
    .map((p, i) => ({ p, i, ...parsePortionLabel(p.label) }))
    // "Guideline amount per fl oz of beverage" is a dataset rule of thumb (2.5 g), not a serving.
    .filter((c) => !/^guideline|per/i.test(c.p.label))
    .filter((c) => c.word !== '' && Number.isFinite(c.p.grams) && c.p.grams > 0)
    .filter((c) => (wanted === undefined ? true : c.words.includes(wanted)));
  const rank = (c: (typeof candidates)[number]) => [wanted === undefined ? group(c.word, c.p.label) : 0, tier(c.p.label, c.word), c.i];
  candidates.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    return ra[0]! - rb[0]! || ra[1]! - rb[1]! || ra[2]! - rb[2]!;
  });
  const best = candidates[0];
  if (!best) return null;
  const grams = boundedGrams((count * best.p.grams) / best.n);
  return grams === null ? null : { grams, label: best.p.label };
}

/** Grams for a quantity of a food, or null; see choosePortion for the rules. */
export function quantityToGrams(q: Quantity, food: DatasetFood): number | null {
  return choosePortion(q, food)?.grams ?? null;
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
    const chosen = choosePortion(item.quantity, hit.food);
    if (chosen === null) {
      needsHelp.push(item);
      continue;
    }
    const ref: FoodRef = { source: hit.source, foodId: hit.food.id, grams: chosen.grams };
    if (chosen.label !== undefined) ref.portionLabel = chosen.label;
    refs.push(ref);
    sets.push(scalePer100g(hit.food.per100g, chosen.grams));
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
