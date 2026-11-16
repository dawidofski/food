import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Batch, CustomFood, DiaryEntry } from '@/types/diary';
import type { Profile } from '@/types/profile';

/**
 * Local persistence. Entries, custom foods and batches live in IndexedDB; the profile (and any
 * settings) live in localStorage under the `fd.` prefix. The profile is entered at first run and
 * never committed to the repository.
 *
 * "No silent add, no silent removal": entries are never hard-deleted. `deleteEntry` writes a
 * tombstone and `reviseEntry` supersedes the original. The only hard delete is `eraseEverything`.
 * Entry nutrients are snapshotted at commit time and nothing here recomputes them.
 */

interface FoodDiaryDB extends DBSchema {
  entries: { key: string; value: DiaryEntry; indexes: { at: string } };
  customFoods: { key: string; value: CustomFood };
  batches: { key: string; value: Batch };
}

const DB_NAME = 'food-diary';
const DB_VERSION = 1;
const LS_PREFIX = 'fd.';
const PROFILE_KEY = `${LS_PREFIX}profile`;

let dbPromise: Promise<IDBPDatabase<FoodDiaryDB>> | null = null;

function db(): Promise<IDBPDatabase<FoodDiaryDB>> {
  dbPromise ??= openDB<FoodDiaryDB>(DB_NAME, DB_VERSION, {
    upgrade(d) {
      const entries = d.createObjectStore('entries', { keyPath: 'id' });
      entries.createIndex('at', 'at');
      d.createObjectStore('customFoods', { keyPath: 'id' });
      d.createObjectStore('batches', { keyPath: 'id' });
    },
  });
  return dbPromise;
}

function newId(): string {
  return globalThis.crypto.randomUUID();
}

// ---- entries ----

export async function putEntry(e: DiaryEntry): Promise<void> {
  await (await db()).put('entries', e);
}

export async function getEntry(id: string): Promise<DiaryEntry | undefined> {
  return (await db()).get('entries', id);
}

/**
 * Entries eaten in [fromISO, toISO], ordered by time. Only `state: 'active'` entries, and never a
 * `cancelled` one: a cancelled entry is kept for the learning history but was never eaten, so it
 * must not reach a nutritional total.
 */
export async function entriesBetween(fromISO: string, toISO: string): Promise<DiaryEntry[]> {
  const rows = await (await db()).getAllFromIndex('entries', 'at', IDBKeyRange.bound(fromISO, toISO));
  return rows.filter(e => e.state === 'active' && e.userAction !== 'cancelled');
}

/** Every row, tombstones and superseded revisions included. For export and the learning history. */
export async function allEntriesIncludingTombstones(): Promise<DiaryEntry[]> {
  return (await db()).getAll('entries');
}

/**
 * Writes `next` as a new entry with `revisionOf` pointing at the original, and marks the original
 * `superseded` with `supersededBy` pointing forward, in one transaction. Only an active entry can
 * be revised (revising a superseded one would fork the chain; a deleted one would resurrect it).
 */
export async function reviseEntry(originalId: string, next: Omit<DiaryEntry, 'id'>): Promise<DiaryEntry> {
  const tx = (await db()).transaction('entries', 'readwrite');
  const original = await tx.store.get(originalId);
  if (!original) {
    tx.abort();
    await tx.done.catch(() => undefined);
    throw new Error(`Cannot revise unknown entry ${originalId}`);
  }
  if (original.state !== 'active') {
    tx.abort();
    await tx.done.catch(() => undefined);
    throw new Error(`Cannot revise entry ${originalId}: state is ${original.state}`);
  }
  const revised: DiaryEntry = {
    ...next,
    id: newId(),
    state: 'active',
    revisionOf: originalId,
  };
  delete revised.supersededBy;
  await tx.store.put(revised);
  await tx.store.put({ ...original, state: 'superseded', supersededBy: revised.id });
  await tx.done;
  return revised;
}

/** Tombstone only: the row survives with `state: 'deleted'`. A missing id is a no-op. */
export async function deleteEntry(id: string): Promise<void> {
  const tx = (await db()).transaction('entries', 'readwrite');
  const row = await tx.store.get(id);
  if (row) await tx.store.put({ ...row, state: 'deleted' });
  await tx.done;
}

// ---- custom foods ----

export async function putCustomFood(f: CustomFood): Promise<void> {
  await (await db()).put('customFoods', f);
}

export async function getCustomFood(id: string): Promise<CustomFood | undefined> {
  return (await db()).get('customFoods', id);
}

export async function allCustomFoods(): Promise<CustomFood[]> {
  return (await db()).getAll('customFoods');
}

// ---- batches ----

export async function putBatch(b: Batch): Promise<void> {
  await (await db()).put('batches', b);
}

export async function getBatch(id: string): Promise<Batch | undefined> {
  return (await db()).get('batches', id);
}

export async function allBatches(): Promise<Batch[]> {
  return (await db()).getAll('batches');
}

/** Takes one portion off a batch, flooring at zero. A missing id is a no-op and creates no row. */
export async function decrementBatchPortion(id: string): Promise<void> {
  const tx = (await db()).transaction('batches', 'readwrite');
  const row = await tx.store.get(id);
  if (row) await tx.store.put({ ...row, portionsRemaining: Math.max(0, row.portionsRemaining - 1) });
  await tx.done;
}

// ---- profile (localStorage) ----

export async function getProfile(): Promise<Profile | null> {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Profile) : null;
  } catch {
    return null;
  }
}

export async function putProfile(p: Profile): Promise<void> {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
}

/** The only hard delete: clears every store and every `fd.` localStorage key. */
export async function eraseEverything(): Promise<void> {
  const d = await db();
  const tx = d.transaction(['entries', 'customFoods', 'batches'], 'readwrite');
  await Promise.all([
    tx.objectStore('entries').clear(),
    tx.objectStore('customFoods').clear(),
    tx.objectStore('batches').clear(),
    tx.done,
  ]);
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(LS_PREFIX)) keys.push(k);
  }
  keys.forEach(k => localStorage.removeItem(k));
}
