export type NutrientKey =
  | 'energyKcal'
  | 'proteinG'
  | 'fatG'
  | 'satFatG'
  | 'transFatG'
  | 'carbG'
  | 'sugarsG'
  | 'addedSugarsG'
  | 'fibreG'
  | 'sodiumMg'
  | 'potassiumMg'
  | 'calciumMg'
  | 'ironMg'
  | 'magnesiumMg'
  | 'zincMg'
  | 'vitaminCMg'
  | 'vitaminDUg'
  | 'vitaminB12Ug'
  | 'folateUg';

export const NUTRIENT_KEYS: readonly NutrientKey[] = [
  'energyKcal',
  'proteinG',
  'fatG',
  'satFatG',
  'transFatG',
  'carbG',
  'sugarsG',
  'addedSugarsG',
  'fibreG',
  'sodiumMg',
  'potassiumMg',
  'calciumMg',
  'ironMg',
  'magnesiumMg',
  'zincMg',
  'vitaminCMg',
  'vitaminDUg',
  'vitaminB12Ug',
  'folateUg',
];

/** An absent key means "we do not know this value" — never zero. */
export type NutrientSet = Partial<Record<NutrientKey, number>>;

export type Coverage = Partial<Record<NutrientKey, 'known' | 'partial' | 'unknown'>>;

export type ClassificationFlags = {
  processedMeat: boolean;
  redMeat: boolean;
  sweetDrink: boolean;
  alcohol: boolean;
  novaGroup: 1 | 2 | 3 | 4;
  refinedGrain: boolean;
  vegetable: boolean;
  fruit: boolean;
  legume: boolean;
  oilyFish: boolean;
};
