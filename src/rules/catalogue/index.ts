import type { Rule } from '../types';
import { sodiumEntryRule, sodiumDailyRule } from './sodium';
import { addedSugarEntryRule, addedSugarDailyRule } from './addedSugar';
import { saturatedFatDailyRule } from './saturatedFat';
import { transFatRule } from './transFat';

export { sodiumEntryRule, sodiumDailyRule, addedSugarEntryRule, addedSugarDailyRule, saturatedFatDailyRule, transFatRule };

/** Declaration order is the tiebreak order for cards of equal level. */
export const catalogue: Rule[] = [
  transFatRule,
  sodiumDailyRule,
  sodiumEntryRule,
  addedSugarDailyRule,
  addedSugarEntryRule,
  saturatedFatDailyRule,
];
