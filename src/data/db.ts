import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Batch, CustomFood, DiaryEntry } from '@/types/diary';
import type { Profile } from '@/types/profile';

/**
 * Local persistence. Entries, custom foods and batches live in IndexedDB; the profile (and any
 * settings) live in localStorage under the `fd.` prefix. The profile is entered at first run and
 * never committed to the repository.
 *
 * "No silent add, no silent removal": entries are never hard-deleted and the API cannot rewrite
 * history. `addEntry` is insert-only, `deleteEntry` tombstones an active row, `reviseEntry`
 * supersedes the original. The only hard delete is `eraseEverything`. Entry nutrients are
 * snapshotted at commit time and nothing here recomputes them.
 */

interface FoodDiaryDB extends DBSchema {
  entries: { key: string; value: DiaryEntry; indexes: { at: string } };
  customFoods: { key: string; value: CustomFood };
  batches: { key: string; value: Batch };
}

const DB_NAME = 'food-diary';
const DB_VERSION = 1;
/** Every localStorage key this app writes MUST go through `lsKey`, so `eraseEverything` can find it. */
export const LS_PREFIX = 'fd.';
export const lsKey = (name: string): string => `${LS_PREFIX}${name}`;
const PROFILE_KEY = lsKey('profile');

let dbPromise: Promise<IDBPDatabase<FoodDiaryDB>> | null = null;

function db(): Promise<IDBPDatabase<FoodDiaryDB>> {
  if (!dbPromise) {
    const opening = openDB<FoodDiaryDB>(DB_NAME, DB_VERSION, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          const entries = d.createObjectStore('entries', { keyPath: 'id' });
          // INVARIANT: `at` is always a canonical UTC ISO string (toISOString), so lexicographic
          // index order is chronological order. Every write path goes through normaliseAt.
          entries.createIndex('at', 'at');
          d.createObjectStore('customFoods', { keyPath: 'id' });
          d.createObjectStore('batches', { keyPath: 'id' });
        }
      },
    });
    // A failed open must not be cached for the life of the page.
    opening.catch(() => {
      if (dbPromise === opening) dbPromise = null;
    });
    dbPromise = opening;
  }
  return dbPromise;
}

function newId(): string {
  return globalThis.crypto.randomUUID();
}

// ---- validation helpers ----

/**
 * Canonicalises any Date-parseable string to UTC ISO. WARNING: a string with no offset or Z
 * (e.g. '2026-11-15T13:00:00') parses as LOCAL time and so shifts silently. Callers building day
 * boundaries must pass `toISOString()` output or 'Z'-suffixed strings.
 */
function normaliseAt(at: string): string {
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) throw new RangeError(`Invalid datetime: ${at}`);
  return new Date(t).toISOString();
}

function assertFiniteValues(label: string, set: Record<string, number | undefined>): void {
  for (const [k, v] of Object.entries(set)) {
    // An absent key means unknown and is fine; a present key must be a real number.
    if (v !== undefined && !Number.isFinite(v)) throw new RangeError(`${label}.${k} is not finite`);
  }
}

function assertEntryFinite(e: Omit<DiaryEntry, 'id'>): void {
  assertFiniteValues('nutrients', e.nutrients);
  if (e.fped) assertFiniteValues('fped', e.fped);
  assertRefsFinite(e.items);
}

function assertFiniteNumber(label: string, v: number): void {
  if (!Number.isFinite(v)) throw new RangeError(`${label} is not finite`);
}

function assertRefsFinite(refs: { foodId: string; grams: number; fped?: object }[]): void {
  for (const r of refs) {
    assertFiniteNumber(`ref ${r.foodId} grams`, r.grams);
    if (r.fped) assertFiniteValues(`ref ${r.foodId} fped`, r.fped as Record<string, number | undefined>);
  }
}

/** Aborts without letting an InvalidStateError (already auto-aborted) mask the real cause. */
function safeAbort(tx: { abort(): void }): void {
  try {
    tx.abort();
  } catch {
    /* the transaction had already finished or aborted */
  }
}

// ---- entries ----

/**
 * Insert-only. An existing id fails with a ConstraintError, so a tombstone cannot be resurrected
 * and a superseded row cannot be clobbered. An entry must arrive `active` with no `supersededBy`
 * or `revisionOf`: those belong to `reviseEntry` and `deleteEntry` alone. `at` is normalised to UTC ISO.
 */
export async function addEntry(e: DiaryEntry): Promise<void> {
  if (e.state !== 'active') throw new Error(`addEntry: state must be 'active', got '${e.state}'`);
  if (e.supersededBy !== undefined || e.revisionOf !== undefined) {
    throw new Error('addEntry: supersededBy and revisionOf are set only by reviseEntry');
  }
  assertEntryFinite(e);
  const row: DiaryEntry = { ...e, at: normaliseAt(e.at) };
  await (await db()).add('entries', row);
}

export async function getEntry(id: string): Promise<DiaryEntry | undefined> {
  return (await db()).get('entries', id);
}

/**
 * Entries eaten in [fromISO, toISO] (inclusive), ordered by time; `[]` when from > to. Only
 * `state: 'active'` entries, and never a `cancelled` one: a cancelled entry is kept for the
 * learning history but was never eaten, so it must not reach a nutritional total.
 */
export async function entriesBetween(fromISO: string, toISO: string): Promise<DiaryEntry[]> {
  const from = normaliseAt(fromISO);
  const to = normaliseAt(toISO);
  if (from > to) return [];
  const rows = await (await db()).getAllFromIndex('entries', 'at', IDBKeyRange.bound(from, to));
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
  assertEntryFinite(next);
  const at = normaliseAt(next.at);
  const tx = (await db()).transaction('entries', 'readwrite');
  // Attach early so any throw below cannot leave an unhandled rejection on tx.done.
  const done = tx.done.catch(() => undefined);
  const original = await tx.store.get(originalId);
  if (!original || original.state !== 'active') {
    safeAbort(tx);
    await done;
    throw new Error(
      original
        ? `Cannot revise entry ${originalId}: state is ${original.state}`
        : `Cannot revise unknown entry ${originalId}`,
    );
  }
  const revised: DiaryEntry = { ...next, at, id: newId(), state: 'active', revisionOf: originalId };
  delete revised.supersededBy;
  try {
    await tx.store.put(revised);
    await tx.store.put({ ...original, state: 'superseded', supersededBy: revised.id });
  } catch (err) {
    safeAbort(tx);
    await done;
    throw err;
  }
  await tx.done;
  return revised;
}

/**
 * Tombstones an `active` row: it survives with `state: 'deleted'`, and the result is `true`. Any
 * other row (missing, already deleted, or superseded) is a no-op that returns `false`; in particular a superseded row keeps its
 * "replaced by a revision" fact and `supersededBy` link rather than being relabelled deleted.
 */
export async function deleteEntry(id: string): Promise<boolean> {
  const tx = (await db()).transaction('entries', 'readwrite');
  const row = await tx.store.get(id);
  const live = row !== undefined && row.state === 'active';
  if (live) await tx.store.put({ ...row, state: 'deleted' });
  await tx.done;
  return live;
}

// ---- custom foods ----

export async function putCustomFood(f: CustomFood): Promise<void> {
  assertFiniteValues('nutrientsPer100g', f.nutrientsPer100g);
  assertFiniteNumber('referencePortion.grams', f.referencePortion.grams);
  await (await db()).put('customFoods', f);
}

export async function getCustomFood(id: string): Promise<CustomFood | undefined> {
  return (await db()).get('customFoods', id);
}

/**
 * Hard delete, on purpose: custom foods are reference data, not history. Every DiaryEntry snapshots its own
 * nutrients, coverage and rawText at commit, so past entries keep their numbers and nothing is rewritten.
 */
export async function deleteCustomFood(id: string): Promise<void> {
  await (await db()).delete('customFoods', id);
}

export async function allCustomFoods(): Promise<CustomFood[]> {
  return (await db()).getAll('customFoods');
}

// ---- batches ----

export async function putBatch(b: Batch): Promise<void> {
  assertFiniteValues('nutrientsPerPortion', b.nutrientsPerPortion);
  if (!Number.isFinite(b.portionsRemaining) || !Number.isFinite(b.portionCount)) {
    throw new RangeError('batch portion counts must be finite');
  }
  if (b.totalCookedGrams !== undefined) assertFiniteNumber('totalCookedGrams', b.totalCookedGrams);
  for (const ing of b.ingredients) assertRefsFinite(ing.refs);
  await (await db()).put('batches', b);
}

export async function getBatch(id: string): Promise<Batch | undefined> {
  return (await db()).get('batches', id);
}

/** Hard delete, like custom foods: logged portions are DiaryEntry snapshots and keep their numbers. */
export async function deleteBatch(id: string): Promise<void> {
  await (await db()).delete('batches', id);
}

export async function allBatches(): Promise<Batch[]> {
  return (await db()).getAll('batches');
}

/** Takes one portion off a batch, flooring at zero. A missing id is a no-op and creates no row. */
export async function decrementBatchPortion(id: string): Promise<void> {
  const tx = (await db()).transaction('batches', 'readwrite');
  const row = await tx.store.get(id);
  if (row) {
    const left = Number.isFinite(row.portionsRemaining) ? row.portionsRemaining : 0;
    await tx.store.put({ ...row, portionsRemaining: Math.max(0, left - 1) });
  }
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
  // JSON.stringify would turn NaN/Infinity into null silently, so validate before writing.
  assertFiniteNumber('heightCm', p.heightCm);
  for (const w of p.weightLog) assertFiniteNumber(`weightLog ${w.date} kg`, w.kg);
  if (p.overrides) assertFiniteValues('overrides', p.overrides as Record<string, number | undefined>);
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
}

/**
 * The only hard delete. localStorage (profile, including date of birth) is attempted first and
 * IndexedDB is then cleared unconditionally, so blocked storage never stops the diary being wiped.
 * If the localStorage sweep failed, its error is rethrown AFTER the IndexedDB clear: the caller can
 * then say "your diary was cleared, but your profile could not be removed".
 */
/** In-memory caches built from stored data register here so an erase cannot leave data searchable. */
const eraseListeners = new Set<() => void>();
export function onEraseEverything(fn: () => void): void {
  eraseListeners.add(fn);
}

export async function eraseEverything(): Promise<void> {
  try {
    await eraseStores();
  } finally {
    // Even if storage threw, nothing erased may stay reachable from memory.
    eraseListeners.forEach((fn) => fn());
  }
}

async function eraseStores(): Promise<void> {
  let sweepError: unknown;
  let swept = true;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(LS_PREFIX)) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
  } catch (err) {
    swept = false;
    sweepError = err;
  }

  const d = await db();
  const tx = d.transaction(['entries', 'customFoods', 'batches'], 'readwrite');
  await Promise.all([
    tx.objectStore('entries').clear(),
    tx.objectStore('customFoods').clear(),
    tx.objectStore('batches').clear(),
    tx.done,
  ]);
  if (!swept) throw sweepError;
}

// ---- import (one transaction) ----

export type ImportRows = { entries: DiaryEntry[]; customFoods: CustomFood[]; batches: Batch[] };

/**
 * Writes already-validated rows to all three stores in ONE transaction, so an import lands whole or
 * not at all. `replace` clears each store first; `merge` adds only ids that are not present and
 * leaves every existing row exactly as it is (a local tombstone is never resurrected by a file).
 * This is the one path that may write a non-active entry, because a backup must restore history
 * as it was. `at` is normalised so the index invariant holds.
 */
export async function writeImportedRows(rows: ImportRows, mode: 'merge' | 'replace'): Promise<{ added: number; skipped: number }> {
  const tx = (await db()).transaction(['entries', 'customFoods', 'batches'], 'readwrite');
  const done = tx.done.catch(() => undefined);
  let added = 0;
  let skipped = 0;
  try {
    if (mode === 'replace') {
      await Promise.all([tx.objectStore('entries').clear(), tx.objectStore('customFoods').clear(), tx.objectStore('batches').clear()]);
    }
    const put = async <T extends { id: string }>(store: { getKey(k: string): Promise<unknown>; put(v: T): Promise<unknown> }, row: T) => {
      if (mode === 'merge' && (await store.getKey(row.id)) !== undefined) {
        skipped++;
        return;
      }
      await store.put(row);
      added++;
    };
    for (const e of rows.entries) await put(tx.objectStore('entries'), { ...e, at: normaliseAt(e.at) });
    for (const f of rows.customFoods) await put(tx.objectStore('customFoods'), f);
    for (const b of rows.batches) await put(tx.objectStore('batches'), b);
  } catch (err) {
    safeAbort(tx);
    await done;
    throw err;
  }
  await tx.done;
  return { added, skipped };
}
