/**
 * Scanned products, held locally, and the lookup that lets the rest of the app treat one like any other food.
 *
 * The cache is the politeness this app can actually offer Open Food Facts (see offApi.ts): a product scanned twice
 * is fetched once. It is a CACHE, not history — a diary entry snapshots its own nutrients at commit, so clearing
 * it rewrites nothing.
 *
 * Nothing scanned is searchable until it has been scanned: this provider only ever holds products the owner
 * scanned themselves, so a name typed into the Log box can reach one (which is what makes "log that again" from
 * the Recent list work) but no crowdsourced food can arrive without a deliberate scan first.
 */
import { allOffProducts, getOffProduct, onEraseEverything, putOffProduct } from '@/data/db';
import { buildSearchIndex, normalizeTokens, search, type SearchIndex } from '@/data/foodSearch';
import { fetchOffProduct, type OffFetchDeps } from '@/data/offApi';
import { combineLookups, type FoodLookup } from '@/domain/foodLookup';
import { offProductToDatasetShape } from '@/domain/openFoodFacts';
import type { DatasetFood, OffProduct } from '@/types/food';

type Cache = { foods: Map<string, DatasetFood>; meta: Map<string, OffProduct>; index: SearchIndex };

let cache: Cache = { foods: new Map(), meta: new Map(), index: buildSearchIndex([]) };

function install(list: OffProduct[]): void {
  const adapted = list.map(offProductToDatasetShape);
  cache = {
    foods: new Map(adapted.map((f) => [f.id, f])),
    meta: new Map(list.map((p) => [p.barcode, p])),
    index: buildSearchIndex(adapted),
  };
}

/** Reloads the in-memory index from storage. The entry flow calls this before each lookup via `loadData`. */
export async function refreshOffFoods(): Promise<void> {
  install(await allOffProducts());
}

// An erase must empty this too, or an erased product stays searchable and loggable from memory.
onEraseEverything(() => install([]));

const sameWords = (a: string, b: string): boolean => normalizeTokens(a).join(' ') === normalizeTokens(b).join(' ');

/**
 * Scanned products as a FoodLookup. An exact name match scores 0, as a custom food's does, so re-logging the exact
 * text of an earlier scanned entry finds the product again rather than a near-miss from the US dataset. The
 * providers are joined custom-first in `defaultDeps`, so the person's own food still wins a tie against a
 * crowdsourced one.
 */
export const offLookup: FoodLookup = {
  search(query, limit = 10) {
    return search(cache.index, query, limit).map((h) => ({
      source: 'off' as const,
      food: h.food,
      score: sameWords(h.food.name, query) || h.food.synonyms.some((s) => sameWords(s, query)) ? 0 : h.score,
    }));
  },
  get: (source, id) => (source === 'off' ? cache.foods.get(id) : undefined),
};

/** Scanned products, then the given provider. */
export function withOpenFoodFacts(base: FoodLookup): FoodLookup {
  return combineLookups(offLookup, base);
}

/**
 * When this product was fetched, and when Open Food Facts says it was last edited by anyone. Both are shown to the
 * person: a cached figure must never read as a fresh one, and a crowdsourced figure must carry the date of the
 * last hand that touched it. Reads the in-memory cache, so it is synchronous and safe to call while rendering.
 */
export function offProductMeta(barcode: string): { fetchedAt: string; lastModified?: string } | undefined {
  const p = cache.meta.get(barcode);
  if (!p) return undefined;
  return p.lastModified !== undefined ? { fetchedAt: p.fetchedAt, lastModified: p.lastModified } : { fetchedAt: p.fetchedAt };
}

export type FindResult =
  | { kind: 'found'; product: OffProduct; fromCache: boolean }
  | { kind: 'not-found' }
  | { kind: 'unusable'; reason: string }
  | { kind: 'offline'; reason: string }
  | { kind: 'failed'; reason: string };

/**
 * The cache first, then one request. `refetch` asks again on purpose, which is the only way a product edited
 * upstream (or a mapping this app has since improved) reaches a barcode that was already scanned.
 *
 * A failed or not-found lookup stores NOTHING: an absent product must not become a cached empty one.
 */
export async function findScannedProduct(
  barcode: string,
  opts: { refetch?: boolean; deps?: OffFetchDeps } = {},
): Promise<FindResult> {
  if (opts.refetch !== true) {
    const cached = await getOffProduct(barcode).catch(() => undefined);
    if (cached) {
      if (!cache.foods.has(barcode)) await refreshOffFoods().catch(() => undefined);
      return { kind: 'found', product: cached, fromCache: true };
    }
  }
  const result = await fetchOffProduct(barcode, opts.deps);
  if (result.kind !== 'found') return result;
  try {
    await putOffProduct(result.product);
    await refreshOffFoods();
  } catch {
    // The product is still usable for this one entry even if it could not be cached; the next scan refetches.
    install([...cache.meta.values(), result.product]);
  }
  return { kind: 'found', product: result.product, fromCache: false };
}
