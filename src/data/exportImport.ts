import {
  LS_PREFIX, allBatches, allCustomFoods, allEntriesIncludingTombstones, allHealthDays, allSavedMeals, getProfile, lsKey, writeImportedRows,
  type ImportRows,
} from '@/data/db';
import { API_KEY_LS } from '@/state/aiSettings';
import { MEAL_SLOTS, type Batch, type CustomFood, type DiaryEntry } from '@/types/diary';
import type { HealthDay } from '@/types/health';
import { MAX_ITEM_GRAMS } from '@/domain/resolveItems';
import type { SavedMeal } from '@/domain/savedMeals';
import type { Profile } from '@/types/profile';

/**
 * Export and import: the person's only backup, since the browser can clear its own storage.
 *
 * The file is one JSON document holding every entry (tombstones and superseded revisions included, so
 * history survives), every custom food and batch, every day's health figures, the profile and the settings. The DeepSeek key is
 * deliberately NOT exported: a backup file gets emailed and synced, and a secret does not belong in it.
 *
 * Import is validate-then-write. The whole file is parsed and every record checked BEFORE anything is
 * written, so a malformed file changes nothing; the rows then go in one IndexedDB transaction and the
 * localStorage part is applied with a snapshot to roll back to, so a failure in either store leaves
 * both as they were.
 *
 * One checked field is deliberately permissive rather than strict: an entry's `correctedKeys` may name a figure this
 * build does not have, because a backup written by a newer version would otherwise be refused whole. Such a key cannot
 * produce a wrong figure, only an unnamed one, and the screens skip it. The reasoning is at that check, in `entry`.
 */

export const EXPORT_FORMAT = 'food-diary-export';
export const EXPORT_VERSION = 1;

type ExportFile = {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  entries: DiaryEntry[];
  customFoods: CustomFood[];
  batches: Batch[];
  /** Absent in a backup written before daily health data existed, which reads as none. The version is NOT bumped for it. */
  healthDays: HealthDay[];
  /** Absent in a backup written before saved meals existed, which reads as none. The version is NOT bumped for it. */
  savedMeals: SavedMeal[];
  profile: Profile | null;
  /** localStorage `fd.*` keys other than the profile and the API key. */
  settings: Record<string, string>;
};

const PROFILE_LS = lsKey('profile');
/** Never exported, never imported. */
const EXCLUDED_LS = new Set([PROFILE_LS, API_KEY_LS]);

function readSettings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(LS_PREFIX) && !EXCLUDED_LS.has(k)) {
      const v = localStorage.getItem(k);
      if (v !== null) out[k] = v;
    }
  }
  return out;
}

export async function exportAll(): Promise<Blob> {
  const file: ExportFile = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    entries: await allEntriesIncludingTombstones(),
    customFoods: await allCustomFoods(),
    batches: await allBatches(),
    healthDays: await allHealthDays(),
    savedMeals: await allSavedMeals(),
    profile: await getProfile(),
    settings: readSettings(),
  };
  return new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
}

// ---- validation (throws on the first problem; writes nothing) ----

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const fail = (where: string, why: string): never => {
  throw new Error(`The file is not a valid backup: ${where} ${why}.`);
};
const str = (v: unknown, where: string): string => (typeof v === 'string' ? v : fail(where, 'must be text'));
const idOf = (v: unknown, where: string): string => (typeof v === 'string' && v !== '' ? v : fail(where, 'needs an id'));
const num = (v: unknown, where: string): number => (typeof v === 'number' && Number.isFinite(v) ? v : fail(where, 'must be a finite number'));
const bool = (v: unknown, where: string): boolean => (typeof v === 'boolean' ? v : fail(where, 'must be true or false'));
const arr = (v: unknown, where: string): unknown[] => (Array.isArray(v) ? v : fail(where, 'must be a list'));
const obj = (v: unknown, where: string): Obj => (isObj(v) ? v : fail(where, 'must be an object'));
const oneOf = (v: unknown, allowed: readonly string[], where: string): string =>
  typeof v === 'string' && allowed.includes(v) ? v : fail(where, `must be one of ${allowed.join(', ')}`);
const strings = (v: unknown, where: string): void => {
  for (const s of arr(v, where)) str(s, where);
};
const isoDay = (v: unknown, where: string): string => {
  const s = str(v, where);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  if (!m || !d || d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) {
    fail(where, 'must be a real date (YYYY-MM-DD)');
  }
  return s;
};
/** An absent key is unknown and fine; a present one must be a real number. */
const numberMap = (v: unknown, where: string): void => {
  for (const [k, x] of Object.entries(obj(v, where))) num(x, `${where}.${k}`);
};

const COVERAGE = ['known', 'partial', 'unknown'];
const FLAG_BOOLS = ['processedMeat', 'redMeat', 'sweetDrink', 'alcohol', 'refinedGrain', 'vegetable', 'fruit', 'legume', 'oilyFish'];

function classification(v: unknown, where: string): void {
  const o = obj(v, where);
  for (const k of FLAG_BOOLS) bool(o[k], `${where}.${k}`);
  oneOf(String(o.novaGroup), ['1', '2', '3', '4'], `${where}.novaGroup`);
}
function coverage(v: unknown, where: string): void {
  for (const [k, x] of Object.entries(obj(v, where))) oneOf(x, COVERAGE, `${where}.${k}`);
}
function fped(v: unknown, where: string): void {
  const o = obj(v, where);
  for (const k of ['vegCupEq', 'fruitCupEq', 'wholeGrainOzEq']) num(o[k], `${where}.${k}`);
}
function refs(v: unknown, where: string): void {
  arr(v, where).forEach((r, i) => {
    const w = `${where}[${i}]`;
    const o = obj(r, w);
    // 'off' is a product scanned from a barcode. A backup written by a later version must still import here.
    oneOf(o.source, ['dataset', 'custom', 'batch', 'off'], `${w}.source`);
    str(o.foodId, `${w}.foodId`);
    num(o.grams, `${w}.grams`);
    classification(o.classification, `${w}.classification`);
    if (o.fped !== undefined) fped(o.fped, `${w}.fped`);
  });
}
function time(v: unknown, where: string): void {
  if (!Number.isFinite(new Date(str(v, where)).getTime())) fail(where, 'must be a date and time');
}

function entry(v: unknown, i: number): DiaryEntry {
  const w = `entry ${i + 1}`;
  const o = obj(v, w);
  idOf(o.id, w);
  time(o.at, `${w} time`);
  str(o.rawText, `${w} text`);
  oneOf(o.resolution, ['local', 'ai', 'manual', 'batch'], `${w} resolution`);
  refs(o.items, `${w} items`);
  numberMap(o.nutrients, `${w} nutrients`);
  coverage(o.coverage, `${w} coverage`);
  classification(o.classification, `${w} classification`);
  if (o.fped !== undefined) fped(o.fped, `${w} fped`);
  arr(o.warningsShown, `${w} warnings`);
  oneOf(o.userAction, ['added', 'addedAfterAlternatives', 'cancelled'], `${w} action`);
  oneOf(o.state, ['active', 'deleted', 'superseded'], `${w} state`);
  // Absent means the person never chose a slot, and stays absent. A present value must be a slot this build has, and
  // unlike correctedKeys below an unknown one REJECTS the file: an unknown figure key costs a name, but an unknown slot
  // would put the entry in no group the diary draws. The day view tolerates an unrecognised slot (it lists it under
  // "Earlier"), and that is not a contradiction: a file is a record this build owns, so a wrong slot in one is worth
  // refusing, while a value can still reach the store without passing here (a hand-edited database, a row from a later
  // build), and an entry in no rendered group is invisible, which reads as lost food.
  if (o.meal !== undefined) oneOf(o.meal, [...MEAL_SLOTS], `${w} meal`);
  // Absent means no correction. A present value must be a list of strings; anything else is a damaged file.
  // An UNKNOWN string key is accepted: a backup from a newer version may name a figure this build lacks. Such a key
  // cannot produce a wrong figure, only an unnamed one, and the badge and the entry screen both skip it. Refusing the
  // person's only backup over that would be out of proportion (nutrients, coverage and refs take unknown keys too).
  if (o.correctedKeys !== undefined) {
    for (const k of arr(o.correctedKeys, `${w} correctedKeys`)) str(k, `${w} correctedKeys`);
  }
  for (const k of ['supersededBy', 'revisionOf']) if (o[k] !== undefined) str(o[k], `${w} ${k}`);
  return v as DiaryEntry;
}

function savedMeal(v: unknown, i: number): SavedMeal {
  const w = `saved meal ${i + 1}`;
  const o = obj(v, w);
  idOf(o.id, w);
  // Stricter than an entry's refs, and deliberately so. An entry is history: it is reported as it was written,
  // whatever it holds. A saved meal is an instruction to log something again, so a weight the app would not
  // accept from the person must not reach the store through a file either.
  if (typeof o.name !== 'string' || o.name.trim() === '') fail(`${w} name`, 'must say what the meal is called');
  refs(o.refs, `${w} foods`);
  const rs = Array.isArray(o.refs) ? o.refs : [];
  if (rs.length === 0) fail(w, 'has no foods, so it could never be logged');
  rs.forEach((r, j) => {
    const g = (r as { grams?: unknown }).grams;
    if (typeof g !== 'number' || !(g > 0) || g > MAX_ITEM_GRAMS) {
      fail(`${w} foods[${j}].grams`, `must be a weight between 0 and ${MAX_ITEM_GRAMS} g`);
    }
  });
  time(o.savedAt, `${w} time`);
  return v as SavedMeal;
}

function customFood(v: unknown, i: number): CustomFood {
  const w = `custom food ${i + 1}`;
  const o = obj(v, w);
  idOf(o.id, w);
  str(o.name, `${w} name`);
  numberMap(o.nutrientsPer100g, `${w} nutrients`);
  classification(o.classification, `${w} classification`);
  strings(o.allergens, `${w} allergens`);
  const p = obj(o.referencePortion, `${w} portion`);
  str(p.label, `${w} portion label`);
  num(p.grams, `${w} portion grams`);
  strings(o.synonyms, `${w} synonyms`);
  return v as CustomFood;
}

function batch(v: unknown, i: number): Batch {
  const w = `batch ${i + 1}`;
  const o = obj(v, w);
  idOf(o.id, w);
  str(o.name, `${w} name`);
  arr(o.ingredients, `${w} ingredients`).forEach((ing, j) => {
    const io = obj(ing, `${w} ingredient ${j + 1}`);
    str(io.text, `${w} ingredient ${j + 1} text`);
    refs(io.refs, `${w} ingredient ${j + 1} refs`);
  });
  num(o.portionCount, `${w} portion count`);
  num(o.portionsRemaining, `${w} portions remaining`);
  if (o.totalCookedGrams !== undefined) num(o.totalCookedGrams, `${w} cooked grams`);
  numberMap(o.nutrientsPerPortion, `${w} nutrients`);
  coverage(o.coverage, `${w} coverage`);
  classification(o.classification, `${w} classification`);
  if (o.allergens !== undefined) strings(o.allergens, `${w} allergens`);
  if (o.fped !== undefined) fped(o.fped, `${w} fped`);
  time(o.cookedAt, `${w} cooked time`);
  return v as Batch;
}

const HEALTH_FIGURES = ['sleepScore', 'steps', 'energyBurnedKcal'] as const;

/** Returns null for a day that holds no figure at all: it carries no information, so it is passed over, not rejected. */
function healthDay(v: unknown, i: number): HealthDay | null {
  const o = obj(v, `health day ${i + 1}`);
  const w = typeof o.date === 'string' ? `health day ${i + 1} (${o.date})` : `health day ${i + 1}`;
  const date = isoDay(o.date, `${w} date`);
  // A misspelt figure (`step` for `steps`) must not read as a day with no figures: that is "clear this day", and
  // the figure would be quietly gone. Unlike a top-level field, an unknown key here is a mistake in a record this
  // build owns, so it rejects the file.
  for (const k of Object.keys(o)) {
    if (k !== 'date' && !(HEALTH_FIGURES as readonly string[]).includes(k)) fail(w, `has "${k}", which is not a health figure (expected ${HEALTH_FIGURES.join(', ')})`);
  }
  const row: HealthDay = { date };
  for (const k of HEALTH_FIGURES) {
    const x = o[k];
    if (x === undefined) continue;
    // null is not "unknown" in this file: a figure that is not known is left out, never written as null or 0.
    if (x === null) fail(`${w} ${k}`, 'is empty (null); leave the field out if the figure is not known');
    const n = num(x, `${w} ${k}`);
    if (n < 0) fail(`${w} ${k}`, 'must not be negative');
    if (k === 'sleepScore' && n > 100) fail(`${w} ${k}`, 'must be between 0 and 100');
    row[k] = n;
  }
  // Dropping a FIGURE loses information and is refused above (null, a typo, a bad value all throw). Dropping a record
  // that holds none loses nothing, and putHealthDay already treats it the same way (it deletes rather than store it).
  return HEALTH_FIGURES.every((k) => row[k] === undefined) ? null : row;
}

const GOAL_KINDS = ['lose', 'hold', 'gain'];

function profile(v: unknown): Profile {
  const o = obj(v, 'profile');
  // Body data is optional (a profile may hold only flags); when present it must be valid.
  if (o.heightCm !== undefined) num(o.heightCm, 'profile height');
  if (o.dob !== undefined) isoDay(o.dob, 'profile date of birth');
  if (o.sex !== undefined) oneOf(o.sex, ['male', 'female', 'unspecified'], 'profile sex');
  if (o.activityLevel !== undefined) oneOf(o.activityLevel, ['sedentary', 'light', 'moderate', 'active', 'veryActive'], 'profile activity level');
  // Shape only, on purpose: a stored 0 or 150 is not clamped or dropped here. The code that uses body fat rejects an
  // implausible value where it is used, so the person can see it and correct it.
  if (o.bodyFatPct !== undefined) num(o.bodyFatPct, 'profile body fat');
  // An omitted goal stays absent: it is unknown, never a default of hold.
  if (o.goal !== undefined) {
    const g = obj(o.goal, 'profile goal');
    oneOf(g.kind, GOAL_KINDS, 'profile goal kind');
    if (g.rateKgPerWeek !== undefined) num(g.rateKgPerWeek, 'profile goal rate');
  }
  arr(o.weightLog, 'profile weight log').forEach((w, i) => {
    const wo = obj(w, `weight ${i + 1}`);
    isoDay(wo.date, `weight ${i + 1} date`);
    num(wo.kg, `weight ${i + 1}`);
  });
  strings(o.flaggedAllergens, 'profile allergens');
  strings(o.conditions, 'profile conditions');
  if (o.overrides !== undefined) {
    for (const [k, x] of Object.entries(obj(o.overrides, 'profile overrides'))) {
      // Overrides are plain numbers (Profile['overrides']); a nested map or a flag would make every later profile save throw.
      num(x, `profile override ${k}`);
    }
  }
  return v as Profile;
}

function unique(rows: { id: string }[], what: string): void {
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) fail(what, `has the id "${r.id}" more than once`);
    seen.add(r.id);
  }
}
function uniqueDays(rows: HealthDay[]): void {
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.date)) fail('health days', `has the day "${r.date}" more than once`);
    seen.add(r.date);
  }
}

type Parsed = { rows: ImportRows; profile: Profile | null; settings: Record<string, string> };

/** Parses and checks the WHOLE file. Throws on the first problem. Touches no store. */
export function parseExport(text: string): Parsed {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('The file is not a valid backup: it is not readable JSON.');
  }
  const o = obj(raw, 'the file');
  if (o.format !== EXPORT_FORMAT) fail('the file', 'is not a Food Diary export');
  const version = num(o.version, 'version');
  if (version !== EXPORT_VERSION) fail('the file', `is format version ${version}, which this app does not read`);
  const entries = arr(o.entries, 'entries').map(entry);
  const customFoods = arr(o.customFoods, 'custom foods').map(customFood);
  const batches = arr(o.batches, 'batches').map(batch);
  unique(entries, 'entries');
  unique(customFoods, 'custom foods');
  unique(batches, 'batches');
  // An older backup has no healthDays key: that reads as none. A present key must be a list.
  const healthDays = o.healthDays === undefined ? [] : arr(o.healthDays, 'health days').map(healthDay).filter((h): h is HealthDay => h !== null);
  uniqueDays(healthDays);
  // Absent in an older backup, which reads as none. A saved meal is a name and a list of refs; its figures
  // were never stored, so there is nothing here that could restore a wrong number.
  const savedMeals = o.savedMeals === undefined ? [] : arr(o.savedMeals, 'saved meals').map(savedMeal);
  const prof = o.profile === null || o.profile === undefined ? null : profile(o.profile);
  const settings: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(o.settings ?? {}, 'settings'))) {
    if (!k.startsWith(LS_PREFIX)) fail(`setting "${k}"`, `is outside this app's settings`);
    if (EXCLUDED_LS.has(k)) fail(`setting "${k}"`, 'is not something a backup may carry');
    settings[k] = str(v, `setting "${k}"`);
  }
  return { rows: { entries, customFoods, batches, healthDays, savedMeals }, profile: prof, settings };
}

// ---- import ----

function lsSnapshot(): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(LS_PREFIX)) m.set(k, localStorage.getItem(k) ?? '');
  }
  return m;
}
function lsRestore(snap: Map<string, string>): void {
  for (const k of [...lsSnapshot().keys()]) if (!snap.has(k)) localStorage.removeItem(k);
  for (const [k, v] of snap) localStorage.setItem(k, v);
}

/**
 * Validates the whole file, then writes. `merge` adds what is missing and keeps every local row, the
 * local profile and local settings; `replace` makes the store match the file. Counts cover entries,
 * custom foods, batches, health days and saved meals together. Throws, having changed nothing, if the file is not valid or a
 * store refuses the write.
 */
export async function importAll(file: File, mode: 'merge' | 'replace'): Promise<{ added: number; skipped: number }> {
  const parsed = parseExport(await file.text());
  const before = lsSnapshot();
  try {
    // localStorage first, with a snapshot to return to: it is the part that can fail without a transaction.
    if (mode === 'replace') {
      // Writes first, removals last: a refused write then fails before anything has been taken away.
      if (parsed.profile) localStorage.setItem(PROFILE_LS, JSON.stringify(parsed.profile));
      for (const [k, v] of Object.entries(parsed.settings)) localStorage.setItem(k, v);
      for (const k of before.keys()) {
        if (EXCLUDED_LS.has(k) && k !== PROFILE_LS) continue;
        if (k === PROFILE_LS ? parsed.profile === null : !(k in parsed.settings)) localStorage.removeItem(k);
      }
    } else {
      if (parsed.profile && !before.has(PROFILE_LS)) localStorage.setItem(PROFILE_LS, JSON.stringify(parsed.profile));
      for (const [k, v] of Object.entries(parsed.settings)) if (!before.has(k)) localStorage.setItem(k, v);
    }
    return await writeImportedRows(parsed.rows, mode);
  } catch (err) {
    try {
      lsRestore(before);
    } catch {
      /* the original error is the one to report */
    }
    throw err;
  }
}
