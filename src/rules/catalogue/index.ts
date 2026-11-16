import type { Rule } from '../types';
import { sodiumEntryRule, sodiumDailyRule } from './sodium';
import { addedSugarEntryRule, addedSugarDailyRule } from './addedSugar';
import { saturatedFatDailyRule } from './saturatedFat';
import { transFatRule } from './transFat';
import { processedMeatRule, processedMeatFrequencyRule } from './processedMeat';
import { redMeatWeeklyRule } from './redMeat';
import { alcoholRule } from './alcohol';
import { sweetDrinkRule } from './sweetDrink';
import { ultraProcessedRule } from './ultraProcessed';
import { nutrientDensityRule } from './nutrientDensity';
import { allergenRule } from './allergen';
import { foodSafetyRules } from './foodSafety';

export {
  sodiumEntryRule, sodiumDailyRule, addedSugarEntryRule, addedSugarDailyRule, saturatedFatDailyRule, transFatRule,
  processedMeatRule, processedMeatFrequencyRule, redMeatWeeklyRule, alcoholRule, sweetDrinkRule, ultraProcessedRule,
  nutrientDensityRule, allergenRule, foodSafetyRules,
};

/** Declaration order is the tiebreak order for cards of equal level. */
/** Safety rules lead: CRITICAL sorts first anyway, and declaration order breaks ties. */
export const catalogue: Rule[] = [
  allergenRule,
  ...foodSafetyRules,
  processedMeatRule,
  alcoholRule,
  transFatRule,
  sodiumDailyRule,
  sodiumEntryRule,
  addedSugarDailyRule,
  addedSugarEntryRule,
  saturatedFatDailyRule,
  redMeatWeeklyRule,
  sweetDrinkRule,
  processedMeatFrequencyRule,
  ultraProcessedRule,
  nutrientDensityRule,
];
