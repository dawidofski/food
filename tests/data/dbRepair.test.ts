import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * A database that claims the current version but holds no object stores is the one state this app cannot recover
 * from on its own: `upgrade` does not run, every read then fails, and the owner is left with "The diary could not
 * be read" for good. It is reachable in the wild — an upgrade interrupted by a closed tab, eviction part-way
 * through, or any other script on the origin opening `food-diary` without a version number.
 *
 * Deleting it is safe because a database with no object stores has nowhere to keep a row, so there is nothing in
 * it to lose. These tests pin both halves: the broken one is replaced, and a healthy one is never touched.
 */
/**
 * Plants a database at the CURRENT version with no object stores — the one state `upgrade` cannot fix, because it
 * does not run. The version must track DB_VERSION: planted at an older version this would merely exercise the
 * ordinary upgrade path and would stop testing the repair at all, silently, the next time a store is added.
 */
function plantEmptyAtCurrentVersion(version: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('food-diary', version);
    req.onupgradeneeded = () => undefined; // deliberately without the stores
    req.onsuccess = () => { req.result.close(); resolve(); };
    req.onerror = () => reject(req.error);
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
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('food-diary');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  vi.resetModules();
});

describe('opening a diary that was left without its object stores', () => {
  test('it is rebuilt instead of failing every read for ever', async () => {
    const { DB_VERSION } = await import('@/data/db');
    await plantEmptyAtCurrentVersion(DB_VERSION);
    expect(await storeNames()).toEqual([]);

    const { addEntry, getEntry } = await import('@/data/db');
    await addEntry({
      id: 'a', at: '2026-11-16T12:00:00.000Z', rawText: 'x', resolution: 'local',
      items: [], nutrients: {}, coverage: {}, warningsShown: [], userAction: 'added', state: 'active',
      classification: {
        processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
        refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
      },
    });

    expect((await getEntry('a'))!.id).toBe('a');
    expect(await storeNames()).toEqual(expect.arrayContaining(['entries', 'customFoods', 'batches', 'offProducts']));
  });

  // The other half — that a database WITH its stores is never deleted — is already pinned by every test in
  // db.test.ts: each one writes through `open()` and reads the row back, and all of them would fail if a healthy
  // database were being discarded. A second copy here would only restate it, and cannot share a process with the
  // test above, because the module's cached connection blocks a delete.
});
