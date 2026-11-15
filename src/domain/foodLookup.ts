import type { DatasetFood } from '@/types/food';
import type { FoodSource } from '@/types/diary';

export type LookupHit = {
  source: FoodSource;
  /** Custom foods and batches are adapted to the DatasetFood shape by their own provider. */
  food: DatasetFood;
  /** Fuse convention (0 best). Not a quality signal: see resolveItems. */
  score: number;
};

/**
 * The seam between resolveItems and wherever foods live. A provider searches its own source and
 * fetches by id; later tasks add providers (custom foods, cooked batches) and join them with
 * combineLookups, so resolveItems never changes.
 */
export interface FoodLookup {
  search(query: string, limit?: number): LookupHit[];
  get(source: FoodSource, id: string): DatasetFood | undefined;
}

/** Joins providers. Search results are merged best-score-first (stable, so earlier providers win ties). */
export function combineLookups(...providers: FoodLookup[]): FoodLookup {
  return {
    search(query, limit = 10) {
      return providers
        .flatMap((p) => p.search(query, limit))
        .map((hit, i) => ({ hit, i }))
        .sort((a, b) => a.hit.score - b.hit.score || a.i - b.i)
        .slice(0, limit)
        .map((x) => x.hit);
    },
    get(source, id) {
      for (const p of providers) {
        const food = p.get(source, id);
        if (food) return food;
      }
      return undefined;
    },
  };
}
