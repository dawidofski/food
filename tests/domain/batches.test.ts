import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test } from 'vitest';
import { eraseEverything, getBatch } from '@/data/db';
import {
  batchLookup, buildBatch, rebuildBatch, recook, refreshBatches, saveBatch, withBatches,
} from '@/domain/batches';
import { parseEntry } from '@/domain/parseEntry';
import { resolveItems } from '@/domain/resolveItems';
import { fixtureBatchTotals, fixtureLookup, pastaLines } from '../fixtures/batchFoods';

const input = { name: 'Chicken pasta', portionCount: 4, ingredientLines: pastaLines };

beforeEach(async () => {
  await eraseEverything();
  await refreshBatches();
});

describe('buildBatch', () => {
  test('a four-portion batch divides summed ingredient nutrients by four', () => {
    const { batch, needsHelp } = buildBatch(input, fixtureLookup);
    expect(needsHelp).toEqual([]);
    expect(batch.nutrientsPerPortion.energyKcal).toBeCloseTo(fixtureBatchTotals.energyKcal / 4, 1);
    expect(batch.nutrientsPerPortion.energyKcal).toBeCloseTo(413.42, 1);
    expect(batch.portionsRemaining).toBe(4);
    expect(batch.coverage.energyKcal).toBe('known');
  });

  test('total cooked weight never rescales nutrients', () => {
    const a = buildBatch({ ...input, totalCookedGrams: 2000 }, fixtureLookup).batch;
    const b = buildBatch({ ...input, totalCookedGrams: undefined }, fixtureLookup).batch;
    const c = buildBatch({ ...input, totalCookedGrams: 777 }, fixtureLookup).batch;
    expect(a.nutrientsPerPortion).toEqual(b.nutrientsPerPortion);
    expect(c.nutrientsPerPortion).toEqual(b.nutrientsPerPortion);
    expect(a.totalCookedGrams).toBe(2000);
  });

  test('batch classification inherits the worst case from its ingredients', () => {
    const { batch } = buildBatch({ ...input, ingredientLines: [...pastaLines, '2 slices bacon'] }, fixtureLookup);
    expect(batch.classification.processedMeat).toBe(true);
    expect(batch.classification.novaGroup).toBe(4);
    expect(batch.classification.refinedGrain).toBe(true);
  });

  test('an unresolved ingredient is reported rather than silently dropped', () => {
    const { batch, needsHelp } = buildBatch({ ...input, ingredientLines: [...pastaLines, '300 g frikandel'] }, fixtureLookup);
    expect(needsHelp).toHaveLength(1);
    expect(needsHelp[0]!.foodQuery).toBe('frikandel');
    // Kept as an ingredient with no refs, so an edit can retry it, and every figure is now only a floor.
    expect(batch.ingredients.find((i) => i.text.includes('frikandel'))?.refs).toEqual([]);
    expect(batch.coverage.energyKcal).toBe('partial');
  });

  test('a fragment that is not a food word at all is reported too', () => {
    const { needsHelp } = buildBatch({ ...input, ingredientLines: [...pastaLines, '???'] }, fixtureLookup);
    expect(needsHelp).toHaveLength(1);
  });

  test('coverage is partial when one ingredient lacks a nutrient', () => {
    const { batch } = buildBatch({ ...input, ingredientLines: [...pastaLines, '2 tbsp mystery sauce'] }, fixtureLookup);
    expect(batch.coverage.addedSugarsG).toBe('partial');
    expect(batch.coverage.energyKcal).toBe('known');
    expect(batch.nutrientsPerPortion.fibreG).toBeUndefined(); // nobody knew it: absent, not zero
  });

  test('nothing is NaN or Infinity, and an absent nutrient stays absent', () => {
    const { batch } = buildBatch(input, fixtureLookup);
    for (const v of Object.values(batch.nutrientsPerPortion)) expect(Number.isFinite(v)).toBe(true);
    expect('fibreG' in batch.nutrientsPerPortion).toBe(false);
  });

  test('bad portion counts and cooked weights are refused', () => {
    for (const portionCount of [0, -1, 2.5, Number.NaN, 1000]) {
      expect(() => buildBatch({ ...input, portionCount }, fixtureLookup)).toThrow(RangeError);
    }
    expect(() => buildBatch({ ...input, totalCookedGrams: 0 }, fixtureLookup)).toThrow(RangeError);
    expect(() => buildBatch({ ...input, name: '  ' }, fixtureLookup)).toThrow(RangeError);
  });

  test('a weighed pasta ingredient is flagged as read at cooked weight; other ingredients are not', () => {
    const { cookedWeightNotes } = buildBatch(input, fixtureLookup);
    expect(cookedWeightNotes).toHaveLength(1);
    expect(cookedWeightNotes[0]).toMatchObject({ ingredient: '500 g penne', grams: 500 });
  });

  test('pasta given as a count or cup is not flagged: only a weight is ambiguous between dry and cooked', () => {
    const { cookedWeightNotes } = buildBatch({ ...input, ingredientLines: ['2 cups pasta', '300 g chicken breast'] }, fixtureLookup);
    expect(cookedWeightNotes).toEqual([]);
  });

  test('allergens of the ingredients carry onto the batch', () => {
    expect(buildBatch(input, fixtureLookup).batch.allergens).toEqual(['gluten']);
  });
});

describe('recook and rebuildBatch', () => {
  test('recook resets the portion counter without re-entering ingredients', () => {
    const { batch } = buildBatch(input, fixtureLookup);
    const done = recook({ ...batch, portionsRemaining: 0 });
    expect(done.portionsRemaining).toBe(4);
    expect(done.ingredients).toEqual(batch.ingredients);
    expect(done.nutrientsPerPortion).toEqual(batch.nutrientsPerPortion);
  });

  test('editing the portion count re-divides and moves the counter by the same amount', () => {
    const { batch } = buildBatch(input, fixtureLookup);
    const eaten = { ...batch, portionsRemaining: 3 };
    const eight = rebuildBatch(eaten, { portionCount: 8 }, fixtureLookup).batch;
    expect(eight.nutrientsPerPortion.energyKcal).toBeCloseTo(fixtureBatchTotals.energyKcal / 8, 1);
    expect(eight.portionsRemaining).toBe(7);
    expect(eight.id).toBe(batch.id);
    const two = rebuildBatch(eaten, { portionCount: 2 }, fixtureLookup).batch;
    expect(two.portionsRemaining).toBe(1);
  });

  test('editing ingredients recomputes from the stored ingredient text', () => {
    const { batch } = buildBatch(input, fixtureLookup);
    const same = rebuildBatch(batch, {}, fixtureLookup).batch;
    expect(same.nutrientsPerPortion.energyKcal).toBeCloseTo(batch.nutrientsPerPortion.energyKcal!, 6);
    const more = rebuildBatch(batch, { ingredientLines: [...batch.ingredients.map((i) => i.text), '2 slices bacon'] }, fixtureLookup).batch;
    expect(more.classification.processedMeat).toBe(true);
    expect(more.nutrientsPerPortion.energyKcal).toBeGreaterThan(batch.nutrientsPerPortion.energyKcal!);
  });

  test('clearing the cooked weight on edit removes it', () => {
    const { batch } = buildBatch({ ...input, totalCookedGrams: 2000 }, fixtureLookup);
    expect(rebuildBatch(batch, { totalCookedGrams: undefined }, fixtureLookup).batch.totalCookedGrams).toBeUndefined();
  });
});

describe('the batch provider', () => {
  test('a saved batch is found by name and by "a portion of", as one portion', async () => {
    const { batch } = buildBatch({ ...input, totalCookedGrams: 2000 }, fixtureLookup);
    await saveBatch(batch);
    const lookup = withBatches(fixtureLookup);
    for (const text of ['chicken pasta', 'a portion of chicken pasta']) {
      const r = resolveItems(parseEntry(text).items, lookup);
      expect(r.needsHelp).toEqual([]);
      expect(r.refs[0]!.source).toBe('batch');
      expect(r.refs[0]!.portionLabel).toBe('1 portion');
      expect(r.refs[0]!.grams).toBeCloseTo(500, 6);
      expect(r.nutrients.energyKcal).toBeCloseTo(batch.nutrientsPerPortion.energyKcal!, 6);
    }
    const two = resolveItems(parseEntry('2 portions of chicken pasta').items, lookup);
    expect(two.nutrients.energyKcal).toBeCloseTo(batch.nutrientsPerPortion.energyKcal! * 2, 6);
    expect(two.classification).toEqual(batch.classification);
  });

  test('without a cooked weight a portion still resolves to exactly the portion nutrients', async () => {
    const { batch } = buildBatch(input, fixtureLookup);
    await saveBatch(batch);
    const r = resolveItems(parseEntry('a portion of chicken pasta').items, withBatches(fixtureLookup));
    expect(r.nutrients.energyKcal).toBeCloseTo(batch.nutrientsPerPortion.energyKcal!, 6);
  });

  test('saving persists the batch, and erasing everything empties the provider', async () => {
    const { batch } = buildBatch(input, fixtureLookup);
    await saveBatch(batch);
    expect((await getBatch(batch.id))?.name).toBe('Chicken pasta');
    expect(batchLookup.search('chicken pasta', 1)).toHaveLength(1);
    await eraseEverything();
    expect(batchLookup.search('chicken pasta', 1)).toHaveLength(0);
  });
});
