import { describe, expect, test } from 'vitest';
import { parseEntry } from '@/domain/parseEntry';
import { quantityToGrams, resolveItems } from '@/domain/resolveItems';
import { combineLookups, type FoodLookup } from '@/domain/foodLookup';
import { buildSearchIndex, search } from '@/data/foodSearch';
import type { DatasetFood } from '@/types/food';

const FLAGS = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1 as const,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};

// 1088 mg per 100 g x 114 g = 1240.3 mg, so the arithmetic is genuinely exercised.
const hotDog: DatasetFood = {
  id: 'hotdog', name: 'Frankfurter, beef', synonyms: ['hot dog'],
  per100g: { energyKcal: 290, sodiumMg: 1088, proteinG: 10, addedSugarsG: 1 },
  portions: [{ label: '1 frankfurter', grams: 57 }, { label: '1 oz', grams: 28.35 }],
  classification: { ...FLAGS, processedMeat: true, redMeat: true, novaGroup: 4 }, allergens: [],
};
const oliveOil: DatasetFood = {
  id: 'oil', name: 'Olive oil', synonyms: [],
  per100g: { energyKcal: 884, fatG: 100 },
  portions: [{ label: '1 tbsp', grams: 13.5 }, { label: '1 cup', grams: 216 }],
  classification: { ...FLAGS, novaGroup: 2 }, allergens: [],
};
const oilNoTbsp: DatasetFood = { ...oliveOil, portions: [{ label: '1 cup', grams: 216 }] };
// Sodium and added sugars were never recorded for this one.
const mystery: DatasetFood = {
  id: 'mystery', name: 'Mystery food', synonyms: [],
  per100g: { energyKcal: 100, proteinG: 5 },
  portions: [{ label: '1 regular', grams: 80 }],
  classification: FLAGS, allergens: [],
};
const egg: DatasetFood = {
  id: 'egg', name: 'Egg, whole', synonyms: [], per100g: { energyKcal: 143 },
  portions: [{ label: '1 large', grams: 50 }], classification: FLAGS, allergens: ['egg'],
};

function lookupOf(foods: DatasetFood[]): FoodLookup {
  const index = buildSearchIndex(foods);
  const byId = new Map(foods.map((f) => [f.id, f]));
  return {
    search: (q, limit) => search(index, q, limit).map((h) => ({ source: 'dataset' as const, food: h.food, score: h.score })),
    get: (source, id) => (source === 'dataset' ? byId.get(id) : undefined),
  };
}
const fixtureLookup = lookupOf([hotDog, oliveOil, mystery, egg]);
const lookupWithoutTbsp = lookupOf([hotDog, oilNoTbsp]);
const lookupWithPartialData = lookupOf([mystery]);

describe('resolveItems', () => {
  test('two hot dogs resolves to 114 g and sums nutrients', () => {
    const r = resolveItems(parseEntry('two hot dogs').items, fixtureLookup);
    expect(r.refs[0]!.grams).toBe(114);
    expect(r.nutrients.sodiumMg).toBeCloseTo(1240, 0);
  });

  test('an unmatched food is returned for help rather than guessed', () => {
    const r = resolveItems(parseEntry('one frikandel').items, fixtureLookup);
    expect(r.refs).toEqual([]);
    expect(r.needsHelp[0]!.foodQuery).toBe('frikandel');
  });

  test('a kitchen unit with no matching portion row needs help', () => {
    const r = resolveItems(parseEntry('2 tbsp olive oil').items, lookupWithoutTbsp);
    expect(r.needsHelp).toHaveLength(1);
  });

  test('zero and negative quantities are rejected before the gate', () => {
    expect(resolveItems(parseEntry('0 hot dogs').items, fixtureLookup).refs).toEqual([]);
    expect(resolveItems(parseEntry('-2 eggs').items, fixtureLookup).refs).toEqual([]);
  });

  test('a very large quantity scales honestly with no NaN or Infinity', () => {
    const r = resolveItems(parseEntry('50 hot dogs').items, fixtureLookup);
    expect(r.refs[0]!.grams).toBe(2850);
    expect(Object.values(r.nutrients).every(Number.isFinite)).toBe(true);
  });

  test('unknown nutrients stay absent through resolution', () => {
    const r = resolveItems(parseEntry('one mystery food').items, lookupWithPartialData);
    expect('addedSugarsG' in r.nutrients).toBe(false);
    expect(r.coverage.addedSugarsG).toBe('unknown');
  });

  test('absurd magnitudes go to needsHelp, never into a total', () => {
    for (const text of ['1e299 kg hot dogs', '99999999 kg hot dogs', '500 kg hot dogs', '100000 hot dogs']) {
      const items = parseEntry(text).items;
      expect(items.length, text).toBeGreaterThan(0);
      const r = resolveItems(items, fixtureLookup);
      expect(r.refs, text).toEqual([]);
      expect(r.nutrients, text).toEqual({});
      expect(r.needsHelp, text).toHaveLength(items.length);
    }
    const ok = resolveItems(parseEntry('100 kg hot dogs').items, fixtureLookup);
    expect(ok.refs[0]!.grams).toBe(100000);
  });

  test('non-finite quantities are rejected defensively', () => {
    for (const quantity of [{ grams: NaN }, { grams: Infinity }, { count: NaN }, { count: -Infinity }, {}]) {
      const r = resolveItems([{ rawFragment: 'x', quantity, foodQuery: 'hot dogs' }], fixtureLookup);
      expect(r.refs).toEqual([]);
      expect(r.needsHelp).toHaveLength(1);
    }
  });

  test('one resolved item and one needing help: the resolved one still counts', () => {
    const r = resolveItems(parseEntry('two hot dogs and a frikandel').items, fixtureLookup);
    expect(r.refs).toHaveLength(1);
    expect(r.refs[0]!.grams).toBe(114);
    expect(r.nutrients.sodiumMg).toBeCloseTo(1240, 0);
    expect(r.needsHelp.map((i) => i.foodQuery)).toEqual(['frikandel']);
    expect(r.classification.processedMeat).toBe(true);
  });

  test('a nutrient unknown on one food is partial, and the known part is not zero-filled', () => {
    const r = resolveItems(parseEntry('a hot dog and a mystery food').items, fixtureLookup);
    expect(r.coverage.sodiumMg).toBe('partial');
    expect(r.nutrients.sodiumMg).toBeCloseTo(1088 * 0.57, 5);
  });

  test('gram quantities and kitchen units resolve', () => {
    expect(resolveItems(parseEntry('200 g hot dog').items, fixtureLookup).refs[0]!.grams).toBe(200);
    const r = resolveItems(parseEntry('2 tbsp olive oil').items, fixtureLookup);
    expect(r.refs[0]).toMatchObject({ source: 'dataset', foodId: 'oil', grams: 27, portionLabel: '1 tbsp' });
  });

  test('nothing resolved gives confidence 0; resolved entries sit near 1', () => {
    expect(resolveItems(parseEntry('one frikandel').items, fixtureLookup).confidence).toBe(0);
    expect(resolveItems(parseEntry('two hot dogs').items, fixtureLookup).confidence).toBeGreaterThan(0.5);
  });
});

describe('quantityToGrams', () => {
  test('bare counts use the first single-item portion, skipping measures', () => {
    expect(quantityToGrams({ count: 3 }, hotDog)).toBe(171);
    expect(quantityToGrams({ count: 2 }, mystery)).toBe(160);
  });
  test('a food with only measure portions has no natural serving', () => {
    expect(quantityToGrams({ count: 1 }, oilNoTbsp)).toBeNull();
  });
  test('unit labels match case-insensitively and tolerate the leading number', () => {
    expect(quantityToGrams({ count: 2, unitLabel: 'TBSP' }, oliveOil)).toBe(27);
    expect(quantityToGrams({ count: 1, unitLabel: 'cup' }, oliveOil)).toBe(216);
    expect(quantityToGrams({ count: 1, unitLabel: 'tsp' }, oliveOil)).toBeNull();
  });
});

describe('combineLookups', () => {
  test('merges sources by score and routes get by source', () => {
    const customEgg = { ...egg, id: 'c1' };
    const custom: FoodLookup = {
      search: () => [{ source: 'custom', food: customEgg, score: 0.01 }],
      get: (s, id) => (s === 'custom' && id === 'c1' ? customEgg : undefined),
    };
    const both = combineLookups(custom, fixtureLookup);
    expect(both.search('egg')[0]!.source).toBe('custom');
    expect(both.get('custom', 'c1')?.id).toBe('c1');
    expect(both.get('dataset', 'egg')?.id).toBe('egg');
    expect(resolveItems(parseEntry('an egg').items, both).refs[0]!.source).toBe('custom');
  });
});
