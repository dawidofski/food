import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { FoodRef } from '@/types/diary';

const FLAGS = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1 as const,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};
const refs: FoodRef[] = [{ source: 'dataset', foodId: 'f-oats', grams: 50, classification: FLAGS }];
const meal = (over = {}) => ({ id: 'm1', name: 'my usual porridge', refs, savedAt: new Date().toISOString(), ...over });

beforeEach(async () => {
  // Close first: an open connection blocks deleteDatabase, and the delete then never fires its callback.
  try {
    const { closeDiaryDb } = await import('@/data/db');
    await closeDiaryDb();
  } catch {
    /* the module may not have been loaded yet */
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('food-diary');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  vi.resetModules();
});

describe('the saved meals store', () => {
  test('keeps a meal and gives it back', async () => {
    const { putSavedMeal, allSavedMeals, deleteSavedMeal } = await import('@/data/db');
    await putSavedMeal(meal());
    expect((await allSavedMeals()).map((m) => m.name)).toEqual(['my usual porridge']);
    await deleteSavedMeal('m1');
    expect(await allSavedMeals()).toEqual([]);
  });

  test('refuses a meal that could never be replayed', async () => {
    const { putSavedMeal } = await import('@/data/db');
    await expect(putSavedMeal(meal({ refs: [] }))).rejects.toThrow(/no foods/);
    await expect(putSavedMeal(meal({ name: '  ' }))).rejects.toThrow(/name/);
    await expect(putSavedMeal(meal({ savedAt: 'not a time' }))).rejects.toThrow(/time/);
    await expect(
      putSavedMeal(meal({ refs: [{ ...refs[0]!, grams: Number.NaN }] })),
    ).rejects.toThrow(/grams/);
  });

  test('a diary written before this store existed survives the upgrade with everything in it', async () => {
    // The version bump is the risky part: someone has a real diary at version 3 on their phone.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('food-diary', 3);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('entries', { keyPath: 'id' }).createIndex('at', 'at');
        d.createObjectStore('customFoods', { keyPath: 'id' });
        d.createObjectStore('batches', { keyPath: 'id' });
        d.createObjectStore('offProducts', { keyPath: 'barcode' });
        d.createObjectStore('healthDays', { keyPath: 'date' });
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

    vi.resetModules();
    const { getEntry, allCustomFoods, putSavedMeal, allSavedMeals } = await import('@/data/db');
    // Opening at the new version must keep what was there...
    expect((await getEntry('precious'))?.rawText).toBe('a real meal');
    expect((await allCustomFoods()).map((f) => f.name)).toEqual(['my own food']);
    // ...and the new store must work.
    await putSavedMeal(meal());
    expect(await allSavedMeals()).toHaveLength(1);
    // The entry is still there after writing to the new store.
    expect((await getEntry('precious'))?.rawText).toBe('a real meal');
  });
});
