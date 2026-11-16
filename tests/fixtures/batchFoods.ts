import { buildSearchIndex, search } from '@/data/foodSearch';
import type { FoodLookup } from '@/domain/foodLookup';
import type { DatasetFood } from '@/types/food';

export const FLAGS = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1 as const,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};

// Per 100 g. Round numbers so the hand arithmetic in the tests is checkable.
export const pasta: DatasetFood = {
  id: 'f-pasta', name: 'Pasta, cooked', synonyms: [],
  per100g: { energyKcal: 160, proteinG: 6, addedSugarsG: 0, sodiumMg: 5 },
  portions: [{ label: '1 cup', grams: 140 }],
  classification: { ...FLAGS, refinedGrain: true }, allergens: ['gluten'],
};
export const passata: DatasetFood = {
  id: 'f-passata', name: 'Tomato passata', synonyms: [],
  per100g: { energyKcal: 30, proteinG: 1.5, addedSugarsG: 0, sodiumMg: 20 },
  portions: [{ label: '1 cup', grams: 250 }],
  classification: { ...FLAGS, vegetable: true }, allergens: [],
};
export const chicken: DatasetFood = {
  id: 'f-chicken', name: 'Chicken breast, cooked', synonyms: [],
  per100g: { energyKcal: 165, proteinG: 31, addedSugarsG: 0, sodiumMg: 74 },
  portions: [{ label: '1 breast', grams: 120 }],
  classification: FLAGS, allergens: [],
};
export const oil: DatasetFood = {
  id: 'f-oil', name: 'Olive oil', synonyms: [],
  per100g: { energyKcal: 884, fatG: 100, addedSugarsG: 0 },
  portions: [{ label: '1 tbsp', grams: 13.5 }],
  classification: { ...FLAGS, novaGroup: 2 }, allergens: [],
};
export const bacon: DatasetFood = {
  id: 'f-bacon', name: 'Bacon, cooked', synonyms: [],
  per100g: { energyKcal: 540, proteinG: 37, addedSugarsG: 0, sodiumMg: 1700 },
  portions: [{ label: '1 slice', grams: 8 }],
  classification: { ...FLAGS, processedMeat: true, redMeat: true, novaGroup: 4 }, allergens: [],
};
// Energy is recorded; added sugars never were.
export const mysterySauce: DatasetFood = {
  id: 'f-sauce', name: 'Mystery sauce', synonyms: [],
  per100g: { energyKcal: 100 },
  portions: [{ label: '1 tbsp', grams: 15 }],
  classification: FLAGS, allergens: [],
};

export function lookupOf(foods: DatasetFood[]): FoodLookup {
  const index = buildSearchIndex(foods);
  const byId = new Map(foods.map((f) => [f.id, f]));
  return {
    search: (q, limit) => search(index, q, limit).map((h) => ({ source: 'dataset' as const, food: h.food, score: h.score })),
    get: (source, id) => (source === 'dataset' ? byId.get(id) : undefined),
  };
}

export const fixtureLookup = lookupOf([pasta, passata, chicken, oil, bacon, mysterySauce]);

export const pastaLines = ['500 g penne', '400 g passata', '300 g chicken breast', '2 tbsp olive oil'];
/** 500 g pasta 800, 400 g passata 120, 300 g chicken 495, 2 tbsp (27 g) oil 238.68. */
export const fixtureBatchTotals = { energyKcal: 800 + 120 + 495 + 27 * 8.84 };
