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
 * entry (passata), the right answer is no hit, so the user adds their own food rather than
 * logging plausible-looking wrong numbers.
 * Deliberately absent: chips (UK fries vs US crisps), mince (beef, lamb or pork), sweets.
 *
 * Frozen, like SYNONYM_PHRASES below, which is derived from it once at import: a runtime
 * write here would not reach the search, so it must fail loudly instead of silently.
 * Keep the replacement as short as the food needs: every mapped token has to appear in the
 * candidate's name, so extra words ("green raw") make compounds like "zucchini bread"
 * unmatchable. Ranking, not the query, picks the plain variant.
 */
export const QUERY_SYNONYMS: Readonly<Record<string, string>> = Object.freeze({
  coke: 'cola',
  pepsi: 'cola',
  crisps: 'potato chips',
  aubergine: 'eggplant',
  // USDA's zucchini is summer squash; the dataset's only "Zucchini" food is pickled (Na 951).
  // The map replaces the query, so it wins over that direct name match; base-form ranking
  // then picks "Summer squash, green, raw" out of the 14 summer-squash foods.
  zucchini: 'summer squash',
  zucchinis: 'summer squash', // the "-is" plural guard keeps this unsingularised
  courgette: 'summer squash',
  yoghurt: 'yogurt',
  penne: 'pasta',
  fusilli: 'pasta',
  rigatoni: 'pasta',
  rocket: 'arugula',
  coriander: 'cilantro',
  prawn: 'shrimp',
  fries: 'french fries',
});

/**
 * Words marking the plain/base variant of a FNDDS food, held in the same singularised form the
 * stored tokens use — "nfs" normalises to "nf", so a literal set would never match it.
 */
const BASE_MARKERS = new Set(['raw', 'cooked', 'nfs', 'plain', 'whole'].map(singularize));

/**
 * The stored singular form of one word: what dataset names, synonym keys and the Fuse index are
 * all normalised to. One canonical spelling per word, so "-ies" has to commit to "y".
 *
 * Not handled: "-ves" (leaves, loaves). A blanket "-ves" -> "-f" rule would wreck
 * olives/knives-shaped words, and plurals already match without it because query and name are
 * singularised the same way ("leaves" -> "leave" on both sides).
 */
export function singularize(w: string): string {
  if (w.length > 3 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && /(ss|x|z|ch|sh|o)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 2 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

/**
 * The forms of a QUERY word that may match a stored token, Fuse search pattern first. Always
 * contains singularize(w), because that is the spelling the dataset side was stored under.
 *
 * English spells two different plurals "-ies" — cookies/cookie and candies/candy — and nothing
 * in the word says which, so the canonical "y" alone left all 93 cookie, 22 pie and 5 brownie
 * foods unreachable by their plural. Both forms are offered and the dataset decides which
 * exists; the "ie" form leads because it is the one Fuse can retrieve either way (as a pattern,
 * "cookie" finds "cookie" exactly and "candy" within threshold, while "cooky" nearly misses
 * "cookie"). A word the dataset itself spells "-ies" stays reachable because its stored form is
 * the "y" one, which both a plural and a singular query ask for.
 */
function singularForms(w: string): string[] {
  const canonical = singularize(w);
  if (w.length > 3 && w.endsWith('ies')) return [w.slice(0, -1), canonical];
  return [canonical];
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

/** Lowercase, strip punctuation, collapse whitespace, singularise simple English plurals. */
export function normalizeTokens(text: string): string[] {
  return words(text).map(singularize);
}

const SYNONYM_PHRASES = new Map(
  Object.entries(QUERY_SYNONYMS).map(([k, v]) => [normalizeTokens(k).join(' '), normalizeTokens(v)]),
);

/**
 * One query word as the forms the gate will accept. A synonym replacement is itself
 * unambiguous, so it contributes one form per token.
 */
type QueryToken = string[];

function queryTokens(query: string, useSynonyms: boolean): QueryToken[] {
  const forms = words(query).map(singularForms);
  if (!useSynonyms) return forms;
  // Synonym keys and values are stored in canonical form, so look a word up under whichever of
  // its forms is the canonical one.
  const whole = SYNONYM_PHRASES.get(normalizeTokens(query).join(' '));
  if (whole) return whole.map((t) => [t]);
  return forms.flatMap((f) => {
    const key = f.find((x) => SYNONYM_PHRASES.has(x));
    const mapped = key === undefined ? undefined : SYNONYM_PHRASES.get(key);
    return mapped ? mapped.map((t) => [t]) : [f];
  });
}

function sameTokens(a: QueryToken[], b: QueryToken[]): boolean {
  return a.length === b.length && a.every((f, i) => f[0] === b[i]?.[0]);
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

/**
 * Any candidate form may match exactly, but the typo tolerance is only spent on a word whose
 * singular is certain. Where two forms are guesses, one edit on top of the guess reaches a
 * different food: "candies" would take "Apple, candied" and "browny" is one edit from "brown".
 */
function tokenMatches(forms: QueryToken, field: string[]): boolean {
  const certain = forms.length === 1 ? forms[0]! : '';
  return field.some(
    (t) => forms.includes(t) || (certain.length >= 5 && withinOneEdit(certain, t)),
  );
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
 * A wordier qualifier is a narrower food, so each word past the first adds a little: that is
 * what puts "Summer squash, green, raw" ahead of "Summer squash, cooked, as ingredient".
 */
function qualifierPenalty(segs: string[][], qt: QueryToken[]): number {
  let penalty = 0;
  let firstMatch = -1;
  segs.forEach((seg, i) => {
    const matched = qt.some((q) => tokenMatches(q, seg));
    const extra = seg.filter((t) => !BASE_MARKERS.has(t) && !qt.some((q) => tokenMatches(q, [t])));
    if (matched) {
      if (firstMatch < 0) firstMatch = i;
      penalty += 0.05 * extra.length;
    } else {
      penalty += extra.length === 0 ? -0.02 : 0.02 + 0.005 * (extra.length - 1);
    }
  });
  return penalty + 0.01 * Math.max(firstMatch, 0);
}

let state: DatasetState = 'unloaded';
let inflight: Promise<void> | null = null;
let generation = 0;
let byId = new Map<string, DatasetFood>();
let index: Fuse<Doc> | null = null;
let docs: Doc[] = [];

/** BASE_URL always ends in exactly one slash, so `${base}data/...` never has a double slash. */
function dataUrl(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/*$/, '/');
  return `${base}data/${path}`;
}

async function fetchJson(fetchImpl: typeof fetch, url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetchImpl(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return JSON.parse(await res.text());
}

async function doLoad(fetchImpl: typeof fetch, gen: number): Promise<void> {
  try {
    // The foods file is hash-named; meta.json says which one is current. Static hosts serve
    // meta.json with a max-age (GitHub Pages: ~10 min), so a cached copy can name a hash that
    // no longer exists and the load fails until it expires: always revalidate this one.
    const meta = await fetchJson(fetchImpl, dataUrl('meta.json'), { cache: 'no-cache' });
    const file = (meta as { file?: unknown } | null)?.file;
    if (typeof file !== 'string' || file === '') throw new Error('meta.json has no file field');
    // The foods file is immutable (its name carries the hash), so it may be cached normally.
    const data = await fetchJson(fetchImpl, dataUrl(file));
    if (!Array.isArray(data)) throw new Error('foods file is not an array');
    if (gen !== generation) return; // reset while in flight; drop the result
    const loaded = data as DatasetFood[];
    byId = new Map(loaded.map((f) => [f.id, f]));
    docs = loaded.map((food) => {
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

function collect(qt: QueryToken[], limit: number): FoodHit[] {
  if (!index || qt.length === 0) return [];
  // Fuse supplies the score (0 exact .. 1 poor); the token filter guarantees every
  // query word is really present, which Fuse's whole-string scoring does not. Where a word has
  // two candidate forms, both patterns are searched and each food keeps its better score, so an
  // "-ies" plural is scored against the spelling the dataset actually stores.
  const patterns = new Set([
    qt.map((f) => f[0]!).join(' '),
    qt.map((f) => f[f.length - 1]!).join(' '),
  ]);
  const best = new Map<Doc, number>();
  for (const pattern of patterns) {
    for (const r of index.search(pattern)) {
      const score = r.score ?? 1;
      const prev = best.get(r.item);
      if (prev === undefined || score < prev) best.set(r.item, score);
    }
  }
  const hits: { hit: FoodHit; rank: number }[] = [];
  for (const [d, base] of best) {
    const inName = qt.every((q) => tokenMatches(q, d.nameTokens));
    const inSyn = !inName && d.synTokens.some((st) => qt.every((q) => tokenMatches(q, st)));
    if (!inName && !inSyn) continue;
    const score = Math.min(1, base + (inSyn ? 0.1 : 0));
    const rank = 0.2 * score + qualifierPenalty(d.segTokens, qt) + (inSyn ? 1 : 0); // name matches always beat category-label matches
    hits.push({ hit: { food: d.food, score }, rank });
  }
  // Total order: equal ranks must not fall through to the dataset's own order, or rebuilding
  // the dataset would silently reshuffle near-equal hits.
  hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.hit.food.name.localeCompare(b.hit.food.name) ||
      a.hit.food.id.localeCompare(b.hit.food.id),
  );
  return hits.slice(0, limit).map((h) => h.hit);
}

export function searchFoods(query: string, limit = 10): FoodHit[] {
  if (limit <= 0) return [];
  const mapped = queryTokens(query, true);
  const hits = collect(mapped, limit);
  if (hits.length > 0) return hits;
  // A synonym replaces words, and every word has to be present, so a mapped word poisons any
  // compound the dataset spells literally ("zucchini bread" -> "summer squash bread"). When the
  // mapped query finds nothing there is nothing to lose by trying the words as typed.
  const plain = queryTokens(query, false);
  return sameTokens(mapped, plain) ? [] : collect(plain, limit);
}

/** Test helper: returns the module to its initial unloaded state. */
export function resetFoodRepository(): void {
  generation++;
  state = 'unloaded';
  inflight = null;
  byId = new Map();
  index = null;
  docs = [];
}
