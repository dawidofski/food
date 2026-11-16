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

/**
 * One product read from Open Food Facts and cached locally, as `src/domain/openFoodFacts.ts` maps it and
 * `src/data/db.ts` stores it (keyed by `barcode`).
 *
 * Crowdsourced data: anyone may edit any product and no laboratory stands behind a figure. An absent nutrient key
 * means unknown and never zero, and an empty `allergens` list is NEVER "allergen-free".
 */
export type OffProduct = {
  /** The barcode, which is also this product's id everywhere in the app. */
  barcode: string;
  name: string;
  brand?: string;
  /** Per 100 g, or per 100 ml — see `perMlNotPerGram`. An absent key is unknown, never zero. */
  per100g: NutrientSet;
  classification: ClassificationFlags;
  /** Allergen tags with their language prefix stripped, traces folded in. An empty list is not an all-clear. */
  allergens: string[];
  /** The `traces_tags` subset, so a screen can say "may contain". Also present in `allergens`. */
  traces: string[];
  /** Grams in one serving, when Open Food Facts says. */
  servingGrams?: number;
  /** The pack size as Open Food Facts prints it ("1 L"). Labelling only; never a nutrient basis. */
  packSize?: string;
  /** ISO datetime of the last edit anyone made to the product. */
  lastModified?: string;
  /** ISO datetime this record was fetched, so a cached figure is never mistaken for a fresh one. */
  fetchedAt: string;
  /** True when the figures are really per 100 ml (a drink) and this app is counting 1 ml as 1 g. */
  perMlNotPerGram: boolean;
  /** False when no NOVA group was given: `classification.novaGroup` is then 1 meaning "not flagged". */
  novaKnown: boolean;
  /** Plain sentences naming what Open Food Facts did not tell us. */
  gaps: string[];
};
