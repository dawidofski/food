import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  addEntry, allBatches, allCustomFoods, allEntriesIncludingTombstones, deleteEntry, eraseEverything, getProfile,
  lsKey, putBatch, putCustomFood, putProfile, reviseEntry,
} from '@/data/db';
import { exportAll, importAll } from '@/data/exportImport';
import { setApiKey } from '@/state/aiSettings';
import type { Batch, CustomFood, DiaryEntry } from '@/types/diary';
import type { ClassificationFlags } from '@/types/nutrients';
import type { Profile } from '@/types/profile';
import { ownerProfile } from '../fixtures/profile';

const flags: ClassificationFlags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};

const entry = (id: string, over: Partial<DiaryEntry> = {}): DiaryEntry => ({
  id,
  at: '2026-11-10T12:00:00.000Z',
  rawText: 'a meal',
  resolution: 'local',
  items: [{ source: 'dataset', foodId: 'f1', grams: 100, classification: flags }],
  nutrients: { energyKcal: 500, proteinG: 20 },
  coverage: { energyKcal: 'known', proteinG: 'known' },
  classification: flags,
  warningsShown: [],
  userAction: 'added',
  state: 'active',
  ...over,
});

const food: CustomFood = {
  id: 'cf1', name: 'My soup', nutrientsPer100g: { energyKcal: 50 }, classification: flags, allergens: ['celery'],
  referencePortion: { label: 'bowl', grams: 300 }, synonyms: [],
};
const batch: Batch = {
  id: 'b1', name: 'Chilli', ingredients: [{ text: 'beans', refs: [] }], portionCount: 4, portionsRemaining: 3,
  nutrientsPerPortion: { energyKcal: 400 }, coverage: { energyKcal: 'known' }, classification: flags,
  cookedAt: '2026-11-10T10:00:00.000Z',
};

/** Entries (one active, one tombstone, one superseded pair), a custom food, a batch, a profile and a setting. */
async function seedEverything(): Promise<number> {
  await addEntry(entry('e1'));
  await addEntry(entry('e2'));
  await deleteEntry('e2');
  await addEntry(entry('e3'));
  await reviseEntry('e3', { ...entry('ignored'), rawText: 'a revised meal' });
  await putCustomFood(food);
  await putBatch(batch);
  await putProfile(ownerProfile);
  localStorage.setItem(lsKey('ai.enabled'), '1');
  return (await allEntriesIncludingTombstones()).length + 2; // entries + 1 custom food + 1 batch
}

const file = (text: string | Blob) => new File([text], 'diary.json');
const snapshot = async () => ({
  entries: await allEntriesIncludingTombstones(),
  foods: await allCustomFoods(),
  batches: await allBatches(),
  profile: await getProfile(),
  ls: { ...localStorage },
});

beforeEach(async () => {
  await eraseEverything();
});
afterEach(() => vi.restoreAllMocks());

describe('export and import', () => {
  test('export then import into an empty store restores everything, tombstones and superseded rows included', async () => {
    const records = await seedEverything();
    const before = await snapshot();
    const blob = await exportAll();
    await eraseEverything();
    expect(await allEntriesIncludingTombstones()).toHaveLength(0);
    const r = await importAll(file(blob), 'replace');
    expect(r).toEqual({ added: records, skipped: 0 });
    const after = await snapshot();
    expect(after.entries).toHaveLength(4);
    expect(after.entries.map((e) => e.state).sort()).toEqual(['active', 'active', 'deleted', 'superseded']);
    expect(after.entries).toEqual(before.entries);
    expect(after.foods).toEqual(before.foods);
    expect(after.batches).toEqual(before.batches);
    expect(after.profile).toEqual(before.profile);
    expect(after.ls[lsKey('ai.enabled')]).toBe('1');
  });

  test('the export never contains the DeepSeek key', async () => {
    await seedEverything();
    setApiKey('test-key-abcd1234');
    const text = await (await exportAll()).text();
    expect(text).not.toContain('abcd1234');
  });

  test('merge import does not duplicate entries already present', async () => {
    const records = await seedEverything();
    const blob = await exportAll();
    const { added, skipped } = await importAll(file(blob), 'merge');
    expect(added).toBe(0);
    expect(skipped).toBe(records);
    expect(await allEntriesIncludingTombstones()).toHaveLength(4);
    expect(await allCustomFoods()).toHaveLength(1);
    expect(await allBatches()).toHaveLength(1);
  });

  test('merge adds only what is missing, keeps local rows as they are and keeps the local profile', async () => {
    await seedEverything();
    const blob = await exportAll();
    await deleteEntry('e1'); // local now differs from the file
    const other: Profile = { ...ownerProfile, heightCm: 180 };
    await putProfile(other);
    await addEntry(entry('only-local'));
    const parsed = JSON.parse(await blob.text());
    parsed.entries.push(entry('extra'));
    const r = await importAll(file(JSON.stringify(parsed)), 'merge');
    expect(r).toEqual({ added: 1, skipped: 6 });
    const entries = await allEntriesIncludingTombstones();
    expect(entries.map((e) => e.id)).toContain('extra');
    expect(entries.find((e) => e.id === 'e1')?.state).toBe('deleted'); // not resurrected by the file
    expect(entries.map((e) => e.id)).toContain('only-local');
    expect((await getProfile())?.heightCm).toBe(180);
  });

  test('replace makes the store match the file, dropping what the file does not have', async () => {
    await seedEverything();
    const blob = await exportAll();
    await addEntry(entry('only-local'));
    await importAll(file(blob), 'replace');
    expect((await allEntriesIncludingTombstones()).map((e) => e.id)).not.toContain('only-local');
  });

  test('a profile holding only flags round-trips', async () => {
    await putProfile({ weightLog: [], flaggedAllergens: ['peanuts'], conditions: [] });
    const blob = await exportAll();
    await eraseEverything();
    await importAll(file(blob), 'replace');
    expect(await getProfile()).toEqual({ weightLog: [], flaggedAllergens: ['peanuts'], conditions: [] });
  });

  test('export and import carry body fat and the goal', async () => {
    await putProfile({ ...ownerProfile, bodyFatPct: 23, goal: { kind: 'lose', rateKgPerWeek: 0.5 } });
    const blob = await exportAll();
    await eraseEverything();
    await importAll(file(blob), 'replace');
    const p = await getProfile();
    expect(p?.bodyFatPct).toBe(23);
    expect(p?.goal).toEqual({ kind: 'lose', rateKgPerWeek: 0.5 });
  });

  test('an import with no goal leaves it absent, not defaulted to hold', async () => {
    // Absent means unknown. A profile that never stated a goal has not chosen to hold steady.
    await putProfile(ownerProfile);
    const blob = await exportAll();
    await eraseEverything();
    await importAll(file(blob), 'replace');
    const p = await getProfile();
    expect(p).not.toBeNull();
    expect(p?.goal).toBeUndefined();
    expect('goal' in (p ?? {})).toBe(false);
    expect(p?.bodyFatPct).toBeUndefined();
    expect('bodyFatPct' in (p ?? {})).toBe(false);
  });

  test('a stated hold goal stays a hold, and a body fat of 0 is kept as a value, not read as absent', async () => {
    await putProfile({ ...ownerProfile, bodyFatPct: 0, goal: { kind: 'hold' } });
    const blob = await exportAll();
    await eraseEverything();
    await importAll(file(blob), 'replace');
    const p = await getProfile();
    expect(p?.goal).toEqual({ kind: 'hold' });
    expect(p?.bodyFatPct).toBe(0);
  });

  describe('untrusted body-composition and goal values are dropped, not imported', () => {
    const importWith = async (extra: Record<string, unknown>) => {
      const g = JSON.parse(await (await exportAll()).text());
      g.profile = { ...ownerProfile, ...extra };
      await eraseEverything();
      await importAll(file(JSON.stringify(g)), 'replace');
      return getProfile();
    };
    beforeEach(async () => {
      await putProfile(ownerProfile);
    });

    test.each([
      ['a string', '23'],
      ['null', null],
      ['a non-finite value', 1e999],
    ])('body fat that is %s is dropped, the rest of the profile imports', async (_n, v) => {
      const p = await importWith({ bodyFatPct: v });
      expect('bodyFatPct' in (p ?? {})).toBe(false);
      expect(p?.heightCm).toBe(ownerProfile.heightCm);
    });

    test.each([
      ['a kind outside the union', { kind: 'bulk' }],
      ['no kind', { rateKgPerWeek: 0.5 }],
      ['not an object', 'lose'],
      ['null', null],
      ['a list', []],
    ])('a goal with %s is dropped, and not defaulted to hold', async (_n, v) => {
      const p = await importWith({ goal: v });
      expect('goal' in (p ?? {})).toBe(false);
      expect(p?.goal).toBeUndefined();
    });

    test('a goal whose rate is not a finite number keeps its kind and loses the rate', async () => {
      const p = await importWith({ goal: { kind: 'gain', rateKgPerWeek: 'fast' } });
      expect(p?.goal).toEqual({ kind: 'gain' });
    });

    test('a goal keeps only the fields it defines', async () => {
      const p = await importWith({ goal: { kind: 'lose', rateKgPerWeek: 0.25, extra: 'x' } });
      expect(p?.goal).toEqual({ kind: 'lose', rateKgPerWeek: 0.25 });
    });
  });

  test('replace with a file that has no profile removes the local one', async () => {
    await putProfile(ownerProfile);
    const parsed = JSON.parse(await (await exportAll()).text());
    parsed.profile = null;
    await importAll(file(JSON.stringify(parsed)), 'replace');
    expect(await getProfile()).toBeNull();
  });
});

describe('a malformed import changes nothing', () => {
  const good = async () => JSON.parse(await (await exportAll()).text());
  const cases: [string, (g: any) => unknown][] = [
    ['not JSON at all', () => '{oops'],
    ['JSON but not an export', () => ({ hello: 'world' })],
    ['an array', () => []],
    ['a newer format version', (g) => ({ ...g, version: 999 })],
    ['entries is not a list', (g) => ({ ...g, entries: {} })],
    ['one entry with a non-numeric nutrient', (g) => ({ ...g, entries: [...g.entries, entry('bad', { nutrients: { energyKcal: 'lots' as unknown as number } })] })],
    ['one entry with an unknown state', (g) => ({ ...g, entries: [...g.entries, entry('bad', { state: 'zombie' as never })] })],
    ['one entry with an unparseable time', (g) => ({ ...g, entries: [...g.entries, entry('bad', { at: 'yesterday-ish' })] })],
    ['an entry with no id', (g) => ({ ...g, entries: [...g.entries, { ...entry('x'), id: undefined }] })],
    ['duplicate ids inside the file', (g) => ({ ...g, entries: [...g.entries, g.entries[0]] })],
    ['a custom food with a null portion weight', (g) => ({ ...g, customFoods: [{ ...food, id: 'cf2', referencePortion: { label: 'x', grams: null } }] })],
    ['a batch with no ingredients list', (g) => ({ ...g, batches: [{ ...batch, id: 'b2', ingredients: undefined }] })],
    ['a profile with an invalid sex', (g) => ({ ...g, profile: { ...ownerProfile, sex: 'robot' } })],
    ['a profile with an impossible birth date', (g) => ({ ...g, profile: { ...ownerProfile, dob: '2026-13-45' } })],
    ['a settings value that is not text', (g) => ({ ...g, settings: { [lsKey('x')]: 5 } })],
    ['a settings key outside the app prefix', (g) => ({ ...g, settings: { 'other.key': '1' } })],
  ];
  const textOf = (m: unknown) => (typeof m === 'string' ? m : JSON.stringify(m));

  test.each(cases)('%s, in replace mode', async (_name, mutate) => {
    await seedEverything();
    const g = await good();
    const before = await snapshot();
    await expect(importAll(file(textOf(mutate(g))), 'replace')).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });

  test.each(cases)('%s, in merge mode', async (_name, mutate) => {
    await seedEverything();
    const g = await good();
    const before = await snapshot();
    await expect(importAll(file(textOf(mutate(g))), 'merge')).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });

  test('a storage failure part-way through leaves both stores as they were', async () => {
    await seedEverything();
    const blob = await exportAll();
    await addEntry(entry('only-local'));
    const before = await snapshot();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await expect(importAll(file(blob), 'replace')).rejects.toThrow();
    vi.restoreAllMocks();
    expect(await snapshot()).toEqual(before);
  });
});
