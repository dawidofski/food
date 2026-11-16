import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  allBatches,
  allCustomFoods,
  allEntriesIncludingTombstones,
  decrementBatchPortion,
  deleteEntry,
  entriesBetween,
  eraseEverything,
  getBatch,
  getCustomFood,
  getEntry,
  getProfile,
  putBatch,
  putCustomFood,
  putEntry,
  putProfile,
  reviseEntry,
} from '@/data/db';
import type { Batch, CustomFood, DiaryEntry } from '@/types/diary';
import type { ClassificationFlags } from '@/types/nutrients';
import { ownerProfile as profileFixture } from '../fixtures/profile';

const dayStart = '2026-11-15T00:00:00.000Z';
const dayEnd = '2026-11-15T23:59:59.999Z';

const flags: ClassificationFlags = {
  processedMeat: false,
  redMeat: false,
  sweetDrink: false,
  alcohol: false,
  novaGroup: 1,
  refinedGrain: false,
  vegetable: false,
  fruit: false,
  legume: false,
  oilyFish: false,
};

function entryFields(over: Partial<Omit<DiaryEntry, 'id'>> = {}): Omit<DiaryEntry, 'id'> {
  return {
    at: '2026-11-15T12:00:00.000Z',
    rawText: 'two hot dogs',
    resolution: 'local',
    items: [{ source: 'dataset', foodId: 'x', grams: 100 }],
    nutrients: { energyKcal: 250 },
    coverage: { energyKcal: 'known' },
    warningsShown: [],
    userAction: 'added',
    state: 'active',
    ...over,
  };
}

function entry(over: Partial<DiaryEntry> & { id: string }): DiaryEntry {
  return { ...entryFields(), ...over };
}

function batch(over: Partial<Batch> & { id: string }): Batch {
  return {
    name: 'chili',
    ingredients: [],
    portionCount: 4,
    nutrientsPerPortion: { energyKcal: 400 },
    coverage: { energyKcal: 'known' },
    classification: flags,
    portionsRemaining: 4,
    cookedAt: '2026-11-14T18:00:00.000Z',
    ...over,
  };
}

beforeEach(async () => {
  await eraseEverything();
});

describe('diary store', () => {
  test('entriesBetween excludes tombstoned and superseded entries', async () => {
    await putEntry(entry({ id: 'a' }));
    await putEntry(entry({ id: 'b' }));
    await deleteEntry('b');
    expect((await entriesBetween(dayStart, dayEnd)).map(e => e.id)).toEqual(['a']);
  });

  test('deleteEntry keeps the row as a tombstone', async () => {
    await putEntry(entry({ id: 'a' })); await deleteEntry('a');
    expect((await getEntry('a'))!.state).toBe('deleted');
    expect(await allEntriesIncludingTombstones()).toHaveLength(1);
  });

  test('reviseEntry links both directions and supersedes the original', async () => {
    await putEntry(entry({ id: 'a' }));
    const next = await reviseEntry('a', entryFields({ rawText: 'one hot dog' }));
    expect((await getEntry('a'))!.supersededBy).toBe(next.id);
    expect(next.revisionOf).toBe('a');
    expect((await getEntry('a'))!.state).toBe('superseded');
  });

  test('cancelled entries are stored but excluded from the active range', async () => {
    await putEntry(entry({ id: 'c', userAction: 'cancelled', state: 'active' }));
    const rows = await entriesBetween(dayStart, dayEnd);
    expect(rows.find(e => e.id === 'c')).toBeUndefined();
    expect(await getEntry('c')).toBeDefined();
  });

  test('decrementBatchPortion reduces portionsRemaining and floors at zero', async () => {
    await putBatch(batch({ id: 'p', portionsRemaining: 1 }));
    await decrementBatchPortion('p'); await decrementBatchPortion('p');
    expect((await getBatch('p'))!.portionsRemaining).toBe(0);
  });

  test('eraseEverything clears both stores', async () => {
    await putEntry(entry({ id: 'a' })); await putProfile(profileFixture);
    await eraseEverything();
    expect(await allEntriesIncludingTombstones()).toEqual([]);
    expect(await getProfile()).toBeNull();
  });
});

describe('beyond the brief', () => {
  test('a revision chain A -> B -> C returns only C and is walkable both ways', async () => {
    await putEntry(entry({ id: 'a' }));
    const b = await reviseEntry('a', entryFields({ rawText: 'b' }));
    const c = await reviseEntry(b.id, entryFields({ rawText: 'c' }));
    expect((await entriesBetween(dayStart, dayEnd)).map(e => e.id)).toEqual([c.id]);

    // forward: a -> b -> c
    const a1 = (await getEntry('a'))!;
    expect(a1.supersededBy).toBe(b.id);
    const b1 = (await getEntry(a1.supersededBy!))!;
    expect(b1.supersededBy).toBe(c.id);
    const c1 = (await getEntry(b1.supersededBy!))!;
    expect(c1.supersededBy).toBeUndefined();
    // backward: c -> b -> a
    const b2 = (await getEntry(c1.revisionOf!))!;
    expect(b2.id).toBe(b.id);
    expect((await getEntry(b2.revisionOf!))!.id).toBe('a');
    expect((await getEntry('a'))!.revisionOf).toBeUndefined();
    expect(await allEntriesIncludingTombstones()).toHaveLength(3);
  });

  test('reviseEntry on a missing original throws and writes nothing', async () => {
    await expect(reviseEntry('nope', entryFields())).rejects.toThrow();
    expect(await allEntriesIncludingTombstones()).toEqual([]);
  });

  test('decrementBatchPortion on a missing id neither throws nor creates a row', async () => {
    await expect(decrementBatchPortion('ghost')).resolves.toBeUndefined();
    expect(await getBatch('ghost')).toBeUndefined();
    expect(await allBatches()).toEqual([]);
  });

  test('deleteEntry on a missing id neither throws nor creates a row', async () => {
    await expect(deleteEntry('ghost')).resolves.toBeUndefined();
    expect(await allEntriesIncludingTombstones()).toEqual([]);
  });

  test('a stored entry round-trips nutrients and coverage, keeping absent distinct from 0', async () => {
    const nutrients = { energyKcal: 250, transFatG: 0 };
    const coverage = { energyKcal: 'known', transFatG: 'known', sodiumMg: 'unknown' } as const;
    await putEntry(entry({ id: 'r', nutrients, coverage, rawText: '  2 Hot  dogs ' }));
    const got = (await getEntry('r'))!;
    expect(got.nutrients).toEqual(nutrients);
    expect(got.coverage).toEqual(coverage);
    expect('sodiumMg' in got.nutrients).toBe(false);
    expect(got.nutrients.transFatG).toBe(0);
    expect(got.rawText).toBe('  2 Hot  dogs ');
  });

  test('entriesBetween respects the range bounds and sorts by time', async () => {
    await putEntry(entry({ id: 'late', at: '2026-11-15T20:00:00.000Z' }));
    await putEntry(entry({ id: 'early', at: '2026-11-15T08:00:00.000Z' }));
    await putEntry(entry({ id: 'other', at: '2026-11-16T08:00:00.000Z' }));
    expect((await entriesBetween(dayStart, dayEnd)).map(e => e.id)).toEqual(['early', 'late']);
  });

  test('eraseEverything on an empty store, then reads, return empty', async () => {
    await eraseEverything();
    expect(await allEntriesIncludingTombstones()).toEqual([]);
    expect(await allCustomFoods()).toEqual([]);
    expect(await allBatches()).toEqual([]);
    expect(await getProfile()).toBeNull();
  });

  test('eraseEverything removes custom foods and batches too', async () => {
    const cf: CustomFood = {
      id: 'cf',
      name: 'x',
      nutrientsPer100g: { energyKcal: 100 },
      classification: flags,
      allergens: [],
      referencePortion: { label: '1 serving', grams: 50 },
      synonyms: [],
    };
    await putCustomFood(cf);
    await putBatch(batch({ id: 'p' }));
    expect(await getCustomFood('cf')).toEqual(cf);
    await eraseEverything();
    expect(await allCustomFoods()).toEqual([]);
    expect(await allBatches()).toEqual([]);
  });

  test('getProfile returns null on corrupt stored JSON', async () => {
    await putProfile(profileFixture);
    expect(await getProfile()).toEqual(profileFixture);
    localStorage.setItem('fd.profile', '{not json');
    expect(await getProfile()).toBeNull();
  });
});
