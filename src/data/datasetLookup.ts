import type { FoodLookup } from '@/domain/foodLookup';
import { getFood, searchFoods } from '@/data/foodRepository';

/** The bundled dataset as a FoodLookup provider (reads the repository's module state at call time). */
export const datasetLookup: FoodLookup = {
  search: (query, limit) =>
    searchFoods(query, limit).map((h) => ({ source: 'dataset' as const, food: h.food, score: h.score })),
  get: (source, id) => (source === 'dataset' ? getFood(id) : undefined),
};
