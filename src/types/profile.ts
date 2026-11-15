export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'veryActive';

export type Sex = 'male' | 'female' | 'unspecified';

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
  /** True when the targets come from the generic fallback basis, not the person's profile. */
  isGeneric: boolean;
};

export type Profile = {
  heightCm: number;
  /** ISO date, YYYY-MM-DD. */
  dob: string;
  sex: Sex;
  activityLevel: ActivityLevel;
  weightLog: { date: string; kg: number }[];
  flaggedAllergens: string[];
  conditions: string[];
  overrides?: Partial<Targets>;
};
