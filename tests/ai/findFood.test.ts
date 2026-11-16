import { describe, expect, test } from 'vitest';
import { findFoodByDescription } from '@/ai/aiFallback';
import type { FoodLookup } from '@/domain/foodLookup';
import type { DatasetFood } from '@/types/food';

const f = (id: string, name: string): DatasetFood => ({
  id, name, synonyms: [], per100g: {}, portions: [],
  classification: { processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1, refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false },
  allergens: [],
});
const foods = [f('1', 'Pork, fried'), f('2', 'Sausage, pork, cooked'), f('3', 'Sausage, pork'), f('4', 'Sausage, beef'), f('5', 'Bread, white')];
// Mirrors the real search: every query word must appear in the name.
const lookup: FoodLookup = {
  search: (q) => foods
    .filter((x) => q.toLowerCase().split(/\s+/).every((w) => x.name.toLowerCase().includes(w)))
    .map((x) => ({ source: 'dataset' as const, food: x, score: 0.03 })),
  get: () => undefined,
};

describe('findFoodByDescription', () => {
  test('a description that matches no whole name lands on the food covering most of its words', () => {
    expect(findFoodByDescription('deep-fried minced pork sausage', lookup)?.id).toBe('3');
  });
  test('the head noun breaks a tie', () => {
    expect(findFoodByDescription('fried sausage', lookup)?.name).toMatch(/^Sausage/);
  });
  test('nothing in the dataset means no food', () => {
    expect(findFoodByDescription('plutonium', lookup)).toBeNull();
  });
  test('only dataset foods are ever chosen', () => {
    const custom: FoodLookup = { search: () => [{ source: 'custom', food: f('c', 'My secret sausage'), score: 0 }], get: () => undefined };
    expect(findFoodByDescription('sausage', custom)).toBeNull();
  });
});
