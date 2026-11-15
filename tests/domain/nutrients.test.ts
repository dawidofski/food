import { describe, expect, test } from 'vitest';
import type { ClassificationFlags } from '@/types/nutrients';
import {
  energyShare,
  mergeClassification,
  scalePer100g,
  sumNutrients,
} from '@/domain/nutrients';

function base(overrides: Partial<ClassificationFlags> = {}): ClassificationFlags {
  return {
    processedMeat: false,
    redMeat: false,
    sweetDrink: false,
    alcohol: false,
    novaGroup: 1,
    refinedGrain: false,
    vegetable: false,
    fruit: false,
    legume: false,
    oilyFish: false,
    ...overrides,
  };
}

describe('nutrient math', () => {
  test('scalePer100g scales known keys and omits unknown ones', () => {
    const r = scalePer100g({ energyKcal: 300, sodiumMg: 810 }, 57);
    expect(r.energyKcal).toBeCloseTo(171);
    expect(r.sodiumMg).toBeCloseTo(461.7);
    expect('addedSugarsG' in r).toBe(false);
  });

  test('sumNutrients marks a key partial when only some inputs know it', () => {
    const { total, coverage } = sumNutrients([{ addedSugarsG: 12 }, { energyKcal: 90 }]);
    expect(total.addedSugarsG).toBe(12);
    expect(coverage.addedSugarsG).toBe('partial');
    expect(coverage.sodiumMg).toBe('unknown');
  });

  test('sumNutrients never substitutes zero for an unknown value', () => {
    const { total } = sumNutrients([{ energyKcal: 100 }, { energyKcal: 50 }]);
    expect('sodiumMg' in total).toBe(false);
  });

  test('energyShare expresses saturated fat as a share of energy', () => {
    expect(energyShare(31, 'satFatG', 2834)).toBeCloseTo(0.0984, 3);
  });

  test('mergeClassification takes the worst case', () => {
    const r = mergeClassification([base({ novaGroup: 1 }), base({ novaGroup: 4, processedMeat: true })]);
    expect(r.novaGroup).toBe(4);
    expect(r.processedMeat).toBe(true);
  });
});
