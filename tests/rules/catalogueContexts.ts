import type { Context } from '@/rules/types';
import type { DayTotals } from '@/domain/totals';
import { NUTRIENT_KEYS, type Coverage, type NutrientKey, type NutrientSet } from '@/types/nutrients';
import { ownerProfile } from '../fixtures/profile';

const flags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1 as const,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};

export type Opts = {
  pendingSodium?: number;
  pendingAddedSugar?: number;
  pendingSatFat?: number;
  pendingTransFat?: number;
  todaySodium?: number;
  todayAddedSugar?: number;
  todaySatFat?: number;
  hour?: number;
  emptyDay?: boolean;
  /** Nutrients whose pending value is unknown (absent, coverage 'unknown'). */
  unknownPending?: NutrientKey[];
};

/** Builds a context whose measured values are exactly the ones given. A nutrient not given is unknown, never zero. */
export function ctx(o: Opts = {}): Context {
  const pendingN: NutrientSet = { energyKcal: 300 };
  const pendingC: Coverage = { energyKcal: 'known' };
  const set = (k: NutrientKey, v: number | undefined) => {
    if (v === undefined || o.unknownPending?.includes(k)) {
      pendingC[k] = 'unknown';
      return;
    }
    pendingN[k] = v;
    pendingC[k] = 'known';
  };
  set('sodiumMg', o.pendingSodium);
  set('addedSugarsG', o.pendingAddedSugar);
  set('satFatG', o.pendingSatFat);
  set('transFatG', o.pendingTransFat);

  const todayN: NutrientSet = o.emptyDay
    ? {}
    : {
        energyKcal: 1000,
        sodiumMg: o.todaySodium ?? 0,
        addedSugarsG: o.todayAddedSugar ?? 0,
        satFatG: o.todaySatFat ?? 0,
        transFatG: 0,
      };
  const share = {} as Record<NutrientKey, number>;
  const todayC: Coverage = {};
  for (const k of NUTRIENT_KEYS) {
    share[k] = o.emptyDay ? 0 : 1;
    todayC[k] = o.emptyDay ? 'unknown' : 'known';
  }
  const today: DayTotals = {
    dayKey: '2026-11-15', entryCount: o.emptyDay ? 0 : 2, nutrients: todayN, coverage: todayC, energyCoveredShare: share,
    vegCupEq: 0, vegCoverage: 'known', hasVegetableFlag: false,
  };
  return {
    pending: {
      refs: [{ source: 'dataset', foodId: 'probe', grams: 100, classification: flags }],
      nutrients: pendingN, coverage: pendingC, classification: flags, needsHelp: [], confidence: 1,
    },
    today,
    week: {
      days: [today], processedMeatOccasions: 0, redMeatGrams: 0, alcoholOccasions: 0,
      vegCupEqByDay: [0], daysWithoutVegetable: 0, daysVegetableUnknown: 0,
    },
    // Consistent with a 2,500 kcal day: 2,000 mg sodium, 10% / 5% of energy as sugar, 10% as saturated fat, 1% as trans fat.
    targets: {
      energyKcal: 2500, rmrKcal: 1900, proteinG: 100, proteinFloorG: 80, fibreG: 30, sodiumMg: 2000, satFatG: 28,
      addedSugarsG: 63, addedSugarsIdealG: 31, transFatG: 3, isGeneric: false,
    },
    profile: ownerProfile,
    now: new Date(`2026-11-15T${String(o.hour ?? 12).padStart(2, '0')}:00:00`),
    answers: {},
  };
}

/** One context per rule that makes it fire, with the level it must return. Every rule must appear here. */
export const probes: Record<string, { ctx: Context; level: 'INFO' | 'MODERATE' | 'HIGH' }[]> = {
  'sodium-entry': [{ ctx: ctx({ pendingSodium: 2400 }), level: 'MODERATE' }],
  'sodium-daily': [
    { ctx: ctx({ todaySodium: 1800, pendingSodium: 400 }), level: 'MODERATE' },
    { ctx: ctx({ todaySodium: 2000, pendingSodium: 1240 }), level: 'HIGH' },
  ],
  'added-sugar-entry': [
    { ctx: ctx({ pendingAddedSugar: 40 }), level: 'INFO' },
    { ctx: ctx({ pendingAddedSugar: 70 }), level: 'MODERATE' },
  ],
  'added-sugar-daily': [
    { ctx: ctx({ todayAddedSugar: 30, pendingAddedSugar: 5 }), level: 'INFO' },
    { ctx: ctx({ todayAddedSugar: 60, pendingAddedSugar: 20 }), level: 'MODERATE' },
  ],
  'saturated-fat-daily': [{ ctx: ctx({ todaySatFat: 25, pendingSatFat: 10 }), level: 'MODERATE' }],
  'trans-fat': [{ ctx: ctx({ pendingTransFat: 4 }), level: 'HIGH' }],
};
