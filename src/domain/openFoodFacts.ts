/**
 * Reading one Open Food Facts product into this app's shapes.
 *
 * Open Food Facts is a crowdsourced database: anyone may edit any product, there is no laboratory behind a figure,
 * and a field can be wrong, stale or missing. Everything in this module is therefore written to the same rule the
 * rest of the project runs on, only harder:
 *
 *   AN ABSENT VALUE IS UNKNOWN, NEVER ZERO — and a value this app cannot trust is treated as absent.
 *
 * THE RULING THIS MODULE EXISTS TO ENFORCE. `added-sugars_100g` is NOT imported, ever. Probed on 16 Nov 2026:
 * Coca-Cola Original Taste carries `sugars_100g: 10.6` and `added-sugars_100g: 0`; LU Prince biscuits carry
 * `sugars_100g: 32` and `added-sugars_100g: 0`. Both are plainly false. This app reads a present key as a KNOWN
 * value, so importing that zero would make the added-sugar rule say "0 g of added sugar, known" for a cola and
 * STAY SILENT — exactly the failure the invariant exists to prevent. Nutella's 52.13 is right, and is refused too:
 * one rule with no exceptions beats a rule that has to judge each value. The sugar-sweetened-drink rule keys on
 * classification, not on added sugar, so a scanned cola still warns.
 *
 * Trans fat, vitamins and minerals are not imported either; the reasons are at IMPORTED_NUTRIENTS and in
 * docs/build-log-barcode.md.
 */
import type { DatasetFood, OffProduct } from '@/types/food';
import type { ClassificationFlags, NutrientKey, NutrientSet } from '@/types/nutrients';

export type { OffProduct };

/* The mapped product's shape lives in `@/types/food` as `OffProduct`, so `@/data/db` can store it without
   importing this module. Every field is documented there. */

export type OffLookupResult =
  | { kind: 'found'; product: OffProduct }
  | { kind: 'not-found' }
  | { kind: 'unusable'; reason: string };

/**
 * The only nutrients read from Open Food Facts, and what each one's field means.
 *
 * `sodium_100g` IS IN GRAMS, not milligrams (LU Prince: `sodium_100g: 0.196` beside `salt_100g: 0.49`), so it is
 * multiplied by 1000. Getting that wrong would put every scanned product a thousandfold under on sodium.
 *
 * Deliberately absent, each for a stated reason:
 *  - `added-sugars`: demonstrable false zeros. See the module comment. Never, under any circumstances.
 *  - `trans-fat`: EU labels do not have to carry trans fat, so any figure here is an editor's contribution rather
 *    than a label reading, and the same false-zero risk applies with none of the evidence that settled added
 *    sugars. A judgement by analogy, recorded as such; revisit it only with a probe of real products.
 *  - vitamins and minerals (`calcium_100g`, `iron_100g`, `vitamin-c_100g`, `vitamin-d_100g`, …): their units in
 *    this API were NOT verified against a real product. None of the three products probed carries one. A unit
 *    error here is the 1000x mistake the sodium note is about, so they are not read at all.
 */
const IMPORTED_NUTRIENTS: { key: NutrientKey; field: string; factor: number; label: string }[] = [
  { key: 'energyKcal', field: 'energy-kcal', factor: 1, label: 'energy' },
  { key: 'proteinG', field: 'proteins', factor: 1, label: 'protein' },
  { key: 'fatG', field: 'fat', factor: 1, label: 'fat' },
  { key: 'satFatG', field: 'saturated-fat', factor: 1, label: 'saturated fat' },
  { key: 'carbG', field: 'carbohydrates', factor: 1, label: 'carbohydrate' },
  { key: 'sugarsG', field: 'sugars', factor: 1, label: 'total sugars' },
  { key: 'fibreG', field: 'fiber', factor: 1, label: 'fibre' },
  // grams -> milligrams.
  { key: 'sodiumMg', field: 'sodium', factor: 1000, label: 'sodium' },
];

/** Per 100 g. A figure above these is a data-entry error, not a food, and the product is refused rather than logged. */
const CEILING: Partial<Record<NutrientKey, number>> = {
  energyKcal: 1000, proteinG: 100, fatG: 100, satFatG: 100, carbG: 100, sugarsG: 100, fibreG: 100, sodiumMg: 100_000,
};

const NEVER_IMPORTED_FIELD = 'added-sugars';

// ---- small readers that never throw on a surprising payload ----

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  // Open Food Facts sometimes stores a figure as a string.
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function tags(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** "en:sulphur-dioxide-and-sulphites" -> "sulphur-dioxide-and-sulphites". Any language prefix, not just `en:`. */
const stripTagPrefix = (t: string): string => t.replace(/^[a-z]{2,3}:/i, '').trim();

/**
 * Open Food Facts carries the EU's 14 allergen groups under `en:` tags whose names are mostly this app's own tag
 * words already. Only the two that differ are mapped; everything else keeps the tag's own word, which the allergen
 * rule folds and singularises before matching, and which can still match a tag the person typed themselves.
 */
const ALLERGEN_TAG_NAMES: Record<string, string> = {
  'sulphur-dioxide-and-sulphites': 'sulphites',
  'sesame-seeds': 'sesame',
  'tree-nuts': 'nuts',
  'cereals-containing-gluten': 'gluten',
};

function allergenWords(list: string[]): string[] {
  const out: string[] = [];
  for (const t of list) {
    const bare = stripTagPrefix(t).toLowerCase();
    if (bare === '') continue;
    out.push(ALLERGEN_TAG_NAMES[bare] ?? bare);
  }
  return [...new Set(out)];
}

// ---- classification ----

/**
 * What is, and is not, read from `categories_tags`. These flags drive warnings, so each decision is recorded.
 *
 * SET:
 *  - `alcohol`: the `en:alcoholic-beverages` category, or a positive alcohol figure. Unambiguous either way.
 *  - `sweetDrink`: a beverage whose own sugars figure is at least 1 g per 100, excluding juices and milk drinks
 *    (scripts/classification.ts: "sugar-sweetened soft/fruit/energy drinks. 100% juice, milk drinks and diet
 *    drinks are not"). The decision rests on the product's OWN sugar figure, not on a category guess, so a diet
 *    cola (sugars 0) is not flagged while Coca-Cola Original (10.6) is. An unsweetened plant drink with natural
 *    sugars could be flagged in error; the cost is one INFO card.
 *  - `novaGroup`: only when the payload gives one. See `novaOf`.
 *
 * NOT SET, and said so to the person:
 *  - `redMeat`, `processedMeat`: Open Food Facts' meat categories are contributed per product and are often absent
 *    on exactly the products that need them. A tag that IS present would be trustworthy, but a rule built on
 *    present-tags-only would still read as "checked, nothing found" to anyone looking at the gate, because the
 *    absence of a card cannot be told from a clean result. Rather than let a scanned chorizo be quietly treated as
 *    not-processed-meat, this module sets neither flag and the review panel states plainly that those two warnings
 *    do not work for a scanned product.
 *  - `refinedGrain`, `vegetable`, `fruit`, `legume`, `oilyFish`: no rule in the catalogue reads them today, and
 *    nothing in Open Food Facts maps onto them cleanly. FPED cup-equivalents do not exist here at all, so a
 *    scanned product contributes no vegetable or fruit amount — absent, which is unknown.
 */
const BEVERAGE = 'en:beverages';
const ALCOHOLIC = 'en:alcoholic-beverages';
const NOT_A_SWEET_DRINK = ['en:fruit-juices', 'en:vegetable-juices', 'en:milks', 'en:dairy-drinks'];
/** At least this many grams of sugar per 100 before a drink counts as sweetened, so a trace does not flag it. */
const SWEET_DRINK_MIN_SUGARS = 1;

export const NO_FLAGS: ClassificationFlags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};

/**
 * The NOVA group, or null when the payload does not give one.
 *
 * The payload can carry two copies that DISAGREE: Nutella has `product.nova_group: 3` and
 * `product.nutriments['nova-group']: 4`. The worse of the two wins, which is the same "worst case wins" rule
 * `mergeClassification` already applies to a mixed entry, and it errs toward showing the ultra-processed card
 * rather than toward silence. Only group 4 is read by any rule.
 */
function novaOf(product: Record<string, unknown>, nutriments: Record<string, unknown>): 1 | 2 | 3 | 4 | null {
  const candidates = [num(product['nova_group']), num(nutriments['nova-group'])]
    .filter((n): n is number => n !== undefined && Number.isInteger(n) && n >= 1 && n <= 4);
  if (candidates.length === 0) return null;
  return Math.max(...candidates) as 1 | 2 | 3 | 4;
}

// ---- the mapping ----

type Basis = { suffix: string; scale: number };

/**
 * Which set of fields holds the figures, and what to multiply them by to get per 100 g.
 *
 * `nutrition_data_per` is READ, never assumed. "100g" means the `_100g` fields are already per 100. "serving"
 * means the `_serving` fields are per serving and need the serving weight to be any use at all; without one the
 * product is refused rather than scaled by a guess. Anything else — including the field being missing — is
 * refused too: a basis this app has not seen is not a basis it may invent.
 */
function basisOf(product: Record<string, unknown>): { ok: true; basis: Basis } | { ok: false; reason: string } {
  const per = str(product['nutrition_data_per']);
  if (per === '100g') return { ok: true, basis: { suffix: '_100g', scale: 1 } };
  if (per === 'serving') {
    const serving = num(product['serving_quantity']);
    if (serving === undefined || !(serving > 0)) {
      return {
        ok: false,
        reason:
          'Open Food Facts gives this product’s figures per serving but does not say how much a serving weighs, ' +
          'so the amounts cannot be worked out.',
      };
    }
    return { ok: true, basis: { suffix: '_serving', scale: 100 / serving } };
  }
  return {
    ok: false,
    reason: per === undefined
      ? 'Open Food Facts does not say whether this product’s figures are per 100 g or per serving, so they cannot be used.'
      : `Open Food Facts gives this product’s figures per “${per}”, which this app cannot read.`,
  };
}

/** The product's display name, preferring the Spanish entry: the owner shops in Spain and the `es.` host is used. */
function nameOf(product: Record<string, unknown>): string | undefined {
  return str(product['product_name_es']) ?? str(product['product_name']) ?? str(product['product_name_en']) ?? str(product['generic_name']);
}

function brandOf(product: Record<string, unknown>): string | undefined {
  const fromTags = tags(product['brands_tags'])[0];
  const fromText = str(product['brands'])?.split(',')[0]?.trim();
  return str(fromText) ?? str(fromTags);
}

/**
 * Reads a payload from `GET /api/v2/product/{barcode}.json`.
 *
 * `status: 1` is found, `status: 0` is not found. Anything else — a captive portal's HTML, a truncated body, a
 * product with no name or no nutrition at all — is `unusable` with a sentence the screen can show, never a
 * half-built product.
 */
export function mapOffPayload(raw: unknown, fetchedAtISO: string): OffLookupResult {
  if (!isObj(raw)) return { kind: 'unusable', reason: 'Open Food Facts sent something this app could not read.' };
  const status = num(raw['status']);
  if (status === 0) return { kind: 'not-found' };
  if (status !== 1 || !isObj(raw['product'])) {
    return { kind: 'unusable', reason: 'Open Food Facts sent something this app could not read.' };
  }
  const product = raw['product'];
  const barcode = str(raw['code']) ?? str(product['code']);
  if (barcode === undefined) return { kind: 'unusable', reason: 'The reply carried no barcode, so it cannot be matched to what was scanned.' };

  const name = nameOf(product);
  if (name === undefined) {
    return { kind: 'unusable', reason: 'Open Food Facts holds this barcode but no product name for it, so there is nothing to log it as.' };
  }

  const nutriments = isObj(product['nutriments']) ? product['nutriments'] : {};
  const basis = basisOf(product);
  if (!basis.ok) return { kind: 'unusable', reason: basis.reason };

  const per100g: NutrientSet = {};
  const missing: string[] = [];
  for (const { key, field, factor, label } of IMPORTED_NUTRIENTS) {
    const v = num(nutriments[`${field}${basis.basis.suffix}`]);
    if (v === undefined || v < 0) {
      missing.push(label);
      continue;
    }
    const scaled = v * factor * basis.basis.scale;
    const ceiling = CEILING[key];
    if (!Number.isFinite(scaled) || (ceiling !== undefined && scaled > ceiling)) {
      return {
        kind: 'unusable',
        reason: `Open Food Facts records ${label} for this product as a figure this app will not accept (${v} per 100). Nothing has been imported.`,
      };
    }
    per100g[key] = scaled;
  }
  if (Object.keys(per100g).length === 0) {
    return { kind: 'unusable', reason: 'Open Food Facts holds this product but no nutrition figures this app can use.' };
  }

  const categories = tags(product['categories_tags']).map((t) => t.toLowerCase());
  const has = (t: string) => categories.includes(t);
  const alcoholFigure = num(nutriments[`alcohol${basis.basis.suffix}`]);
  const alcohol = has(ALCOHOLIC) || (alcoholFigure !== undefined && alcoholFigure > 0);
  const sugars = per100g.sugarsG;
  const sweetDrink =
    has(BEVERAGE) && !alcohol && sugars !== undefined && sugars >= SWEET_DRINK_MIN_SUGARS && !NOT_A_SWEET_DRINK.some(has);

  const nova = novaOf(product, nutriments);
  const classification: ClassificationFlags = { ...NO_FLAGS, sweetDrink, alcohol, ...(nova !== null ? { novaGroup: nova } : {}) };

  const traces = allergenWords(tags(product['traces_tags']));
  const allergens = [...new Set([...allergenWords(tags(product['allergens_tags'])), ...traces])];

  const servingGrams = num(product['serving_quantity']);
  const lastModifiedT = num(product['last_modified_t']);
  const servingSize = str(product['serving_size']) ?? '';
  const perMlNotPerGram = has(BEVERAGE) || /\bm?l\b/i.test(servingSize) || /\b\d+\s*(?:ml|l|cl)\b/i.test(str(product['quantity']) ?? '');

  const gaps = buildGaps(missing, nova !== null, allergens, traces, perMlNotPerGram);

  const mapped: OffProduct = {
    barcode,
    name,
    per100g,
    classification,
    allergens,
    traces,
    fetchedAt: fetchedAtISO,
    perMlNotPerGram,
    novaKnown: nova !== null,
    gaps,
  };
  const brand = brandOf(product);
  if (brand !== undefined) mapped.brand = brand;
  if (servingGrams !== undefined && servingGrams > 0 && servingGrams <= 5000) mapped.servingGrams = servingGrams;
  const packSize = str(product['quantity']);
  if (packSize !== undefined) mapped.packSize = packSize;
  if (lastModifiedT !== undefined && lastModifiedT > 0) mapped.lastModified = new Date(lastModifiedT * 1000).toISOString();

  return { kind: 'found', product: mapped };
}

/**
 * What the app does NOT know about this product, in sentences a person can read. Shown before anything is logged,
 * because a scanned product that looks complete on screen is the thing most likely to be trusted too far.
 */
function buildGaps(missing: string[], novaKnown: boolean, allergens: string[], traces: string[], perMl: boolean): string[] {
  const gaps: string[] = [];
  gaps.push(
    'Added sugars: not read from Open Food Facts, and counted as unknown. The database records 0 g of added sugar ' +
      'for products that plainly contain it, so a figure from it cannot be trusted. Total sugars, above, are read.',
  );
  if (missing.length > 0) {
    gaps.push(`Open Food Facts has no figure for ${missing.join(', ')}, so ${missing.length === 1 ? 'it is' : 'they are'} counted as unknown rather than as zero.`);
  }
  gaps.push('Vitamins, minerals and trans fat are not read from Open Food Facts at all, so they are unknown for this product.');
  if (!novaKnown) {
    gaps.push('Open Food Facts does not say how processed this product is, so the ultra-processed check cannot count it.');
  }
  gaps.push(
    'The app cannot tell from Open Food Facts whether this is red or processed meat, so those two warnings will not ' +
      'appear for anything you scan. Check for yourself what the product is.',
  );
  gaps.push(
    allergens.length > 0
      ? `Allergens listed by Open Food Facts: ${allergens.join(', ')}${traces.length > 0 ? ` (${traces.join(', ')} listed as traces)` : ''}. The list is contributed by the public and may be incomplete, so read the packet.`
      : 'Open Food Facts lists no allergens for this product. That is not a statement that it contains none: these ' +
        'lists are contributed by the public and are often empty for products that do contain an allergen. Read the packet.',
  );
  if (perMl) {
    gaps.push('This looks like a drink. Open Food Facts gives a drink’s figures per 100 ml, and this app counts 1 ml as 1 g.');
  }
  return gaps;
}

/**
 * Adapts a scanned product to the shape `resolveItems`, the rules and the screens already read, so a scanned food
 * is judged by exactly the same code as any other. Nutrients are copied as stored: an absent key stays absent.
 * No `fped`, because Open Food Facts has no cup-equivalents — unknown, not zero.
 */
export function offProductToDatasetShape(p: OffProduct): DatasetFood {
  const portions = [{ label: '100 g', grams: 100 }];
  if (p.servingGrams !== undefined) portions.unshift({ label: '1 serving', grams: p.servingGrams });
  return {
    id: p.barcode,
    name: p.name,
    synonyms: [p.barcode, ...(p.brand !== undefined ? [`${p.brand} ${p.name}`] : [])],
    per100g: { ...p.per100g },
    portions,
    classification: { ...p.classification },
    allergens: [...p.allergens],
  };
}

/** Exported for the build log and for tests that assert the ban is not quietly lifted. */
export const NEVER_IMPORTED = [NEVER_IMPORTED_FIELD, 'trans-fat', 'vitamins', 'minerals'] as const;
