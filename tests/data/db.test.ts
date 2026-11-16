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
  LS_PREFIX,
  getBatch,
  getCustomFood,
  getEntry,
  getProfile,
  putBatch,
  putCustomFood,
  addEntry,
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
    await addEntry(entry({ id: 'a' }));
    await addEntry(entry({ id: 'b' }));
    await deleteEntry('b');
    expect((await entriesBetween(dayStart, dayEnd)).map(e => e.id)).toEqual(['a']);
  });

  test('deleteEntry keeps the row as a tombstone', async () => {
    await addEntry(entry({ id: 'a' })); await deleteEntry('a');
    expect((await getEntry('a'))!.state).toBe('deleted');
    expect(await allEntriesIncludingTombstones()).toHaveLength(1);
  });

  test('reviseEntry links both directions and supersedes the original', async () => {
    await addEntry(entry({ id: 'a' }));
    const next = await reviseEntry('a', entryFields({ rawText: 'one hot dog' }));
    expect((await getEntry('a'))!.supersededBy).toBe(next.id);
    expect(next.revisionOf).toBe('a');
    expect((await getEntry('a'))!.state).toBe('superseded');
  });

  test('cancelled entries are stored but excluded from the active range', async () => {
    await addEntry(entry({ id: 'c', userAction: 'cancelled', state: 'active' }));
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
    await addEntry(entry({ id: 'a' })); await putProfile(profileFixture);
    await eraseEverything();
    expect(await allEntriesIncludingTombstones()).toEqual([]);
    expect(await getProfile()).toBeNull();
  });
});

describe('beyond the brief', () => {
  test('a revision chain A -> B -> C returns only C and is walkable both ways', async () => {
    await addEntry(entry({ id: 'a' }));
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
    await addEntry(entry({ id: 'r', nutrients, coverage, rawText: '  2 Hot  dogs ' }));
    const got = (await getEntry('r'))!;
    expect(got.nutrients).toStrictEqual(nutrients);
    expect(got.coverage).toStrictEqual(coverage);
    expect('sodiumMg' in got.nutrients).toBe(false);
    expect(got.nutrients.transFatG).toBe(0);
    expect(got.rawText).toBe('  2 Hot  dogs ');
  });

  test('entriesBetween respects the range bounds and sorts by time', async () => {
    await addEntry(entry({ id: 'late', at: '2026-11-15T20:00:00.000Z' }));
    await addEntry(entry({ id: 'early', at: '2026-11-15T08:00:00.000Z' }));
    await addEntry(entry({ id: 'other', at: '2026-11-16T08:00:00.000Z' }));
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

describe('review fixes: enforced invariants', () => {
  test('addEntry refuses an existing id and leaves the stored row untouched', async () => {
    await addEntry(entry({ id: 'a', rawText: 'original' }));
    await expect(addEntry(entry({ id: 'a', rawText: 'clobber' }))).rejects.toThrow();
    expect((await getEntry('a'))!.rawText).toBe('original');
  });

  test('addEntry cannot clobber a superseded row or erase its supersededBy', async () => {
    await addEntry(entry({ id: 'a' }));
    const b = await reviseEntry('a', entryFields());
    await expect(addEntry(entry({ id: 'a' }))).rejects.toThrow();
    expect((await getEntry('a'))!.supersededBy).toBe(b.id);
    expect((await getEntry('a'))!.state).toBe('superseded');
  });

  test('addEntry cannot resurrect a tombstone', async () => {
    await addEntry(entry({ id: 'a' }));
    await deleteEntry('a');
    await expect(addEntry(entry({ id: 'a', state: 'active' }))).rejects.toThrow();
    expect((await getEntry('a'))!.state).toBe('deleted');
    expect(await entriesBetween(dayStart, dayEnd)).toEqual([]);
  });

  test.each([
    ['deleted state', { state: 'deleted' as const }],
    ['superseded state', { state: 'superseded' as const }],
    ['supersededBy set', { supersededBy: 'z' }],
    ['revisionOf set', { revisionOf: 'ghost' }],
  ])('addEntry rejects an entry arriving with %s', async (_n, over) => {
    await expect(addEntry(entry({ id: 'n', ...over }))).rejects.toThrow();
    expect(await getEntry('n')).toBeUndefined();
  });

  test('addEntry cannot fork a chain by pointing revisionOf at a superseded entry', async () => {
    await addEntry(entry({ id: 'a' }));
    await reviseEntry('a', entryFields());
    await expect(addEntry(entry({ id: 'f', revisionOf: 'a' }))).rejects.toThrow();
    expect(await getEntry('f')).toBeUndefined();
  });

  test('deleteEntry on a superseded row is a no-op and keeps the supersededBy fact', async () => {
    await addEntry(entry({ id: 'a' }));
    const b = await reviseEntry('a', entryFields());
    await deleteEntry('a');
    const a = (await getEntry('a'))!;
    expect(a.state).toBe('superseded');
    expect(a.supersededBy).toBe(b.id);
  });

  test('deleteEntry twice is harmless', async () => {
    await addEntry(entry({ id: 'a' }));
    await deleteEntry('a'); await deleteEntry('a');
    expect((await getEntry('a'))!.state).toBe('deleted');
  });
});

describe('review fixes: time handling', () => {
  test('entries exactly at dayStart and dayEnd are included (inclusive bounds)', async () => {
    await addEntry(entry({ id: 's', at: dayStart }));
    await addEntry(entry({ id: 'e', at: dayEnd }));
    await addEntry(entry({ id: 'before', at: '2026-11-14T23:59:59.999Z' }));
    await addEntry(entry({ id: 'after', at: '2026-11-16T00:00:00.000Z' }));
    expect((await entriesBetween(dayStart, dayEnd)).map(e => e.id)).toEqual(['s', 'e']);
  });

  test('at is normalised to UTC ISO on write so index order is chronological', async () => {
    await addEntry(entry({ id: 'plus1', at: '2026-11-15T13:00:00+01:00' }));
    await addEntry(entry({ id: 'noms', at: '2026-11-15T11:00:00Z' }));
    expect((await getEntry('plus1'))!.at).toBe('2026-11-15T12:00:00.000Z');
    expect((await getEntry('noms'))!.at).toBe('2026-11-15T11:00:00.000Z');
    expect((await entriesBetween(dayStart, dayEnd)).map(e => e.id)).toEqual(['noms', 'plus1']);
  });

  test('reviseEntry normalises at too', async () => {
    await addEntry(entry({ id: 'a' }));
    const b = await reviseEntry('a', entryFields({ at: '2026-11-15T14:00:00+02:00' }));
    expect(b.at).toBe('2026-11-15T12:00:00.000Z');
  });

  test('an unparseable at is rejected', async () => {
    await expect(addEntry(entry({ id: 'x', at: 'yesterday-ish' }))).rejects.toThrow();
    expect(await getEntry('x')).toBeUndefined();
  });

  test('entriesBetween returns [] when from > to instead of throwing', async () => {
    await addEntry(entry({ id: 'a' }));
    await expect(entriesBetween(dayEnd, dayStart)).resolves.toEqual([]);
  });

  test('entriesBetween accepts non-canonical bound formats', async () => {
    await addEntry(entry({ id: 'a' }));
    expect((await entriesBetween('2026-11-15T00:00:00Z', '2026-11-15T23:59:59.999Z')).map(e => e.id)).toEqual(['a']);
  });
});

describe('review fixes: no NaN or Infinity in storage', () => {
  test.each([NaN, Infinity, -Infinity])('addEntry rejects %s in nutrients', async bad => {
    await expect(addEntry(entry({ id: 'n', nutrients: { energyKcal: bad } }))).rejects.toThrow();
    expect(await getEntry('n')).toBeUndefined();
  });

  test('addEntry rejects a non-finite gram amount', async () => {
    await expect(
      addEntry(entry({ id: 'g', items: [{ source: 'dataset', foodId: 'x', grams: NaN }] })),
    ).rejects.toThrow();
  });

  test('reviseEntry rejects NaN and leaves the original active', async () => {
    await addEntry(entry({ id: 'a' }));
    await expect(reviseEntry('a', entryFields({ nutrients: { proteinG: NaN } }))).rejects.toThrow();
    expect((await getEntry('a'))!.state).toBe('active');
    expect(await allEntriesIncludingTombstones()).toHaveLength(1);
  });

  test('putBatch rejects non-finite nutrients or portions', async () => {
    await expect(putBatch(batch({ id: 'b', nutrientsPerPortion: { energyKcal: Infinity } }))).rejects.toThrow();
    await expect(putBatch(batch({ id: 'b', portionsRemaining: NaN }))).rejects.toThrow();
    expect(await getBatch('b')).toBeUndefined();
  });

  test('decrementBatchPortion on a row with a missing portionsRemaining yields 0, not NaN', async () => {
    const bad = { ...batch({ id: 'm' }) } as Partial<Batch>;
    delete bad.portionsRemaining;
    const idb = await import('idb');
    const d = await idb.openDB('food-diary');
    await d.put('batches', bad);
    d.close();
    await decrementBatchPortion('m');
    expect((await getBatch('m'))!.portionsRemaining).toBe(0);
  });
});

describe('review fixes: erase', () => {
  test('eraseEverything removes any fd.-prefixed localStorage key but not foreign keys', async () => {
    localStorage.setItem(`${LS_PREFIX}settings`, '{}');
    localStorage.setItem('other.app', 'keep');
    await putProfile(profileFixture);
    await eraseEverything();
    expect(localStorage.getItem(`${LS_PREFIX}settings`)).toBeNull();
    expect(await getProfile()).toBeNull();
    expect(localStorage.getItem('other.app')).toBe('keep');
    localStorage.removeItem('other.app');
  });
});
