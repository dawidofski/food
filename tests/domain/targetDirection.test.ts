import { expect, test } from 'vitest';
import { TARGET_DIRECTION, directionOf, type DirectedNutrient } from '@/domain/targetDirection';
import { NUTRIENT_KEYS } from '@/types/nutrients';

test('the nutrients the warning engine limits are ceilings', () => {
  for (const k of ['sodiumMg', 'satFatG', 'addedSugarsG', 'transFatG'] as const) {
    expect(directionOf(k)).toBe('ceiling');
  }
});

test('protein, fibre and every micronutrient are floors', () => {
  for (const k of [
    'proteinG', 'fibreG', 'calciumMg', 'ironMg', 'magnesiumMg', 'zincMg',
    'vitaminCMg', 'vitaminDUg', 'vitaminB12Ug', 'folateUg', 'potassiumMg',
  ] as const) {
    expect(directionOf(k)).toBe('floor');
  }
});

test('energy is neither: it is not a thing to reach or to stay under', () => {
  expect(directionOf('energyKcal')).toBe('none');
});

// Review Focus 5: the map must be exhaustive by construction, not by a default.
test('every directed nutrient has an explicit direction, with no default', () => {
  for (const k of Object.keys(TARGET_DIRECTION) as DirectedNutrient[]) {
    expect(['floor', 'ceiling', 'none']).toContain(TARGET_DIRECTION[k]);
  }
  expect(Object.keys(TARGET_DIRECTION).length).toBeGreaterThanOrEqual(14);
  expect(Object.keys(TARGET_DIRECTION).sort()).toEqual([...NUTRIENT_KEYS].sort());
});
