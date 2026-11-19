import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { closeDiaryDb } from '@/data/db';

/**
 * Each test imports a FRESH copy of the db module, which opens a connection of its own. That connection has to
 * be closed before the next test deletes the database, or the delete is blocked and the next upgrade never
 * runs — which shows up as a timeout rather than as anything resembling the real problem.
 */
let closeLast: (() => Promise<void>) | null = null;

/**
 * The version 5 bump, which added `fileHandles`.
 *
 * The risky part of any new store is not the new store: it is the real diary already on the phone at the old
 * version. This plants one at version 4 — the version the previous feature shipped — and at version 3, and
 * opens at the new one.
 */

const plant = (version: number, stores: [string, string][]) =>
  new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('food-diary', version);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const [name, keyPath] of stores) {
        const s = d.createObjectStore(name, { keyPath });
        if (name === 'entries') s.createIndex('at', 'at');
      }
    };
    req.onsuccess = () => {
      const d = req.result;
      const tx = d.transaction(['entries', 'customFoods'], 'readwrite');
      tx.objectStore('entries').put({ id: 'precious', rawText: 'a real meal' });
      tx.objectStore('customFoods').put({ id: 'mine', name: 'my own food' });
      tx.oncomplete = () => { d.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });

const V3: [string, string][] = [
  ['entries', 'id'], ['customFoods', 'id'], ['batches', 'id'], ['offProducts', 'barcode'], ['healthDays', 'date'],
];
const V4: [string, string][] = [...V3, ['savedMeals', 'id']];

beforeEach(async () => {
  if (closeLast) await closeLast();
  closeLast = null;
  await closeDiaryDb();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('food-diary');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

describe('adding the fileHandles store', () => {
  test('a version 4 diary keeps everything and gains the new store', async () => {
    await plant(4, V4);
    vi.resetModules();
    const mod = await import('@/data/db');
    closeLast = mod.closeDiaryDb;
    const { getEntry, allCustomFoods, putFileHandle, getFileHandle, allSavedMeals } = mod;

    expect((await getEntry('precious'))?.rawText).toBe('a real meal');
    expect((await allCustomFoods()).map((f) => f.name)).toEqual(['my own food']);
    // The store added by the previous version is still there and still readable.
    expect(await allSavedMeals()).toEqual([]);

    await putFileHandle({ id: 'autoBackup', handle: {} as FileSystemFileHandle, name: 'f.json', chosenAt: '2026-11-01T00:00:00.000Z' });
    expect((await getFileHandle('autoBackup'))?.name).toBe('f.json');
    expect((await getEntry('precious'))?.rawText).toBe('a real meal');
  });

  test('a version 3 diary — two versions behind — survives the same way', async () => {
    await plant(3, V3);
    vi.resetModules();
    const mod = await import('@/data/db');
    closeLast = mod.closeDiaryDb;
    const { getEntry, putFileHandle, getFileHandle, putSavedMeal, allSavedMeals } = mod;

    expect((await getEntry('precious'))?.rawText).toBe('a real meal');
    // Both stores added since are created, not just the newest one.
    await putFileHandle({ id: 'autoBackup', handle: {} as FileSystemFileHandle, name: 'f.json', chosenAt: '2026-11-01T00:00:00.000Z' });
    await putSavedMeal({ id: 'm1', name: 'a meal', savedAt: '2026-11-01T00:00:00.000Z', refs: [{ source: 'dataset', foodId: 'f1', grams: 100, classification: { processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1, refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false } }] });
    expect(await getFileHandle('autoBackup')).toBeDefined();
    expect(await allSavedMeals()).toHaveLength(1);
  });
});
