import { NUTRIENT_KEYS, type Coverage, type NutrientKey, type NutrientSet } from '@/types/nutrients';
import { isKnownValue } from './nutrients';

/**
 * A correction is the person's own figure for an entry's nutrient. A number sets it, `null` clears it, and a key the
 * correction does not mention is left exactly as it was (the form offers six figures; this type allows all of them).
 *
 * CLEARING DELETES THE KEY. It never writes a zero. In this app an absent nutrient key means UNKNOWN, and the day's
 * totals read it that way ("we don't know"). A zero says "the meal contained none", a confident and wrong claim about
 * a figure the person has just taken back. Do not tidy the `delete` into `= 0`.
 *
 * The two objects differ on purpose. `nutrients` says unknown by ABSENCE; `coverage` says it by the explicit value
 * 'unknown', because sumNutrients writes every key into coverage and every entry is built through it. Deleting the
 * coverage key would make this the only entry shaped differently, and would leave the rules gate
 * (`cov === 'unknown' || !isKnownValue(...)` in engine.ts) closing only through its second clause. Do not make the
 * two consistent in either direction.
 *
 * A figure the person typed is theirs, so its coverage becomes 'known': they asserted it, whatever the entry's
 * resolution knew before. A typed 0 is a real assertion and is kept as 0; only `null` means unknown.
 *
 * A value that is not a finite non-negative number is refused for that key, which then stays as it was and is not
 * listed as corrected. The form validates as well; this is the last line of defence against a NaN reaching a total.
 *
 * Pure: no store access, and the base is never mutated.
 */
export type Correction = Partial<Record<NutrientKey, number | null>>;

type Base = { nutrients: NutrientSet; coverage: Coverage; correctedKeys?: NutrientKey[] };

export function applyCorrection(
  base: Base,
  c: Correction,
): { nutrients: NutrientSet; coverage: Coverage; correctedKeys: NutrientKey[] } {
  const nutrients: NutrientSet = { ...base.nutrients };
  const coverage: Coverage = { ...base.coverage };
  const corrected = new Set<NutrientKey>(base.correctedKeys ?? []);

  for (const key of NUTRIENT_KEYS) {
    if (!(key in c)) continue;
    const v = c[key];
    if (v === null) {
      delete nutrients[key];
      coverage[key] = 'unknown';
      corrected.delete(key);
    } else if (isKnownValue(v) && v >= 0) {
      nutrients[key] = v;
      coverage[key] = 'known';
      corrected.add(key);
    }
    // Anything else (undefined, NaN, Infinity, negative): refused, the key stays as it was.
  }

  return { nutrients, coverage, correctedKeys: [...corrected] };
}
