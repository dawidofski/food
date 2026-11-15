import type { ClassificationFlags, Coverage, NutrientSet } from './nutrients';
import type { ParsedItem } from '@/domain/parseEntry';

/** Which provider a food came from. Custom foods and batches arrive in later tasks. */
export type FoodSource = 'dataset' | 'custom' | 'batch';

export type FoodRef = { source: FoodSource; foodId: string; grams: number; portionLabel?: string };

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
