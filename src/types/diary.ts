import type { ClassificationFlags, Coverage, NutrientSet } from './nutrients';
import type { ParsedItem } from '@/domain/parseEntry';

/** Which provider a food came from. Custom foods and batches arrive in later tasks. */
export type FoodSource = 'dataset' | 'custom' | 'batch';

export type FoodRef = {
  source: FoodSource;
  foodId: string;
  grams: number;
  portionLabel?: string;
  /** Snapshotted at commit: this item's own flags, so a mixed dish is not judged by its worst item. */
  classification: ClassificationFlags;
  /** Snapshotted at commit: this item's own FPED cup-equivalents, already scaled by its grams. Absent = unknown. */
  fped?: { vegCupEq: number; fruitCupEq: number; wholeGrainOzEq: number };
};

export type Resolution = {
  refs: FoodRef[];
  /** Absent key = unknown, never zero. Read `coverage` to tell "unknown" from "partly known". */
  nutrients: NutrientSet;
  coverage: Coverage;
  classification: ClassificationFlags;
  /** Items that could not be resolved safely: unmatched food, no matching portion, or a bad quantity. */
  needsHelp: ParsedItem[];
  /**
   * 1 - mean(search score of accepted hits); 0 when nothing resolved. Because the search layer
   * gates on token completeness, every accepted hit scores ~0.03, so this sits near 1.0 for ANY
   * resolved entry. It is NOT a quality signal. Callers deciding whether to invoke an AI fallback
   * must trigger on `needsHelp.length > 0`, never on a low confidence.
   */
  confidence: number;
};

export type Level = 'INFO' | 'MODERATE' | 'HIGH' | 'CRITICAL';

export type DiaryEntry = {
  id: string;
  /** ISO datetime of when the food was eaten. */
  at: string;
  /** Exactly what the user typed, kept verbatim so a mis-parse stays traceable. */
  rawText: string;
  resolution: 'local' | 'ai' | 'manual' | 'batch';
  items: FoodRef[];
  /** Snapshotted at commit time. Never recomputed from food ids, so a dataset rebuild cannot rewrite history. */
  nutrients: NutrientSet;
  coverage: Coverage;
  /** Snapshotted at commit: the merged worst-case flags across the entry's items (mergeClassification). */
  classification: ClassificationFlags;
  /**
   * Snapshotted at commit: FPED cup-equivalents summed across items, scaled by gram weight. Absent
   * when no item had FPED data, which means unknown, never zero.
   */
  fped?: { vegCupEq: number; fruitCupEq: number; wholeGrainOzEq: number };
  warningsShown: { ruleId: string; level: Level }[];
  /** 'cancelled' entries are kept for the learning history but were never eaten: never counted in totals. */
  userAction: 'added' | 'addedAfterAlternatives' | 'cancelled';
  /** 'deleted' is a tombstone; 'superseded' means a revision replaced it. Neither is ever hard-removed. */
  state: 'active' | 'deleted' | 'superseded';
  supersededBy?: string;
  revisionOf?: string;
};

export type CustomFood = {
  id: string;
  name: string;
  /** An absent key means unknown, never zero. */
  nutrientsPer100g: NutrientSet;
  classification: ClassificationFlags;
  allergens: string[];
  referencePortion: { label: string; grams: number };
  synonyms: string[];
};

export type Batch = {
  id: string;
  name: string;
  ingredients: { text: string; refs: FoodRef[] }[];
  portionCount: number;
  /** Labelling only. Never used to rescale nutrients. */
  totalCookedGrams?: number;
  nutrientsPerPortion: NutrientSet;
  coverage: Coverage;
  classification: ClassificationFlags;
  portionsRemaining: number;
  /** ISO datetime. */
  cookedAt: string;
};
