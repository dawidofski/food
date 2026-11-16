import { describe, expect, test } from 'vitest';
import { mapOffPayload, offProductToDatasetShape, type OffProduct } from '@/domain/openFoodFacts';
import { coca_cola, coca_cola_zero, lu_prince, not_found, nutella } from '../fixtures/off/payloads';

const FETCHED = '2026-11-16T19:00:00.000Z';

function found(raw: unknown): OffProduct {
  const r = mapOffPayload(raw, FETCHED);
  if (r.kind !== 'found') throw new Error(`expected a product, got ${r.kind}`);
  return r.product;
}

describe('reading an Open Food Facts payload', () => {
  test('status 0 is "not found", not an empty product', () => {
    expect(mapOffPayload(not_found, FETCHED)).toEqual({ kind: 'not-found' });
  });

  test('a payload that is not an object at all is reported, never guessed at', () => {
    expect(mapOffPayload(null, FETCHED).kind).toBe('unusable');
    expect(mapOffPayload('<html>503</html>', FETCHED).kind).toBe('unusable');
    expect(mapOffPayload({ status: 1 }, FETCHED).kind).toBe('unusable');
  });

  // THE RULING THIS WHOLE FEATURE TURNS ON.
  test('added sugars is never imported, because Open Food Facts records a false zero for it', () => {
    // The payload says so outright, and the app still refuses it.
    expect(coca_cola.product.nutriments['added-sugars_100g']).toBe(0);
    expect(lu_prince.product.nutriments['added-sugars_100g']).toBe(0);

    expect(found(coca_cola).per100g.addedSugarsG).toBeUndefined();
    expect('addedSugarsG' in found(coca_cola).per100g).toBe(false);
    expect('addedSugarsG' in found(lu_prince).per100g).toBe(false);
    // Not even when the figure is plainly right: one rule, no exceptions, so nothing has to judge the value.
    expect(nutella.product.nutriments['added-sugars_100g']).toBe(52.13);
    expect('addedSugarsG' in found(nutella).per100g).toBe(false);
  });

  test('a scanned cola still reaches the sweet-drink rule, which keys on classification', () => {
    expect(found(coca_cola).classification.sweetDrink).toBe(true);
  });

  test('sodium is read as grams and converted to milligrams', () => {
    // LU Prince: sodium_100g 0.196 g = 196 mg. Reading it as mg would be 1000x under.
    expect(found(lu_prince).per100g.sodiumMg).toBeCloseTo(196, 6);
    expect(found(nutella).per100g.sodiumMg).toBeCloseTo(42.8, 6);
  });

  test('the gram-per-100 g nutrients come across unchanged', () => {
    const p = found(lu_prince).per100g;
    expect(p.energyKcal).toBe(467);
    expect(p.proteinG).toBe(6.3);
    expect(p.fatG).toBe(17);
    expect(p.satFatG).toBe(5.6);
    expect(p.carbG).toBe(69);
    expect(p.sugarsG).toBe(32);
    expect(p.fibreG).toBe(4);
  });

  test('a nutrient Open Food Facts does not carry stays absent, and is named as a gap', () => {
    const payload = structuredClone(lu_prince) as typeof lu_prince;
    delete (payload.product.nutriments as Record<string, unknown>)['fiber_100g'];
    const p = found(payload);
    expect('fibreG' in p.per100g).toBe(false);
    expect(p.gaps.join(' ')).toMatch(/fibre/i);
  });

  test('a nutrient that is present and zero is kept as a known zero', () => {
    // Coca-Cola really does have no fat and no protein; that is the label's own figure, not a missing one.
    expect(found(coca_cola).per100g.fatG).toBe(0);
    expect(found(coca_cola).per100g.proteinG).toBe(0);
  });

  test('vitamins, minerals and trans fat are never imported, and the gaps say so', () => {
    const p = found(nutella);
    for (const k of ['calciumMg', 'ironMg', 'vitaminCMg', 'vitaminDUg', 'vitaminB12Ug', 'folateUg', 'potassiumMg', 'magnesiumMg', 'zincMg', 'transFatG']) {
      expect(k in p.per100g).toBe(false);
    }
    expect(p.gaps.join(' ')).toMatch(/vitamin/i);
    expect(p.gaps.join(' ')).toMatch(/trans fat/i);
  });

  test('allergen tags lose their language prefix and traces are folded in', () => {
    const p = found(lu_prince);
    expect(p.allergens).toEqual(expect.arrayContaining(['eggs', 'gluten', 'milk', 'soybeans']));
    expect(p.traces).toEqual(['eggs']);
    expect(found(nutella).allergens).toEqual(expect.arrayContaining(['milk', 'nuts', 'soybeans']));
  });

  test('an empty allergen list is never read as "no allergens"', () => {
    const p = found(coca_cola);
    expect(p.allergens).toEqual([]);
    expect(p.gaps.join(' ')).toMatch(/allergen/i);
    // The sentence must not be readable as an all-clear.
    expect(p.gaps.join(' ')).not.toMatch(/allergen-free|free of allergens|no allergens present/i);
  });

  test('NOVA is taken as the worse of the two figures the payload carries, and only when present', () => {
    // Nutella: product.nova_group 3, nutriments['nova-group'] 4. The worse one drives the rule.
    expect(nutella.product.nova_group).toBe(3);
    expect(nutella.product.nutriments['nova-group']).toBe(4);
    const p = found(nutella);
    expect(p.classification.novaGroup).toBe(4);
    expect(p.novaKnown).toBe(true);

    const payload = structuredClone(nutella) as typeof nutella;
    delete (payload.product as Record<string, unknown>)['nova_group'];
    delete (payload.product.nutriments as Record<string, unknown>)['nova-group'];
    const q = found(payload);
    expect(q.novaKnown).toBe(false);
    expect(q.classification.novaGroup).toBe(1);
    expect(q.gaps.join(' ')).toMatch(/processed/i);
  });

  test('a diet drink is not a sugar-sweetened drink', () => {
    expect(coca_cola_zero.product.nutriments.sugars_100g).toBe(0);
    expect(found(coca_cola_zero).classification.sweetDrink).toBe(false);
  });

  test('red meat and processed meat are never inferred, and the gaps say they were not checked', () => {
    const p = found(lu_prince);
    expect(p.classification.redMeat).toBe(false);
    expect(p.classification.processedMeat).toBe(false);
    expect(p.gaps.join(' ')).toMatch(/red or processed meat/i);
  });

  test('figures given per serving are converted using the serving weight', () => {
    const payload = {
      code: '1111111111116',
      status: 1,
      product: {
        product_name: 'Per-serving product',
        nutrition_data_per: 'serving',
        serving_quantity: 50,
        last_modified_t: 1794469430,
        nutriments: { 'energy-kcal_serving': 100, proteins_serving: 5, sodium_serving: 0.1 },
      },
    };
    const p = found(payload);
    expect(p.per100g.energyKcal).toBeCloseTo(200, 6);
    expect(p.per100g.proteinG).toBeCloseTo(10, 6);
    expect(p.per100g.sodiumMg).toBeCloseTo(200, 6);
  });

  test('figures given per serving with no serving weight are refused, not guessed', () => {
    const r = mapOffPayload(
      { code: '1', status: 1, product: { product_name: 'x', nutrition_data_per: 'serving', nutriments: { 'energy-kcal_serving': 100 } } },
      FETCHED,
    );
    expect(r.kind).toBe('unusable');
    if (r.kind === 'unusable') expect(r.reason).toMatch(/serving/i);
  });

  test('a payload that does not say what its figures are per is refused', () => {
    const r = mapOffPayload({ code: '1', status: 1, product: { product_name: 'x', nutriments: { 'energy-kcal_100g': 100 } } }, FETCHED);
    expect(r.kind).toBe('unusable');
  });

  test('a drink is marked as measured per 100 ml, so the screen can say so', () => {
    expect(found(coca_cola).perMlNotPerGram).toBe(true);
    expect(found(lu_prince).perMlNotPerGram).toBe(false);
  });

  test('the last edit date and the Spanish name come through', () => {
    const p = found(lu_prince);
    expect(p.name).toBe('Príncipe Galletas de Chocolate');
    expect(p.brand).toBe('LU');
    expect(p.lastModified).toBe(new Date(1793958244 * 1000).toISOString());
    expect(p.fetchedAt).toBe(FETCHED);
    expect(p.barcode).toBe('7622210449283');
  });

  test('a product with no usable name at all is refused rather than logged as a barcode', () => {
    const r = mapOffPayload({ code: '1', status: 1, product: { nutrition_data_per: '100g', nutriments: { 'energy-kcal_100g': 1 } } }, FETCHED);
    expect(r.kind).toBe('unusable');
  });

  test('a product carrying no nutrient this app can use is refused', () => {
    const r = mapOffPayload(
      { code: '1', status: 1, product: { product_name: 'Mystery', nutrition_data_per: '100g', nutriments: { 'added-sugars_100g': 12 } } },
      FETCHED,
    );
    expect(r.kind).toBe('unusable');
    if (r.kind === 'unusable') expect(r.reason).toMatch(/nutrition/i);
  });

  test('an absurd figure is refused rather than logged', () => {
    const payload = structuredClone(lu_prince) as typeof lu_prince;
    (payload.product.nutriments as Record<string, unknown>)['energy-kcal_100g'] = 28000;
    expect(mapOffPayload(payload, FETCHED).kind).toBe('unusable');
  });
});

describe('a scanned product as a food the rest of the app can read', () => {
  test('it keeps the barcode as its id and offers the serving as a portion', () => {
    const f = offProductToDatasetShape(found(coca_cola));
    expect(f.id).toBe('5449000054227');
    expect(f.portions.some((p) => p.grams === 250)).toBe(true);
    expect(f.per100g.sugarsG).toBe(10.6);
    expect('addedSugarsG' in f.per100g).toBe(false);
    expect(f.synonyms).toEqual(expect.arrayContaining(['5449000054227']));
  });

  test('a product with no serving weight still offers 100 g', () => {
    const f = offProductToDatasetShape(found(nutella));
    expect(f.portions.length).toBeGreaterThan(0);
    expect(f.portions.every((p) => Number.isFinite(p.grams) && p.grams > 0)).toBe(true);
  });
});
