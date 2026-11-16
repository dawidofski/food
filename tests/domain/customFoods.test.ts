import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test } from 'vitest';
import { allCustomFoods, eraseEverything } from '@/data/db';
import { combineLookups, type FoodLookup } from '@/domain/foodLookup';
import { parseEntry } from '@/domain/parseEntry';
import { resolveItems } from '@/domain/resolveItems';
import {
  createCustomFood, customFoodToDatasetShape, customLookup, parseNutrientField, refreshCustomFoods, updateCustomFood,
  withCustomFoods,
} from '@/domain/customFoods';
import { dayTotals, weekContext } from '@/domain/totals';
import { computeTargets } from '@/domain/targets';
import { catalogue } from '@/rules/catalogue';
import { evaluate } from '@/rules/engine';
import type { Context } from '@/rules/types';
import type { DatasetFood } from '@/types/food';
import { ownerProfile } from '../fixtures/profile';

const FLAGS = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1 as const,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};
// A dataset that has a (different) "Frikandel" at the ordinary near-zero score, to prove precedence.
const datasetFrikandel: DatasetFood = {
  id: 'usda-frik', name: 'Frikandel, USDA', synonyms: [], per100g: { energyKcal: 999 },
  portions: [{ label: '1 serving', grams: 10 }], classification: FLAGS, allergens: [],
};
const dataset: FoodLookup = {
  search: (q) => (q.toLowerCase().includes('frikandel') ? [{ source: 'dataset', food: datasetFrikandel, score: 0.03 }] : []),
  get: (s, id) => (s === 'dataset' && id === datasetFrikandel.id ? datasetFrikandel : undefined),
};
const lookup = (): FoodLookup => withCustomFoods(dataset);

beforeEach(async () => {
  await eraseEverything();
  await refreshCustomFoods();
});

async function gateFor(text: string, flagged: string[] = []) {
  const now = new Date('2026-11-15T12:00:00Z');
  const { items } = parseEntry(text);
  const l = lookup();
  const res = resolveItems(items, l);
  const foods = res.refs.flatMap((r) => {
    const f = l.get(r.source, r.foodId);
    return f ? [{ name: f.name, allergens: [...f.allergens], source: r.source }] : [];
  });
  const profile = { ...ownerProfile, flaggedAllergens: flagged };
  const ctx: Context = {
    pending: res, foods, rawText: text, today: dayTotals([], '2026-11-15'), week: weekContext([], now),
    targets: computeTargets(profile, now), profile, now, answers: {},
  };
  return evaluate(catalogue, ctx);
}

describe('custom foods', () => {
  test('a created custom food becomes loggable by name', async () => {
    await createCustomFood({ name: 'Frikandel', per100g: { energyKcal: 280, sodiumMg: 700 } });
    const r = resolveItems(parseEntry('one frikandel').items, lookup());
    expect(r.refs[0]!.source).toBe('custom');
    expect(r.needsHelp).toEqual([]);
    expect(r.refs[0]!.grams).toBe(100);
  });

  test('the user own food wins for their own word over a dataset hit', async () => {
    await createCustomFood({ name: 'Frikandel', per100g: { energyKcal: 280 } });
    expect(lookup().search('frikandel', 1)[0]!.source).toBe('custom');
  });

  test('found by a synonym and by a portion unit the person chose', async () => {
    await createCustomFood({
      name: 'Bitterballen', synonyms: ['bitterbal'], per100g: { energyKcal: 250 },
      referencePortion: { label: '1 piece', grams: 25 },
    });
    const a = resolveItems(parseEntry('3 bitterbal').items, lookup());
    expect(a.refs[0]!.grams).toBe(75);
    const b = resolveItems(parseEntry('2 pieces bitterballen').items, lookup());
    expect(b.needsHelp).toEqual([]);
    expect(b.refs[0]!.grams).toBe(50);
  });

  test('blank nutrients stay unknown rather than zero', async () => {
    await createCustomFood({ name: 'Frikandel', per100g: { energyKcal: 280 } });
    const r = resolveItems(parseEntry('one frikandel').items, lookup());
    expect('sodiumMg' in r.nutrients).toBe(false);
    expect(r.coverage.sodiumMg).toBe('unknown');
    const stored = (await allCustomFoods())[0]!;
    expect(Object.keys(stored.nutrientsPer100g)).toEqual(['energyKcal']);
  });

  test('undefined and null nutrient values are dropped, not stored as zero', async () => {
    const f = await createCustomFood({
      name: 'Frikandel',
      per100g: { energyKcal: 280, sodiumMg: undefined, proteinG: null as unknown as undefined },
    });
    expect(f.nutrientsPer100g).toEqual({ energyKcal: 280 });
  });

  test('a real zero is kept as a known zero, and a bad number is refused', async () => {
    const f = await createCustomFood({ name: 'Water-ish', per100g: { sodiumMg: 0 } });
    expect(f.nutrientsPer100g.sodiumMg).toBe(0);
    await expect(createCustomFood({ name: 'x', per100g: { sodiumMg: Number.NaN } })).rejects.toThrow(RangeError);
    await expect(createCustomFood({ name: 'x', per100g: { fatG: -1 } })).rejects.toThrow(RangeError);
    await expect(createCustomFood({ name: '  ' })).rejects.toThrow();
    await expect(createCustomFood({ name: 'x', referencePortion: { label: '1 serving', grams: 0 } })).rejects.toThrow();
  });

  test('editing can clear a value back to unknown', async () => {
    const f = await createCustomFood({ name: 'Frikandel', per100g: { energyKcal: 280, sodiumMg: 700 } });
    const g = await updateCustomFood(f.id, { name: 'Frikandel', per100g: { energyKcal: 280 } });
    expect(g.id).toBe(f.id);
    expect((await allCustomFoods())[0]!.nutrientsPer100g).toEqual({ energyKcal: 280 });
    expect(resolveItems(parseEntry('frikandel').items, lookup()).coverage.sodiumMg).toBe('unknown');
  });

  test('a rule needing an unknown nutrient stays silent for a custom food', async () => {
    await createCustomFood({ name: 'Frikandel', per100g: { energyKcal: 280 } }); // no sodium entered
    const { cards } = await gateFor('one frikandel');
    expect(cards.find((c) => c.nutrientKey === 'sodiumMg')).toBeUndefined();
  });

  test('control: the same food WITH a large sodium figure does raise the sodium card', async () => {
    await createCustomFood({ name: 'Frikandel', per100g: { energyKcal: 280, sodiumMg: 4000 } });
    const { cards } = await gateFor('three frikandel');
    expect(cards.some((c) => c.nutrientKey === 'sodiumMg')).toBe(true);
  });

  test('classification flags on a custom food still drive their rules', async () => {
    await createCustomFood({ name: 'Frikandel', classification: { processedMeat: true } });
    const { cards } = await gateFor('one frikandel');
    expect(cards.map((c) => c.ruleId)).toContain('processed-meat');
  });

  test('allergen tags on a custom food reach the allergen rule', async () => {
    await createCustomFood({ name: 'Frikandel', allergens: ['gluten'] });
    const { cards } = await gateFor('one frikandel', ['wheat']);
    expect(cards.map((c) => c.ruleId)).toContain('allergen-flagged');
  });

  test('the adapter emits simple portion labels and never invents nutrients', async () => {
    const f = await createCustomFood({
      name: 'Frikandel', referencePortion: { label: 'Stuk (approx., fried!)', grams: 75 },
    });
    const d = customFoodToDatasetShape(f);
    expect(d.portions[0]).toEqual({ label: '1 serving', grams: 75 });
    expect(d.portions.every((p) => /^1 [a-z]+$/.test(p.label))).toBe(true);
    expect(d.per100g).toEqual({});
    expect(customLookup.get('custom', f.id)?.name).toBe('Frikandel');
    expect(combineLookups(customLookup).get('dataset', f.id)).toBeUndefined();
  });
});

describe('parseNutrientField', () => {
  test('blank and whitespace are unknown, never zero', () => {
    expect(parseNutrientField('')).toEqual({ ok: true, value: undefined });
    expect(parseNutrientField('   ')).toEqual({ ok: true, value: undefined });
  });
  test('numbers parse, comma decimals included, a typed 0 is a real zero', () => {
    expect(parseNutrientField('12.5')).toEqual({ ok: true, value: 12.5 });
    expect(parseNutrientField('12,5')).toEqual({ ok: true, value: 12.5 });
    expect(parseNutrientField('0')).toEqual({ ok: true, value: 0 });
  });
  test('junk is an error, not a zero and not NaN', () => {
    for (const bad of ['abc', '-3', '1e999', 'Infinity', 'NaN', '1.2.3', '12g']) {
      expect(parseNutrientField(bad).ok).toBe(false);
    }
  });
});
