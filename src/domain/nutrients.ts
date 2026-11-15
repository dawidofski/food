import {
  NUTRIENT_KEYS,
  type ClassificationFlags,
  type Coverage,
  type NutrientSet,
} from '@/types/nutrients';

/** Scales a per-100g set to a gram amount. Absent keys stay absent (unknown). */
export function scalePer100g(per100g: NutrientSet, grams: number): NutrientSet {
  const out: NutrientSet = {};
  for (const key of NUTRIENT_KEYS) {
    if (key in per100g) {
      out[key] = (per100g[key] as number) * (grams / 100);
    }
  }
  return out;
}

/**
 * Sums nutrient sets. A key is summed only over the sets that know it.
 * Coverage: 'known' if every set had the key, 'partial' if some did,
 * 'unknown' if none did. Keys no set knew are absent from the total.
 */
export function sumNutrients(sets: NutrientSet[]): { total: NutrientSet; coverage: Coverage } {
  const total: NutrientSet = {};
  const coverage: Coverage = {};
  for (const key of NUTRIENT_KEYS) {
    const withKey = sets.filter((s) => key in s);
    if (withKey.length === 0) {
      coverage[key] = 'unknown';
      continue;
    }
    coverage[key] = withKey.length === sets.length ? 'known' : 'partial';
    total[key] = withKey.reduce((acc, s) => acc + (s[key] as number), 0);
  }
  return { total, coverage };
}

/**
 * Worst case wins: boolean flags are OR-ed, novaGroup takes the maximum.
 * An empty list yields the identity: no flags set, novaGroup 1.
 */
export function mergeClassification(flags: ClassificationFlags[]): ClassificationFlags {
  const merged: ClassificationFlags = {
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
  };
  for (const f of flags) {
    merged.processedMeat ||= f.processedMeat;
    merged.redMeat ||= f.redMeat;
    merged.sweetDrink ||= f.sweetDrink;
    merged.alcohol ||= f.alcohol;
    merged.refinedGrain ||= f.refinedGrain;
    merged.vegetable ||= f.vegetable;
    merged.fruit ||= f.fruit;
    merged.legume ||= f.legume;
    merged.oilyFish ||= f.oilyFish;
    if (f.novaGroup > merged.novaGroup) merged.novaGroup = f.novaGroup;
  }
  return merged;
}

/** Share of total energy contributed by a nutrient: 9 kcal/g for fat, 4 kcal/g for sugar. */
export function energyShare(
  nutrientG: number,
  key: 'satFatG' | 'addedSugarsG' | 'transFatG',
  energyKcal: number,
): number {
  const kcalPerG = key === 'addedSugarsG' ? 4 : 9;
  return (nutrientG * kcalPerG) / energyKcal;
}
