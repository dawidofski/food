/**
 * Food repository: fetching the bundled dataset and holding it in module state.
 *
 * Matching lives in ./foodSearch — including why `score` is not a quality signal. This module
 * only owns the load: it is idempotent, shares in-flight work, never rejects (the UI must stay
 * usable for custom foods when the dataset is missing), and retries after a failure.
 */
import type { DatasetFood } from '@/types/food';
import { type FoodHit, type SearchIndex, buildSearchIndex, search } from '@/data/foodSearch';

// The repository's public API is unchanged by the split: these still come from here.
export { QUERY_SYNONYMS, normalizeTokens, singularize } from '@/data/foodSearch';
export type { FoodHit };

export type DatasetState = 'unloaded' | 'loading' | 'ready' | 'failed';

let state: DatasetState = 'unloaded';
let inflight: Promise<void> | null = null;
let generation = 0;
let byId = new Map<string, DatasetFood>();
let index: SearchIndex | null = null;

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
    index = buildSearchIndex(loaded);
    state = 'ready';
  } catch {
    if (gen !== generation) return;
    byId = new Map();
    index = null;
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
  return index ? search(index, query, limit) : [];
}

/** Test helper: returns the module to its initial unloaded state. */
export function resetFoodRepository(): void {
  generation++;
  state = 'unloaded';
  inflight = null;
  byId = new Map();
  index = null;
}
