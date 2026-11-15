/**
 * Food repository. Read this before relying on `score`.
 *
 * The real accept/reject decision in search is TOKEN COMPLETENESS, not the score: a food is
 * returned only when every word of the (normalised, singularised, synonym-mapped) query is
 * present in its name (or in a dataset synonym), allowing one typo in words of 5+ letters.
 * Fuse.js still supplies `score` (0 exact .. 1 poor), but with ignoreLocation and
 * ignoreFieldNorm it is near 0 for any full-word match, so it only separates exact words
 * from typo matches. A threshold on it (e.g. 0.25) is a near no-op; do not treat it as a
 * quality signal. Result ORDER comes from base-form ranking (see qualifierPenalty).
 */
import Fuse from 'fuse.js';
import type { DatasetFood } from '@/types/food';

export type DatasetState = 'unloaded' | 'loading' | 'ready' | 'failed';

export interface FoodHit {
  food: DatasetFood;
  /** Fuse.js convention: 0 is an exact match, 1 is a poor match. */
  score: number;
}

/**
 * Curated colloquialisms the dataset does not carry. Keys and values are plain
 * lowercase phrases; both go through the same normalisation as queries. Extend freely, but
 * only when the target is nutritionally the SAME food. If the dataset has no equivalent
 * entry (passata, courgette: its only zucchini is pickled), the right answer is no hit, so
 * the user adds their own food rather than logging plausible-looking wrong numbers.
 * Deliberately absent: chips (UK fries vs US crisps), mince (beef, lamb or pork), sweets.
 */
export const QUERY_SYNONYMS: Record<string, string> = {
  coke: 'cola',
  pepsi: 'cola',
  crisps: 'potato chips',
  aubergine: 'eggplant',
  yoghurt: 'yogurt',
  penne: 'pasta',
  fusilli: 'pasta',
  rigatoni: 'pasta',
  rocket: 'arugula',
  coriander: 'cilantro',
  prawn: 'shrimp',
  fries: 'french fries',
};

/** Words marking the plain/base variant of a FNDDS food. */
const BASE_MARKERS = new Set(['raw', 'cooked', 'nfs', 'plain', 'whole']);

/** Lowercase, strip punctuation, collapse whitespace, singularise simple English plurals. */
export function singularize(w: string): string {
  if (w.length > 3 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && /(ss|x|z|ch|sh|o)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 2 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

export function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(singularize);
}

const SYNONYM_PHRASES = new Map(
  Object.entries(QUERY_SYNONYMS).map(([k, v]) => [normalizeTokens(k).join(' '), normalizeTokens(v)]),
);

function queryTokens(query: string): string[] {
  const toks = normalizeTokens(query);
  const whole = SYNONYM_PHRASES.get(toks.join(' '));
  if (whole) return whole;
  return toks.flatMap((t) => SYNONYM_PHRASES.get(t) ?? [t]);
}

/** True when a and b are equal or differ by one insertion, deletion or substitution. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

function tokenMatches(q: string, field: string[]): boolean {
  return field.some((t) => t === q || (q.length >= 5 && withinOneEdit(q, t)));
}

interface Doc {
  food: DatasetFood;
  name: string;
  synonyms: string[];
  nameTokens: string[];
  synTokens: string[][];
  segTokens: string[][];
}

/**
 * Ranking nudge, added to the Fuse score for ordering only. FNDDS names read
 * "Head, qualifier, qualifier": a segment that carries the query words plus other words
 * is a different food ("Brandy and cola"); extra qualifier segments make a food more
 * specific, except plain markers (raw, cooked, NFS), which make it the base form.
 */
function qualifierPenalty(segs: string[][], qt: string[]): number {
  let penalty = 0;
  let firstMatch = -1;
  segs.forEach((seg, i) => {
    const matched = qt.some((q) => tokenMatches(q, seg));
    if (matched) {
      if (firstMatch < 0) firstMatch = i;
      penalty += 0.05 * seg.filter((t) => !BASE_MARKERS.has(t) && !qt.some((q) => tokenMatches(q, [t]))).length;
    } else {
      penalty += seg.every((t) => BASE_MARKERS.has(t)) ? -0.02 : 0.02;
    }
  });
  return penalty + 0.01 * Math.max(firstMatch, 0);
}

let state: DatasetState = 'unloaded';
let inflight: Promise<void> | null = null;
let generation = 0;
let foods: DatasetFood[] = [];
let byId = new Map<string, DatasetFood>();
let index: Fuse<Doc> | null = null;
let docs: Doc[] = [];

/** BASE_URL always ends in exactly one slash, so `${base}data/...` never has a double slash. */
function dataUrl(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/*$/, '/');
  return `${base}data/${path}`;
}

async function fetchJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return JSON.parse(await res.text());
}

async function doLoad(fetchImpl: typeof fetch, gen: number): Promise<void> {
  try {
    // The foods file is hash-named; meta.json says which one is current.
    const meta = await fetchJson(fetchImpl, dataUrl('meta.json'));
    const file = (meta as { file?: unknown } | null)?.file;
    if (typeof file !== 'string' || file === '') throw new Error('meta.json has no file field');
    const data = await fetchJson(fetchImpl, dataUrl(file));
    if (!Array.isArray(data)) throw new Error('foods file is not an array');
    if (gen !== generation) return; // reset while in flight; drop the result
    foods = data as DatasetFood[];
    byId = new Map(foods.map((f) => [f.id, f]));
    docs = foods.map((food) => {
      const syns = Array.isArray(food.synonyms) ? food.synonyms : [];
      return {
        food,
        name: normalizeTokens(String(food.name)).join(' '),
        synonyms: syns.map((x) => normalizeTokens(String(x)).join(' ')),
        nameTokens: normalizeTokens(String(food.name)),
        synTokens: syns.map((x) => normalizeTokens(String(x))),
        segTokens: String(food.name).split(',').map(normalizeTokens),
      };
    });
    index = new Fuse(docs, {
      keys: ['name', 'synonyms'],
      threshold: 0.4,
      includeScore: true,
      ignoreLocation: true,
      ignoreFieldNorm: true,
      useExtendedSearch: true,
    });
    state = 'ready';
  } catch {
    if (gen !== generation) return;
    foods = [];
    byId = new Map();
    index = null;
    docs = [];
    state = 'failed';
  }
}

/** Loads the bundled dataset. Idempotent, shares in-flight work, and never rejects. */
export function loadFoods(fetchImpl: typeof fetch = fetch): Promise<void> {
  if (inflight) return inflight;
  if (state === 'ready') return Promise.resolve(); // a 'failed' state retries
  state = 'loading';
  const gen = generation;
  const p = doLoad(fetchImpl, gen).finally(() => {
    if (inflight === p) inflight = null;
  });
  inflight = p;
  return p;
}

export function datasetState(): DatasetState {
  return state;
}

export function getFood(id: string): DatasetFood | undefined {
  return byId.get(id);
}

export function searchFoods(query: string, limit = 10): FoodHit[] {
  const qt = queryTokens(query);
  if (!index || qt.length === 0 || limit <= 0) return [];
  // Fuse supplies the score (0 exact .. 1 poor); the token filter guarantees every
  // query word is really present, which Fuse's whole-string scoring does not.
  const hits: { hit: FoodHit; rank: number }[] = [];
  for (const r of index.search(qt.join(' '))) {
    const d = r.item;
    const inName = qt.every((q) => tokenMatches(q, d.nameTokens));
    const inSyn = !inName && d.synTokens.some((st) => qt.every((q) => tokenMatches(q, st)));
    if (!inName && !inSyn) continue;
    const base = r.score ?? 1;
    const score = Math.min(1, base + (inSyn ? 0.1 : 0));
    const rank = 0.2 * score + qualifierPenalty(d.segTokens, qt) + (inSyn ? 1 : 0); // name matches always beat category-label matches
    hits.push({ hit: { food: d.food, score }, rank });
  }
  hits.sort((a, b) => a.rank - b.rank);
  return hits.slice(0, limit).map((h) => h.hit);
}

/** Test helper: returns the module to its initial unloaded state. */
export function resetFoodRepository(): void {
  generation++;
  state = 'unloaded';
  inflight = null;
  foods = [];
  byId = new Map();
  index = null;
  docs = [];
}
