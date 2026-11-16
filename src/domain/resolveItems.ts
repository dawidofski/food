import type { DatasetFood } from '@/types/food';
import type { FoodRef, FoodSource, Resolution } from '@/types/diary';
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
  'fl', 'oz', 'cubic', 'surface', 'linear', 'tbsp', 'tsp', 'lb', 'g', 'gram', 'ml', 'l', 'pint', 'quart', 'gallon', 'liter', 'litre',
]);
const MIDDLE_SIZE = /\b(medium|regular)\b/;
const OTHER_SIZE = /\b(small|large|big)\b/;
// Variants that are not the ordinary item: they lose to a plain label of the same group.
// `dry` belongs here: "1 cup, dry, yields" measures a cup of the DRY food and gives the weight it
// becomes once cooked (barley 740 g, cream of wheat 965 g), which is roughly four servings, so it
// must lose to the plain "1 cup, cooked" of the same food. Only `dry`, never a bare "yield":
// "yield after cooking" marks genuine cooked whole items ("1 medium slice (yield after cooking)"
// for bacon, "1 rib", "1 breast quarter"), and demoting those made bacon resolve to "1 cup,
// pieces" (8 g -> 80 g) and french fries to a single 5 g fry. Measured on the real dataset.
const QUALIFIED = /\b(not eaten|without|no |mini|miniature|cocktail|extra|jumbo|king|thin|thick|crust|nfs|school|child|senior|foot ?long|dry)\b|\bno\b/;

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

const NOT_A_SERVING = /guideline amount|^topping per /i;
// In preference order: a can is the natural single serving of a drink before a bottle.
const CONTAINERS = ['can', 'bottle', 'package', 'packet', 'bar', 'box', 'carton', 'pouch', 'jar'];
// Words naming a FRACTION of the food, not a serving of it. A whole item in the same group must
// beat these ("1 banana" 126 g over "1 slice" 6 g). Genuine wholes are deliberately absent:
// stick, patty, tail, whole, loaf, link, fillet. Ignored when the user named the unit themselves.
// `meatball` is here for the loaf foods that carry both: "1 medium meatball" 28 g must not beat
// "1 medium slice" 108 g, a silent 3.9x understatement on a red meat that reads as plausible at
// the gate. It is safe for a real meatball food, because this tier lives inside group 0 and so
// still outranks that food's group-1 cup ("1 meatball" 18 g over "1 cup" 144 g).
const FRAGMENT_WORDS = new Set([
  'slice', 'piece', 'pat', 'chunk', 'cube', 'wedge', 'sliver', 'bone', 'bite', 'strip', 'square', 'half', 'quarter', 'meatball',
]);

/**
 * Lower is better. Orders portions of the same group: a real container (so cola is the can, not
 * the fast-food "medium drink"), middle size, plain, other sizes, fragments of the food, then
 * qualified variants. Ties are broken by label and weight in choosePortion, never by dataset order.
 */
function tier(label: string, word: string, words: string[], explicitUnit: boolean): number {
  const l = label.toLowerCase();
  if (QUALIFIED.test(l)) return 5;
  const c = CONTAINERS.indexOf(word);
  if (c >= 0) return c / 100;
  const size = MIDDLE_SIZE.test(l) ? 1 : OTHER_SIZE.test(l) ? 3 : 2;
  // A "medium slice" is still a slice: a fragment loses to any whole item of the same group
  // whatever size word it carries, or "1 medium slice" (60 g) beats "1 breast" (130 g). The size
  // ladder still orders the fragments among themselves (white bread takes the regular slice),
  // and a fragment still beats a qualified variant, so this only refines the old tier 4.
  if (!explicitUnit && words.some((w) => FRAGMENT_WORDS.has(w))) return 4 + size / 10;
  return size;
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
 * Within a group, a middle size beats small/large (apple takes "1 medium"), a fragment of the food
 * loses to a whole one at any size, and qualified variants ("crust not eaten", "cocktail", "dry")
 * lose; ties are settled by weight, never by dataset order. Only a food with no
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
    // Dataset rules of thumb, not servings ("Guideline amount per fl oz of beverage" = 2.5 g,
    // "Topping per surface inch of pizza"). Anchored to those phrases on purpose: a bare "per"
    // also sits inside real portions ("1 pepper", "1 personal size pizza", "1 paper cup",
    // "1 slice (15 per 8 oz package)"), and dropping those silently changes the weight.
    .filter((c) => !NOT_A_SERVING.test(c.p.label))
    .filter((c) => c.word !== '' && Number.isFinite(c.p.grams) && c.p.grams > 0)
    .filter((c) => (wanted === undefined ? true : c.words.includes(wanted)));
  const rank = (c: (typeof candidates)[number]) => [wanted === undefined ? group(c.word, c.p.label) : 0, tier(c.p.label, c.word, c.words, wanted !== undefined)];
  if (candidates.length === 0) return null;
  // Everything tied on (group, tier) is a set of equally plausible servings. Dataset row order
  // must not decide among them (a rebuild could reorder), so take the middle one by weight, then
  // label: the same "prefer the middle option" rule as sizes ("1 patty" 35 g among 20 g and 75 g
  // links). Upper median, so two tied measures give the larger ("1 fl oz" over "1 tbsp").
  const ranks = candidates.map(rank);
  const top = ranks.reduce((best, r) => (r[0]! < best[0]! || (r[0] === best[0] && r[1]! < best[1]!) ? r : best));
  const tied = candidates
    .filter((_, i) => ranks[i]![0] === top[0] && ranks[i]![1] === top[1])
    .sort((x, y) => x.p.grams - y.p.grams || (x.p.label < y.p.label ? -1 : x.p.label > y.p.label ? 1 : 0));
  const best = tied[Math.floor(tied.length / 2)];
  if (!best) return null;
  const grams = boundedGrams((count * best.p.grams) / best.n);
  return grams === null ? null : { grams, label: best.p.label };
}

/** Grams for a quantity of a food, or null; see choosePortion for the rules. Exported for tests only: production code reaches it through `resolveItems`. */
export function quantityToGrams(q: Quantity, food: DatasetFood): number | null {
  return choosePortion(q, food)?.grams ?? null;
}

/** The ref for one food at one gram amount: the only place a FoodRef is built from a DatasetFood. */
function makeRef(source: FoodSource, food: DatasetFood, grams: number, label?: string): FoodRef {
  const ref: FoodRef = { source, foodId: food.id, grams, classification: food.classification };
  if (food.fped) {
    const k = grams / 100;
    ref.fped = {
      vegCupEq: food.fped.vegCupEq * k,
      fruitCupEq: food.fped.fruitCupEq * k,
      wholeGrainOzEq: food.fped.wholeGrainOzEq * k,
    };
  }
  if (label !== undefined) ref.portionLabel = label;
  return ref;
}

/**
 * One food that is already known, at a gram amount the person set: NOTHING is searched and nothing is guessed.
 *
 * This is the path a scanned barcode takes. A scan knows exactly which product it read, so running its name back
 * through the fuzzy search would be the one place a near-miss could substitute a different food for the one in the
 * person's hand. The result is an ordinary Resolution, so the gate, the rules and the diary treat it like any
 * other entry. A non-positive or absurd gram amount yields an empty resolution rather than a bad total.
 */
export function resolveKnownFood(source: FoodSource, food: DatasetFood, grams: number, label?: string): Resolution {
  if (!Number.isFinite(grams) || grams <= 0 || grams > MAX_ITEM_GRAMS) {
    return { refs: [], nutrients: {}, coverage: {}, classification: mergeClassification([]), needsHelp: [], confidence: 0 };
  }
  const ref = makeRef(source, food, grams, label);
  const { total, coverage } = sumNutrients([scalePer100g(food.per100g, grams)]);
  return { refs: [ref], nutrients: total, coverage, classification: food.classification, needsHelp: [], confidence: 1 };
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
    refs.push(makeRef(hit.source, hit.food, chosen.grams, chosen.label));
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
