import { describe, expect, test } from 'vitest';
import type { ClassificationFlags } from '@/types/nutrients';
import {
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

  test('a measured zero is kept, not treated as absent', () => {
    const r = scalePer100g({ sodiumMg: 0 }, 50);
    expect('sodiumMg' in r).toBe(true);
    expect(r.sodiumMg).toBe(0);
  });

  test('summing measured zeros gives a present zero with known coverage', () => {
    const { total, coverage } = sumNutrients([{ sodiumMg: 0 }, { sodiumMg: 0 }]);
    expect('sodiumMg' in total).toBe(true);
    expect(total.sodiumMg).toBe(0);
    expect(coverage.sodiumMg).toBe('known');
  });

  test('a measured zero plus an unknown is a present zero with partial coverage', () => {
    const { total, coverage } = sumNutrients([{ sodiumMg: 0 }, {}]);
    expect(total.sodiumMg).toBe(0);
    expect(coverage.sodiumMg).toBe('partial');
  });

  test('a non-zero value present in every input is known coverage', () => {
    const { total, coverage } = sumNutrients([{ addedSugarsG: 12 }, { addedSugarsG: 3 }]);
    expect(total.addedSugarsG).toBe(15);
    expect(coverage.addedSugarsG).toBe('known');
  });

  test('a present but undefined value is unknown, not NaN', () => {
    const { total, coverage } = sumNutrients([{ sodiumMg: undefined as never }]);
    expect('sodiumMg' in total).toBe(false);
    expect(coverage.sodiumMg).toBe('unknown');
  });

  test('a NaN value is unknown: absent from the total, partial coverage with a real value', () => {
    const { total, coverage } = sumNutrients([{ sodiumMg: NaN }, { sodiumMg: 5 }]);
    expect(total.sodiumMg).toBe(5);
    expect(coverage.sodiumMg).toBe('partial');
  });

  test('scalePer100g with a non-finite grams argument returns an empty set', () => {
    expect(scalePer100g({ sodiumMg: 100 }, NaN)).toEqual({});
  });

  test('scalePer100g omits a present-but-undefined value', () => {
    const r = scalePer100g({ sodiumMg: undefined as never }, 50);
    expect('sodiumMg' in r).toBe(false);
  });

  test('mergeClassification takes the worst case', () => {
    const r = mergeClassification([base({ novaGroup: 1 }), base({ novaGroup: 4, processedMeat: true })]);
    expect(r.novaGroup).toBe(4);
    expect(r.processedMeat).toBe(true);
  });

  test('mergeClassification ORs every boolean flag', () => {
    const r = mergeClassification([
      base({ redMeat: true }),
      base({ sweetDrink: true }),
      base({ alcohol: true }),
      base({ refinedGrain: true }),
      base({ vegetable: true }),
      base({ fruit: true }),
      base({ legume: true }),
      base({ oilyFish: true }),
    ]);
    expect(r).toEqual(
      base({
        redMeat: true,
        sweetDrink: true,
        alcohol: true,
        refinedGrain: true,
        vegetable: true,
        fruit: true,
        legume: true,
        oilyFish: true,
      }),
    );
  });
});
