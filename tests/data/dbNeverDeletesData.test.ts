import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The near-miss that `dbRepair.test.ts` cannot share a process with: each of these plants a database and then
 * imports `@/data/db`, whose module-level connection blocks the next delete, so they need separate files.
 *
 * This one guards the repair's blast radius. `create` is additive across versions, so a database can legitimately
 * hold a full diary while lacking a store added in a later version. A repair keyed on "some store is missing"
 * would delete that diary. Refusing is recoverable; a wrong delete is not.
 */
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

describe('a diary missing only a newer store', () => {
  test('a database holding SOME stores and a real entry is never deleted, even when one store is missing', async () => {
    // The dangerous near-miss: `create` is additive across versions, so a database can legitimately hold a diary
    // while lacking a newer store. Deleting on "some store is missing" would destroy that diary. It must refuse.
    const { DB_VERSION } = await import('@/data/db');
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('food-diary', DB_VERSION);
      req.onupgradeneeded = () => {
        // Everything except offProducts, plus one entry: a diary worth not throwing away.
        const d = req.result;
        d.createObjectStore('entries', { keyPath: 'id' }).createIndex('at', 'at');
        d.createObjectStore('customFoods', { keyPath: 'id' });
        d.createObjectStore('batches', { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const d = req.result;
        const tx = d.transaction('entries', 'readwrite');
        tx.objectStore('entries').put({ id: 'precious' });
        tx.oncomplete = () => { d.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    vi.resetModules();
    const { getEntry } = await import('@/data/db');
    await expect(getEntry('precious')).rejects.toThrow(/still holds/);

    // And the row is still there afterwards, which is the whole point.
    expect(await storeNames()).toEqual(expect.arrayContaining(['entries']));
  });

});
