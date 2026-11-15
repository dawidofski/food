import type { ClassificationFlags, NutrientSet } from './nutrients';

export interface DatasetFood {
  id: string;
  name: string;
  synonyms: string[];
  per100g: NutrientSet;
  portions: { label: string; grams: number }[];
  classification: ClassificationFlags;
  allergens: string[];
  fped?: { vegCupEq: number; fruitCupEq: number; wholeGrainOzEq: number };
}
