import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test, vi } from 'vitest';

type Mod = typeof import('@/data/healthDays');
type DbMod = typeof import('@/data/db');
let h: Mod;
let dbm: DbMod;

function deleteDb(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('food-diary');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

function storeNames(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('food-diary');
    req.onsuccess = () => { const n = [...req.result.objectStoreNames]; req.result.close(); resolve(n); };
    req.onerror = () => reject(req.error);
  });
}

beforeEach(async () => {
  // Close the previous test's cached connection, or the delete blocks.
  await dbm?.closeDiaryDb();
  vi.resetModules();
  await deleteDb();
  h = await import('@/data/healthDays');
  dbm = await import('@/data/db');
});

const entry = (id: string, at: string) => ({
  id, at, rawText: 'x', resolution: 'local' as const,
  items: [], nutrients: {}, coverage: {}, warningsShown: [], userAction: 'added' as const, state: 'active' as const,
  classification: {
    processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1 as const,
    refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
  },
});

test('a day round-trips with only the figures that were given', async () => {
  await h.putHealthDay({ date: '2026-11-17', steps: 8412 });
  const back = await h.getHealthDay('2026-11-17');
  expect(back).toEqual({ date: '2026-11-17', steps: 8412 });
  expect('sleepScore' in back!).toBe(false); // absent, never 0
  expect('energyBurnedKcal' in back!).toBe(false);
});

test('an explicit undefined is stored as absent, not as a key', async () => {
  await h.putHealthDay({ date: '2026-11-17', steps: 5, sleepScore: undefined });
  const back = await h.getHealthDay('2026-11-17');
  expect(Object.keys(back!).sort()).toEqual(['date', 'steps']);
});

test('the boundaries are accepted: sleep 0 and 100, steps 0, energy 0', async () => {
  await h.putHealthDay({ date: '2026-11-17', sleepScore: 100, steps: 0, energyBurnedKcal: 0 });
  expect(await h.getHealthDay('2026-11-17')).toEqual({ date: '2026-11-17', sleepScore: 100, steps: 0, energyBurnedKcal: 0 });
  await h.putHealthDay({ date: '2026-11-18', sleepScore: 0 });
  expect(await h.getHealthDay('2026-11-18')).toEqual({ date: '2026-11-18', sleepScore: 0 });
});

// Review Focus 3.
test.each([
  ['sleepScore', -1], ['sleepScore', 101], ['steps', -1],
  ['energyBurnedKcal', -1], ['steps', Number.NaN], ['energyBurnedKcal', Number.POSITIVE_INFINITY],
])('%s of %s is refused and nothing is written', async (field, value) => {
  await expect(h.putHealthDay({ date: '2026-11-17', [field]: value })).rejects.toThrow();
  expect(await h.getHealthDay('2026-11-17')).toBeUndefined();
});

test('a bad figure does not overwrite a good existing record', async () => {
  await h.putHealthDay({ date: '2026-11-17', steps: 100 });
  await expect(h.putHealthDay({ date: '2026-11-17', steps: 200, sleepScore: 500 })).rejects.toThrow();
  expect(await h.getHealthDay('2026-11-17')).toEqual({ date: '2026-11-17', steps: 100 });
});

test('a date that is not a day key is refused', async () => {
  await expect(h.putHealthDay({ date: '17/11/2026', steps: 1 })).rejects.toThrow();
});

test('a record with every figure cleared removes the row', async () => {
  await h.putHealthDay({ date: '2026-11-17', sleepScore: 80, steps: 9000, energyBurnedKcal: 2400 });
  expect(await h.getHealthDay('2026-11-17')).toBeDefined();
  await h.putHealthDay({ date: '2026-11-17' });
  expect(await h.getHealthDay('2026-11-17')).toBeUndefined();
  expect(await h.healthDaysBetween('2026-11-01', '2026-11-30')).toEqual([]);
  // clearing a day that never existed writes nothing
  await h.putHealthDay({ date: '2026-11-20' });
  expect(await h.healthDaysBetween('2026-11-01', '2026-11-30')).toEqual([]);
});

// Review Focus 4.
test('a health day saves on a date with no food entries, and both survive', async () => {
  await dbm.addEntry(entry('e1', '2026-11-10T12:00:00.000Z'));
  await h.putHealthDay({ date: '2026-11-17', sleepScore: 72 });
  expect(await dbm.entriesBetween('2026-11-17T00:00:00.000Z', '2026-11-17T23:59:59.999Z')).toEqual([]);
  expect(await h.getHealthDay('2026-11-17')).toEqual({ date: '2026-11-17', sleepScore: 72 });
  expect((await dbm.getEntry('e1'))!.id).toBe('e1');
  // and a day with food gets its health figures without touching the entry
  await h.putHealthDay({ date: '2026-11-10', steps: 3000 });
  expect((await dbm.getEntry('e1'))!.rawText).toBe('x');
  expect(await h.getHealthDay('2026-11-10')).toEqual({ date: '2026-11-10', steps: 3000 });
});

// Review Focus 5.
describe('upgrading', () => {
  test('an existing database with entries gains the store without losing them', async () => {
    // Plant a version-2 database as the previous release left it: four stores, no healthDays, one entry.
    await dbm.closeDiaryDb();
    vi.resetModules();
    await deleteDb();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('food-diary', 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        const entries = d.createObjectStore('entries', { keyPath: 'id' });
        entries.createIndex('at', 'at');
        entries.put(entry('old', '2026-11-16T12:00:00.000Z'));
        d.createObjectStore('customFoods', { keyPath: 'id' });
        d.createObjectStore('batches', { keyPath: 'id' });
        d.createObjectStore('offProducts', { keyPath: 'barcode' });
      };
      req.onsuccess = () => { req.result.close(); resolve(); };
      req.onerror = () => reject(req.error);
    });

    const db3 = await import('@/data/db');
    const hd = await import('@/data/healthDays');
    dbm = db3;
    // Not pinned to a literal: the claim is that a database written before healthDays existed gains the
    // store and keeps its entries, which stays true as later stores raise the version.
    expect(db3.DB_VERSION).toBeGreaterThanOrEqual(3);
    expect((await db3.getEntry('old'))!.id).toBe('old');
    expect(await storeNames()).toEqual(
      expect.arrayContaining(['entries', 'customFoods', 'batches', 'offProducts', 'healthDays']),
    );
    await hd.putHealthDay({ date: '2026-11-17', steps: 1 });
    expect(await hd.getHealthDay('2026-11-17')).toEqual({ date: '2026-11-17', steps: 1 });
    expect((await db3.getEntry('old'))!.id).toBe('old'); // still there after the write
  });
});

test('healthDaysBetween returns the range inclusive, oldest first, and excludes days outside it', async () => {
  for (const [date, steps] of [['2026-11-19', 3], ['2026-11-15', 1], ['2026-11-17', 2], ['2026-11-14', 9], ['2026-11-20', 9]] as const) {
    await h.putHealthDay({ date, steps });
  }
  const got = await h.healthDaysBetween('2026-11-15', '2026-11-19');
  expect(got.map((d) => d.date)).toEqual(['2026-11-15', '2026-11-17', '2026-11-19']);
  expect(await h.healthDaysBetween('2026-11-19', '2026-11-15')).toEqual([]);
});

test('erasing everything clears health days too', async () => {
  await h.putHealthDay({ date: '2026-11-17', steps: 1 });
  await dbm.eraseEverything();
  expect(await h.getHealthDay('2026-11-17')).toBeUndefined();
});

test('a misspelt key is refused rather than clearing the day', async () => {
  await h.putHealthDay({ date: '2026-11-17', steps: 100 });
  // an untyped caller, such as an imported backup, can hand over a key the type does not allow
  const typo = { date: '2026-11-17', step: 5 } as unknown as import('@/types/health').HealthDay;
  await expect(h.putHealthDay(typo)).rejects.toThrow(/unknown key: step/);
  expect(await h.getHealthDay('2026-11-17')).toEqual({ date: '2026-11-17', steps: 100 });
  const extra = { date: '2026-11-17', steps: 7, note: 'x' } as unknown as import('@/types/health').HealthDay;
  await expect(h.putHealthDay(extra)).rejects.toThrow(/unknown key: note/);
});
