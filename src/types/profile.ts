import type { NutrientKey } from './nutrients';

export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'veryActive';

export type Sex = 'male' | 'female' | 'unspecified';

/** Which limit reduced a requested rate: the app's maximum rate, the resting-energy floor, or both. */
export type GoalCap = 'max-rate' | 'floor' | 'both';

/** What the person is aiming for. Absent means no goal has been stated, which is NOT the same as `hold`. */
export type Goal = { kind: 'lose' | 'hold' | 'gain'; rateKgPerWeek?: number };

/** Where each part of the targets comes from. Later tasks and plans read this to say so to the person. */
export type TargetBasis = {
  /** 'custom' when the person set the number themselves; a source is never attached to it. */
  protein: 'efsa-pri' | 'issn-range' | 'custom';
  /** 'custom' when the person set the energy or resting figure themselves. */
  energy: 'mifflin' | 'katch-mcardle' | 'custom';
  /**
   * Only 'formula' is produced in this plan. 'reported' and 'observed' are reserved for a later plan's daily health data
   * and weight page; their presence here is NOT a finished feature, so nothing may claim one of them yet.
   */
  expenditure: 'formula' | 'reported' | 'observed';
};

/** The targets a person can replace with a figure of their own: the plain numbers, never the basis, the cap or the micronutrient map. */
export type OverridableTargetKey =
  | 'energyKcal' | 'rmrKcal' | 'proteinG' | 'proteinFloorG' | 'fibreG' | 'sodiumMg' | 'satFatG' | 'addedSugarsG' | 'addedSugarsIdealG' | 'transFatG';

export type Targets = {
  energyKcal: number;
  rmrKcal: number;
  proteinG: number;
  proteinFloorG: number;
  fibreG: number;
  sodiumMg: number;
  satFatG: number;
  addedSugarsG: number;
  addedSugarsIdealG: number;
  transFatG: number;
  /** Adult reference intakes (not limits) for the micronutrients the dataset carries. See the design document's verification log. */
  micronutrients: Partial<Record<NutrientKey, number>>;
  /** True when the targets come from the generic fallback basis, not the person's profile. */
  isGeneric: boolean;
  /** Present when the goal's requested weekly rate was reduced, and says which limit applied: the app's maximum rate, the resting-energy floor, or both. Absent when nothing was reduced. */
  goalCapped?: GoalCap;
  basis: TargetBasis;
};

export type Profile = {
  heightCm?: number;
  /** ISO date, YYYY-MM-DD. */
  dob?: string;
  sex?: Sex;
  activityLevel?: ActivityLevel;
  /** Body fat as a percentage of body weight. Absent means unknown, never zero. */
  bodyFatPct?: number;
  /** Absent means no goal stated; it must never be read as `{ kind: 'hold' }`. */
  goal?: Goal;
  weightLog: { date: string; kg: number }[];
  flaggedAllergens: string[];
  conditions: string[];
  overrides?: Partial<Record<OverridableTargetKey, number>>;
};
