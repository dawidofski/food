import {
  NUTRIENT_KEYS,
  type ClassificationFlags,
  type Coverage,
  type NutrientSet,
} from '@/types/nutrients';

/** A value counts as known only when it is a finite number. Absent, undefined, NaN and Infinity are unknown. */
export function isKnownValue(v: number | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Scales a per-100g set to a gram amount. Unknown values stay absent.
 * A non-finite gram amount yields an empty set rather than NaN values.
 */
export function scalePer100g(per100g: NutrientSet, grams: number): NutrientSet {
  const out: NutrientSet = {};
  if (!Number.isFinite(grams)) return out;
  for (const key of NUTRIENT_KEYS) {
    const v = per100g[key];
    if (isKnownValue(v)) {
      out[key] = v * (grams / 100);
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
    const values = sets.map((s) => s[key]).filter(isKnownValue);
    if (values.length === 0) {
      coverage[key] = 'unknown';
      continue;
    }
    coverage[key] = values.length === sets.length ? 'known' : 'partial';
    total[key] = values.reduce((acc, v) => acc + v, 0);
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
