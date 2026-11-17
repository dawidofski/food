import type { NutrientKey } from '@/types/nutrients';

/**
 * Which way each figure points: a floor is something to reach, a ceiling is something to stay under, and
 * 'none' is a figure that is neither.
 *
 * This exists because the app labelled every nutrient `target N unit`, sodium included, and so told its only
 * user for months to reach 2,000 mg of salt a day. WHO's 2 g is a limit. A single label for every figure
 * cannot be right, so the direction is stated once, here, and the screens read it instead of assuming.
 *
 * Energy is 'none': the energy figure is an estimate of expenditure, not a mark to hit or stay under.
 * Fat, carbohydrate and total sugars are 'none' because the app holds no reference for them that points
 * either way; the limits that matter are saturated fat, trans fat and added sugars.
 *
 * Exhaustiveness is the compiler's job, not a default's: the map is a Record over the closed NutrientKey
 * union, so adding a nutrient without deciding its direction fails to compile. directionOf has no fallback
 * on purpose, because a fallback is exactly the silent guess that produced the sodium label.
 * The protein floor and the ideal added-sugars figure are fields of Targets, not nutrients, and are not here.
 */
export type TargetDirection = 'floor' | 'ceiling' | 'none';

export type DirectedNutrient = NutrientKey;

export const TARGET_DIRECTION: Record<DirectedNutrient, TargetDirection> = {
  energyKcal: 'none',
  proteinG: 'floor',
  fatG: 'none',
  satFatG: 'ceiling',
  transFatG: 'ceiling',
  carbG: 'none',
  sugarsG: 'none',
  addedSugarsG: 'ceiling',
  fibreG: 'floor',
  sodiumMg: 'ceiling',
  potassiumMg: 'floor',
  calciumMg: 'floor',
  ironMg: 'floor',
  magnesiumMg: 'floor',
  zincMg: 'floor',
  vitaminCMg: 'floor',
  vitaminDUg: 'floor',
  vitaminB12Ug: 'floor',
  folateUg: 'floor',
};

export function directionOf(key: DirectedNutrient): TargetDirection {
  return TARGET_DIRECTION[key];
}
