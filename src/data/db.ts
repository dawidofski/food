import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Batch, CustomFood, DiaryEntry } from '@/types/diary';
import type { OffProduct } from '@/types/food';
import type { HealthDay } from '@/types/health';
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
  /** Products scanned from a barcode and read from Open Food Facts, keyed by barcode. A cache, not history. */
  offProducts: { key: string; value: OffProduct };
  /** What the owner types in from Samsung Health, one row per local day. Not food, so not in `entries`. */
  healthDays: { key: string; value: HealthDay };
}

const DB_NAME = 'food-diary';
/**
 * 2 adds `offProducts`; 3 adds `healthDays`. Raise this for EVERY store added: `upgrade` runs only when the stored version is below it,
 * and `create` below is written to add whatever is missing, so an old database gains the new store and a fresh one
 * gets everything. The repair path in `open()` relies on `create` being safe to call on a database that already
 * holds some of the stores.
 */
export const DB_VERSION = 3;
/** Every localStorage key this app writes MUST go through `lsKey`, so `eraseEverything` can find it. */
export const LS_PREFIX = 'fd.';
export const lsKey = (name: string): string => `${LS_PREFIX}${name}`;
const PROFILE_KEY = lsKey('profile');

let dbPromise: Promise<IDBPDatabase<FoodDiaryDB>> | null = null;

const STORES = ['entries', 'customFoods', 'batches', 'offProducts', 'healthDays'] as const;

/** Adds whatever is missing, so it serves a fresh database, a version upgrade and the repair in `open()` alike. */
function create(d: IDBPDatabase<FoodDiaryDB>): void {
  if (!d.objectStoreNames.contains('entries')) {
    const entries = d.createObjectStore('entries', { keyPath: 'id' });
    // INVARIANT: `at` is always a canonical UTC ISO string (toISOString), so lexicographic
    // index order is chronological order. Every write path goes through normaliseAt.
    entries.createIndex('at', 'at');
  }
  if (!d.objectStoreNames.contains('customFoods')) d.createObjectStore('customFoods', { keyPath: 'id' });
  if (!d.objectStoreNames.contains('batches')) d.createObjectStore('batches', { keyPath: 'id' });
  if (!d.objectStoreNames.contains('offProducts')) d.createObjectStore('offProducts', { keyPath: 'barcode' });
  if (!d.objectStoreNames.contains('healthDays')) d.createObjectStore('healthDays', { keyPath: 'date' });
}

function missingStores(d: IDBPDatabase<FoodDiaryDB>): string[] {
  return STORES.filter((s) => !d.objectStoreNames.contains(s));
}

/**
 * The ONLY state the repair below may act on: a database holding no object stores whatsoever.
 *
 * `missingStores` is not the same test and must not be used for this. It reports a database that is missing ANY
 * store, and since `create` became additive across versions, a database can legitimately hold entries while
 * lacking a newer store. Deleting on `missingStores` would therefore throw away a real diary, which is the exact
 * opposite of what this code is for. An empty database is the safe case because there is nowhere for a row to be.
 */
function holdsNothing(d: IDBPDatabase<FoodDiaryDB>): boolean {
  return d.objectStoreNames.length === 0;
}

/**
 * Opens the diary, repairing the one way this database can be left unusable.
 *
 * `upgrade` only runs when the stored version is below `DB_VERSION`. So a database that already claims version 1
 * but holds no object stores — left behind by an interrupted upgrade, by eviction part-way through a write, or by
 * any other code on this origin calling `indexedDB.open('food-diary')` without a version — opens "successfully"
 * and then fails on every read, permanently, with no way back from inside the app. The owner would see "The diary
 * could not be read" forever and the only cure would be DevTools.
 *
 * Repair is safe precisely because a database with no object stores cannot be holding anything: there is nowhere
 * for a row to be. We delete ONLY in that case — see `holdsNothing`, and note that "missing some store" is a
 * different and much more common condition that must never reach the delete.
 *
 * If some stores are present and others are not, something has happened that this code does not understand, and
 * the one thing it must not do is guess. It throws instead, and the diary reports that it could not be read,
 * which is recoverable; a wrong delete is not.
 */
async function open(): Promise<IDBPDatabase<FoodDiaryDB>> {
  const first = await openDB<FoodDiaryDB>(DB_NAME, DB_VERSION, { upgrade: (d) => create(d) });
  const missing = missingStores(first);
  if (missing.length === 0) return first;

  if (!holdsNothing(first)) {
    const held = [...first.objectStoreNames].join(', ');
    first.close();
    throw new Error(`The diary is missing ${missing.join(', ')} but still holds ${held}, so it was left alone.`);
  }

  first.close();
  await deleteDB(DB_NAME);
  return openDB<FoodDiaryDB>(DB_NAME, DB_VERSION, { upgrade: (d) => create(d) });
}

function db(): Promise<IDBPDatabase<FoodDiaryDB>> {
  if (!dbPromise) {
    const opening = open();
    // A failed open must not be cached for the life of the page.
    opening.catch(() => {
      if (dbPromise === opening) dbPromise = null;
    });
    dbPromise = opening;
  }
  return dbPromise;
}

/** Closes the cached connection (and forgets it). For tests that must delete or re-plant the database. */
export async function closeDiaryDb(): Promise<void> {
  const p = dbPromise;
  dbPromise = null;
  if (p) (await p.catch(() => null))?.close();
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
 * How many live rows the diary holds: `state: 'active'` only, so a tombstone or a superseded revision is not
 * counted twice over. Used to decide whether there is enough here to be worth reminding anyone to copy it.
 * A cancelled entry counts: it was never eaten, but it is still a stored row that a backup would carry.
 */
export async function countActiveEntries(): Promise<number> {
  const rows = await (await db()).getAll('entries');
  return rows.filter(e => e.state === 'active').length;
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

// ---- scanned products from Open Food Facts ----

/**
 * A CACHE, not history. It exists so a product scanned twice is fetched once (Open Food Facts asks for restraint and
 * a browser cannot send the User-Agent its API etiquette asks for, so the politeness this app can offer is one
 * request per scan and no re-fetching). Every diary entry snapshots its own nutrients at commit, so clearing this
 * store rewrites nothing: a past entry keeps its numbers and only loses the product's name in the detail view.
 */
export async function putOffProduct(p: OffProduct): Promise<void> {
  assertFiniteValues('per100g', p.per100g);
  if (p.servingGrams !== undefined) assertFiniteNumber('servingGrams', p.servingGrams);
  await (await db()).put('offProducts', p);
}

export async function getOffProduct(barcode: string): Promise<OffProduct | undefined> {
  return (await db()).get('offProducts', barcode);
}

export async function allOffProducts(): Promise<OffProduct[]> {
  return (await db()).getAll('offProducts');
}

export async function deleteOffProduct(barcode: string): Promise<void> {
  await (await db()).delete('offProducts', barcode);
}

// ---- daily health figures (typed in from Samsung Health) ----

/**
 * One row per local day, keyed by `date`, beside the diary and not inside it: a day can have sleep recorded and no
 * food logged at all. Absent means unknown, so a figure that was not given is never stored as 0.
 */
const HEALTH_FIGURES = ['sleepScore', 'steps', 'energyBurnedKcal'] as const;

/** Throws on anything that is not a real figure in range, and on any key it does not know. */
function validatedHealthDay(d: HealthDay): HealthDay {
  if (typeof d.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
    throw new RangeError(`healthDay.date is not a day key: ${String(d.date)}`);
  }
  // A misspelt key must not fall through to an all-absent record, which would delete the day.
  for (const k of Object.keys(d)) {
    if (k !== 'date' && !(HEALTH_FIGURES as readonly string[]).includes(k)) {
      throw new RangeError(`healthDay has an unknown key: ${k}`);
    }
  }
  const row: HealthDay = { date: d.date };
  for (const k of HEALTH_FIGURES) {
    const v = d[k];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new RangeError(`healthDay.${k} is not finite`);
    if (v < 0) throw new RangeError(`healthDay.${k} is below 0`);
    if (k === 'sleepScore' && v > 100) throw new RangeError('healthDay.sleepScore is above 100');
    row[k] = v;
  }
  return row;
}

/** Validates and writes. A record with every figure absent deletes the row rather than storing an empty one. */
export async function putHealthDay(d: HealthDay): Promise<void> {
  const row = validatedHealthDay(d);
  const d3 = await db();
  if (HEALTH_FIGURES.every((k) => row[k] === undefined)) {
    await d3.delete('healthDays', row.date);
    return;
  }
  await d3.put('healthDays', row);
}

export async function getHealthDay(dayKey: string): Promise<HealthDay | undefined> {
  return (await db()).get('healthDays', dayKey);
}

/** Every stored day, oldest first. For the backup. */
export async function allHealthDays(): Promise<HealthDay[]> {
  return (await db()).getAll('healthDays');
}

/** Inclusive, oldest first. Day keys are zero-padded, so key order is date order. */
export async function healthDaysBetween(fromDayKey: string, toDayKey: string): Promise<HealthDay[]> {
  if (fromDayKey > toDayKey) return [];
  return (await db()).getAll('healthDays', IDBKeyRange.bound(fromDayKey, toDayKey));
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
  if (p.heightCm !== undefined) assertFiniteNumber('heightCm', p.heightCm);
  if (p.bodyFatPct !== undefined) assertFiniteNumber('bodyFatPct', p.bodyFatPct);
  if (p.goal?.rateKgPerWeek !== undefined) assertFiniteNumber('goal rateKgPerWeek', p.goal.rateKgPerWeek);
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
    // Enumerated by prefix, never from a list of known names: every key this app writes goes through `lsKey`, so
    // a setting added later (the theme, the export stamp, the backup reminder's dismissal, the persistence flag)
    // is swept the day it is written and no list can drift out of date. A new key that skips `lsKey` would
    // survive an erase, which is why `lsKey` is the only documented way to name one.
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
  const tx = d.transaction(['entries', 'customFoods', 'batches', 'offProducts', 'healthDays'], 'readwrite');
  await Promise.all([
    tx.objectStore('entries').clear(),
    tx.objectStore('customFoods').clear(),
    tx.objectStore('batches').clear(),
    tx.objectStore('offProducts').clear(),
    tx.objectStore('healthDays').clear(),
    tx.done,
  ]);
  if (!swept) throw sweepError;
}

// ---- import (one transaction) ----

export type ImportRows = { entries: DiaryEntry[]; customFoods: CustomFood[]; batches: Batch[]; healthDays: HealthDay[] };

/**
 * Writes already-validated rows to all four stores in ONE transaction, so an import lands whole or
 * not at all. `replace` clears each store first; `merge` adds only ids that are not present and
 * leaves every existing row exactly as it is (a local tombstone is never resurrected by a file).
 * This is the one path that may write a non-active entry, because a backup must restore history
 * as it was. `at` is normalised so the index invariant holds.
 */
export async function writeImportedRows(rows: ImportRows, mode: 'merge' | 'replace'): Promise<{ added: number; skipped: number }> {
  const tx = (await db()).transaction(['entries', 'customFoods', 'batches', 'healthDays'], 'readwrite');
  const done = tx.done.catch(() => undefined);
  let added = 0;
  let skipped = 0;
  try {
    if (mode === 'replace') {
      await Promise.all([tx.objectStore('entries').clear(), tx.objectStore('customFoods').clear(), tx.objectStore('batches').clear(), tx.objectStore('healthDays').clear()]);
    }
    const put = async <T>(store: { getKey(k: string): Promise<unknown>; put(v: T): Promise<unknown> }, row: T, key: string) => {
      if (mode === 'merge' && (await store.getKey(key)) !== undefined) {
        skipped++;
        return;
      }
      await store.put(row);
      added++;
    };
    for (const e of rows.entries) await put(tx.objectStore('entries'), { ...e, at: normaliseAt(e.at) }, e.id);
    for (const f of rows.customFoods) await put(tx.objectStore('customFoods'), f, f.id);
    for (const b of rows.batches) await put(tx.objectStore('batches'), b, b.id);
    // Keyed by day: in merge a local day is kept as it is, as every other local row is.
    for (const h of rows.healthDays) await put(tx.objectStore('healthDays'), h, h.date);
  } catch (err) {
    safeAbort(tx);
    await done;
    throw err;
  }
  await tx.done;
  return { added, skipped };
}
