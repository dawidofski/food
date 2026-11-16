import type { Context } from '@/rules/types';
import type { DayTotals, PatternNutrient } from '@/domain/totals';
import { NUTRIENT_KEYS, type ClassificationFlags, type Coverage, type NutrientKey, type NutrientSet } from '@/types/nutrients';
import { ownerProfile } from '../fixtures/profile';

const flags: ClassificationFlags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
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
  /** Flags on the pending entry (the merged worst case). Per-item flags come from `refs`. */
  classification?: Partial<ClassificationFlags>;
  /** Pending items, each with its own flags and grams. Defaults to one item carrying `classification`. */
  refs?: { grams: number; flags?: Partial<ClassificationFlags> }[];
  /** Grams of the single default pending item. */
  pendingGrams?: number;
  pendingEnergy?: number;
  pendingFibre?: number;
  pendingProtein?: number;
  /** Week context, committed entries only (the pending entry is not in it). */
  weekProcessedMeatOccasions?: number;
  weekRedMeatGrams?: number;
  weekAlcoholOccasions?: number;
  weekSweetDrinkOccasions?: number;
  weekUltraProcessedOccasions?: number;
  /** Days in the seven-day window with entries. Default 6, enough for a frequency note. */
  weekLoggedDays?: number;
  /**
   * Complete day totals for the six days BEFORE today, per nutrient. The default is five complete days per nutrient,
   * three of them above the figure in `targets`, so every probe exercises the pattern note.
   */
  weekCompleteDaysBeforeToday?: Partial<Record<PatternNutrient, number[]>>;
  /** Entries already committed today, and how many of them are NOVA 4. Default 2 entries, none NOVA 4. */
  todayEntryCount?: number;
  todayNova4Entries?: number;
  /** Resolved food identity of the pending entry. Absent = no identity known. */
  foodName?: string;
  foodAllergens?: string[];
  foodSource?: 'dataset' | 'custom' | 'batch';
  /** The user's flagged allergens (profile). Default none, which is the shipped default. */
  flagged?: string[];
  answers?: Record<string, boolean>;
  rawText?: string;
};

/** Builds a context whose measured values are exactly the ones given. A nutrient not given is unknown, never zero. */
export function ctx(o: Opts = {}): Context {
  const pendingN: NutrientSet = { energyKcal: o.pendingEnergy ?? 300 };
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
  set('fibreG', o.pendingFibre);
  set('proteinG', o.pendingProtein);

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
    dayKey: '2026-11-15', entryCount: o.emptyDay ? 0 : (o.todayEntryCount ?? 2),
    nova4EntryCount: o.emptyDay ? 0 : (o.todayNova4Entries ?? 0), nutrients: todayN, coverage: todayC, energyCoveredShare: share,
    vegCupEq: 0, vegCoverage: 'known', hasVegetableFlag: false,
  };
  const merged: ClassificationFlags = { ...flags, ...o.classification };
  const refs = (o.refs ?? [{ grams: o.pendingGrams ?? 100, flags: o.classification }]).map((r, i) => ({
    source: 'dataset' as const, foodId: `probe-${i}`, grams: r.grams, classification: { ...flags, ...r.flags },
  }));
  return {
    // Identity is always supplied, as a real caller must: an entry with items but no foods is a reported failure (see engine).
    foods: [{ name: o.foodName ?? 'probe food', allergens: o.foodAllergens ?? [], source: o.foodSource ?? 'dataset' }],
    ...(o.rawText !== undefined ? { rawText: o.rawText } : {}),
    pending: {
      refs,
      nutrients: pendingN, coverage: pendingC, classification: merged, needsHelp: [], confidence: 1,
    },
    today,
    week: {
      days: [today], processedMeatOccasions: o.weekProcessedMeatOccasions ?? 0, redMeatGrams: o.weekRedMeatGrams ?? 0,
      alcoholOccasions: o.weekAlcoholOccasions ?? 0,
      vegCupEqByDay: [0], daysWithoutVegetable: 0, daysVegetableUnknown: 0,
      loggedDays: o.weekLoggedDays ?? 6,
      sweetDrinkOccasions: o.weekSweetDrinkOccasions ?? 2,
      ultraProcessedOccasions: o.weekUltraProcessedOccasions ?? 3,
      // Against the targets below: sodium 2,000 mg, added sugar 63 g, saturated fat 28 g — three days above each.
      completeDayTotalsBeforeToday: {
        sodiumMg: [1500, 2100, 2300, 1800, 2400],
        addedSugarsG: [40, 70, 80, 55, 90],
        satFatG: [20, 30, 35, 22, 40],
        ...o.weekCompleteDaysBeforeToday,
      },
    },
    // Consistent with a 2,500 kcal day: 2,000 mg sodium, 10% / 5% of energy as sugar, 10% as saturated fat, 1% as trans fat.
    targets: {
      energyKcal: 2500, rmrKcal: 1900, proteinG: 100, proteinFloorG: 80, fibreG: 30, sodiumMg: 2000, satFatG: 28,
      addedSugarsG: 63, addedSugarsIdealG: 31, transFatG: 3, micronutrients: {}, isGeneric: false,
    },
    profile: { ...ownerProfile, flaggedAllergens: o.flagged ?? [] },
    now: new Date(`2026-11-15T${String(o.hour ?? 12).padStart(2, '0')}:00:00`),
    answers: o.answers ?? {},
  };
}

/** One context per rule that makes it fire, with the level it must return. Every rule must appear here. */
export const probes: Record<string, { ctx: Context; level: 'INFO' | 'MODERATE' | 'HIGH' | 'CRITICAL' }[]> = {
  'sodium-entry': [{ ctx: ctx({ pendingSodium: 2400 }), level: 'MODERATE' }],
  'sodium-daily': [
    { ctx: ctx({ todaySodium: 1800, pendingSodium: 400 }), level: 'MODERATE' },
    { ctx: ctx({ todaySodium: 2000, pendingSodium: 1240 }), level: 'MODERATE' },
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
  'trans-fat': [{ ctx: ctx({ pendingTransFat: 4 }), level: 'MODERATE' }],
  'processed-meat': [{ ctx: ctx({ classification: { processedMeat: true }, pendingGrams: 114 }), level: 'HIGH' }],
  'processed-meat-frequency': [
    { ctx: ctx({ classification: { processedMeat: true }, weekProcessedMeatOccasions: 2 }), level: 'INFO' },
  ],
  'red-meat-weekly': [
    { ctx: ctx({ classification: { redMeat: true }, pendingGrams: 150, weekRedMeatGrams: 450 }), level: 'MODERATE' },
  ],
  alcohol: [
    { ctx: ctx({ classification: { alcohol: true } }), level: 'MODERATE' },
    { ctx: ctx({ classification: { alcohol: true }, weekAlcoholOccasions: 9 }), level: 'MODERATE' },
  ],
  'sweet-drink': [{ ctx: ctx({ classification: { sweetDrink: true }, pendingGrams: 330 }), level: 'INFO' }],
  'ultra-processed': [
    { ctx: ctx({ classification: { novaGroup: 4 }, todayEntryCount: 3, todayNova4Entries: 2 }), level: 'INFO' },
  ],
  'nutrient-density': [{ ctx: ctx({ pendingEnergy: 600, pendingFibre: 0.5, pendingProtein: 2 }), level: 'INFO' }],
  // Task 13. Each fires only on a resolved food identity plus (for hazards) an explicit yes.
  'allergen-flagged': [
    { ctx: ctx({ flagged: ['peanuts'], foodName: 'Peanut butter', foodAllergens: ['peanuts'] }), level: 'CRITICAL' },
    { ctx: ctx({ flagged: ['sesame'], foodName: 'My tahini', foodAllergens: ['sesame'], foodSource: 'custom' }), level: 'CRITICAL' },
  ],
  'food-safety-rice': [{ ctx: ctx({ foodName: 'Rice, brown, cooked, no added fat', answers: { reheatedRice: true } }), level: 'CRITICAL' }],
  'food-safety-kidney-beans': [
    { ctx: ctx({ foodName: 'Kidney beans, from dried, no added fat', answers: { rawKidneyBeans: true } }), level: 'CRITICAL' },
  ],
  'food-safety-raw-milk': [{ ctx: ctx({ foodName: 'Milk, whole', answers: { rawMilk: true } }), level: 'CRITICAL' }],
};
