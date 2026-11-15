import Fuse from 'fuse.js';
import type { DatasetFood } from '@/types/food';

export type DatasetState = 'unloaded' | 'loading' | 'ready' | 'failed';

export interface FoodHit {
  food: DatasetFood;
  /** Fuse.js convention: 0 is an exact match, 1 is a poor match. */
  score: number;
}

let state: DatasetState = 'unloaded';
let inflight: Promise<void> | null = null;
let generation = 0;
let foods: DatasetFood[] = [];
let byId = new Map<string, DatasetFood>();
let index: Fuse<DatasetFood> | null = null;

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
    index = new Fuse(foods, {
      keys: ['name', 'synonyms'],
      threshold: 0.4,
      includeScore: true,
    });
    state = 'ready';
  } catch {
    if (gen !== generation) return;
    foods = [];
    byId = new Map();
    index = null;
    state = 'failed';
  }
}

/** Loads the bundled dataset. Idempotent, shares in-flight work, and never rejects. */
export function loadFoods(fetchImpl: typeof fetch = fetch): Promise<void> {
  if (inflight) return inflight;
  if (state === 'ready' || state === 'failed') return Promise.resolve();
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
  const q = query.trim();
  if (!index || q === '' || limit <= 0) return [];
  return index.search(q, { limit }).map((r) => ({ food: r.item, score: r.score ?? 1 }));
}

/** Test helper: returns the module to its initial unloaded state. */
export function resetFoodRepository(): void {
  generation++;
  state = 'unloaded';
  inflight = null;
  foods = [];
  byId = new Map();
  index = null;
}
