import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test } from 'vitest';
import { eraseEverything, getBatch } from '@/data/db';
import {
  batchHasCustomIngredient, batchToDatasetShape, batchLookup, batchWeightKnown, buildBatch, deleteBatch, isCookedGrain, rebuildBatch,
  refreshBatches, saveBatch, withBatches,
} from '@/domain/batches';
import type { FoodLookup } from '@/domain/foodLookup';
import { parseEntry } from '@/domain/parseEntry';
import { resolveItems } from '@/domain/resolveItems';
import type { DatasetFood } from '@/types/food';
import { bacon, chicken, lookupOf, mysterySauce, oil, pasta, passata } from '../fixtures/batchFoods';

const withFped = (f: DatasetFood, fped: DatasetFood['fped']): DatasetFood => (fped ? { ...f, fped } : f);
const Z = { vegCupEq: 0, fruitCupEq: 0, wholeGrainOzEq: 0 };
const allFped = lookupOf([
  withFped(pasta, { ...Z, wholeGrainOzEq: 0.5 }),
  withFped(passata, { ...Z, vegCupEq: 0.5 }),
  withFped(chicken, Z),
  withFped(oil, Z),
]);
const input = { name: 'Chicken pasta', portionCount: 4, ingredientLines: ['500 g penne', '400 g passata', '300 g chicken breast', '2 tbsp olive oil'] };

beforeEach(async () => {
  await eraseEverything();
  await refreshBatches();
});

describe('fped on a batch', () => {
  test('is the ingredients summed and divided by the portion count', () => {
    const { batch } = buildBatch(input, allFped);
    // pasta 500 g x 0.5 oz/100 g = 2.5; passata 400 g x 0.5 cup/100 g = 2.0
    expect(batch.fped!.wholeGrainOzEq).toBeCloseTo(2.5 / 4, 6);
    expect(batch.fped!.vegCupEq).toBeCloseTo(2 / 4, 6);
    expect(batch.fped!.fruitCupEq).toBe(0);
  });

  test('is absent when any ingredient lacks FPED data, never a partial total', () => {
    const lookup = lookupOf([withFped(pasta, Z), withFped(passata, Z), chicken /* no fped */, withFped(oil, Z)]);
    expect(buildBatch(input, lookup).batch.fped).toBeUndefined();
  });

  test('is absent when an ingredient could not be resolved', () => {
    const { batch } = buildBatch({ ...input, ingredientLines: [...input.ingredientLines, '300 g frikandel'] }, allFped);
    expect(batch.fped).toBeUndefined();
  });

  test('a rebuild drops a stale fped when the new ingredients lack it', () => {
    const { batch } = buildBatch(input, allFped);
    expect(batch.fped).toBeDefined();
    const mixed = lookupOf([withFped(pasta, Z), withFped(passata, Z), chicken, withFped(oil, Z)]);
    expect(rebuildBatch(batch, {}, mixed).batch.fped).toBeUndefined();
  });

  test('a logged portion carries the per-portion FPED, so a vegetable soup counts as vegetables', async () => {
    const { batch } = buildBatch({ ...input, totalCookedGrams: 2000 }, allFped);
    await saveBatch(batch);
    const r = resolveItems(parseEntry('a portion of chicken pasta').items, withBatches(allFped));
    expect(r.refs[0]!.fped!.vegCupEq).toBeCloseTo(0.5, 6);
    const none = buildBatch(input, allFped).batch; // without a cooked weight too
    await saveBatch({ ...none, id: 'batch-b', name: 'Other pasta' });
    const r2 = resolveItems(parseEntry('a portion of other pasta').items, withBatches(allFped));
    expect(r2.refs[0]!.fped!.vegCupEq).toBeCloseTo(0.5, 6);
    expect(r2.refs[0]!.fped!.wholeGrainOzEq).toBeCloseTo(2.5 / 4, 6);
  });
});

describe('weight and origin', () => {
  test('the provider knows whether a batch weight was ever given', async () => {
    const a = buildBatch({ ...input, totalCookedGrams: 2000 }, allFped).batch;
    const b = { ...buildBatch(input, allFped).batch, id: 'batch-b', name: 'Other pasta' };
    await saveBatch(a);
    await saveBatch(b);
    expect(batchWeightKnown(a.id)).toBe(true);
    expect(batchWeightKnown(b.id)).toBe(false);
  });

  test('a batch inherits the self-reported marking when any ingredient was a custom food', async () => {
    const asCustom: FoodLookup = {
      search: (q, l) => allFped.search(q, l).map((h) => (h.food.id === 'f-chicken' ? { ...h, source: 'custom' as const } : h)),
      get: (s, id) => allFped.get('dataset', id) ?? (s === 'custom' ? allFped.get('dataset', id) : undefined),
    };
    const custom = buildBatch(input, asCustom).batch;
    const plain = { ...buildBatch(input, allFped).batch, id: 'batch-b', name: 'Other pasta' };
    expect(custom.selfReported).toBe(true);
    expect(plain.selfReported).toBeUndefined();
    await saveBatch(custom);
    await saveBatch(plain);
    expect(batchHasCustomIngredient(custom.id)).toBe(true);
    expect(batchHasCustomIngredient(plain.id)).toBe(false);
  });
});

describe('deleteBatch', () => {
  test('removes the batch from storage and from search, and is a no-op for an unknown id', async () => {
    const { batch } = buildBatch(input, allFped);
    await saveBatch(batch);
    expect(batchLookup.search('chicken pasta', 1)).toHaveLength(1);
    await deleteBatch(batch.id);
    expect(await getBatch(batch.id)).toBeUndefined();
    expect(batchLookup.search('chicken pasta', 1)).toHaveLength(0);
    expect(batchLookup.get('batch', batch.id)).toBeUndefined();
    await expect(deleteBatch('nope')).resolves.toBeUndefined();
  });
});

describe('isCookedGrain', () => {
  test('plain cooked grains match; dishes, cereals, milks and dry foods do not', () => {
    for (const n of ['Pasta, cooked', 'Rice, white, cooked', 'Noodles, cooked', 'Couscous, plain, cooked', 'Quinoa, no added fat', 'Rice noodles, cooked', 'Bulgur, no added fat', 'Barley']) {
      expect(isCookedGrain(n), n).toBe(true);
    }
    for (const n of ['Oats, raw', 'Oat milk', 'Rice milk', 'Rice cake', 'Cookie, oatmeal', 'Beef and rice, no sauce', 'Pasta with tomato-based sauce, home recipe', 'Rice, fried, with beef', 'Spaghetti sauce', 'Rice, white, raw', 'Pasta, dry', 'Macaroni or noodles with cheese', 'Noodles, chow mein']) {
      expect(isCookedGrain(n), n).toBe(false);
    }
  });
});

void bacon;

describe('a batch whose ingredients disagree about a nutrient', () => {
  // Pasta knows sodium; mystery sauce records energy only. The batch total for sodium is a floor, not a total.
  const mixed = lookupOf([pasta, mysterySauce]);
  const mixedInput = { name: 'Sauced pasta', portionCount: 2, ingredientLines: ['200 g penne', '100 g mystery sauce'] };

  test('the batch itself is partial for that nutrient', () => {
    const { batch } = buildBatch(mixedInput, mixed);
    expect(batch.coverage.sodiumMg).toBe('partial');
    expect(batch.coverage.energyKcal).toBe('known');
  });

  test('a logged portion does not claim the floor as a known figure', async () => {
    const { batch } = buildBatch(mixedInput, mixed);
    await saveBatch(batch);
    const r = resolveItems(parseEntry('a portion of sauced pasta').items, withBatches(mixed));
    expect(r.refs[0]!.source).toBe('batch');
    expect(r.coverage.sodiumMg).not.toBe('known');
    expect(r.nutrients.sodiumMg).toBeUndefined();
    expect(r.coverage.energyKcal).toBe('known');
    expect(r.nutrients.energyKcal).toBeGreaterThan(0);
  });

  test('the adapter omits every nutrient whose batch coverage is not known', () => {
    const { batch } = buildBatch(mixedInput, mixed);
    const shape = batchToDatasetShape(batch);
    expect(shape.per100g.sodiumMg).toBeUndefined();
    expect(shape.per100g.energyKcal).toBeDefined();
  });
});
