import type { Citation, Evidence, Level, Rule } from '../types';
import { pending, projectedDay, usable, whole } from './shared';

/**
 * Verified against the WHO sugars guideline (see the spec's Verification log). WHO: free sugars below 10% of energy
 * (strong), a further reduction below 5% (conditional). No figure for a single serving exists, so the plan's "15 g in
 * one entry" is not used. Two caveats shown on the card: the guideline covers FREE sugars, which also include sugars
 * in juice and honey, while food data lists ADDED sugars, so the diary can understate against WHO's own measure.
 * Tiers: above the strong 10% figure is MODERATE; above the conditional 5% figure is INFO.
 */
const citation: Citation = {
  title: 'Guideline: Sugars intake for adults and children',
  publisher: 'World Health Organization',
  year: 2015,
  url: 'https://www.who.int/publications/i/item/9789241549028',
  conclusion:
    'Reduce daily intake of free sugars to less than 10% of total energy intake (strong recommendation). A further ' +
    'reduction to below 5% or roughly 25 grams (6 teaspoons) per day would provide additional health benefits ' +
    '(conditional recommendation).',
};

const evidence: Evidence = {
  strength: 'moderate',
  body: 'WHO',
  summary:
    'Higher usual free-sugars intake is associated with weight gain and with dental caries. WHO makes the 10% ' +
    'figure a strong recommendation and the 5% figure a conditional one.',
  citation,
  isAssociational: true,
};

const CAVEAT =
  ' WHO counts free sugars, which also include sugars in juice and honey, while this diary counts added sugars, so ' +
  'the total here may be lower than WHO\'s own measure.';

function tier(amount: number, strong: number, conditional: number): Level | null {
  if (amount > strong) return 'MODERATE';
  if (amount > conditional) return 'INFO';
  return null;
}

export const addedSugarEntryRule: Rule = {
  id: 'added-sugar-entry',
  title: 'Added sugar in this entry',
  category: 'nutrition',
  scope: 'entry',
  nutrientKey: 'addedSugarsG',
  requiresNutrients: ['addedSugarsG'],
  horizon: 'habitual',
  evidence,
  concern:
    "This entry alone has more added sugar than WHO's conditional figure of 5% of energy for a whole day, and the " +
    "card is stronger above WHO's strong figure of 10%. WHO sets no limit for a single serving, so this card marks " +
    'the circumstance and is not a threshold. Higher usual intake of sugars is associated with weight gain and ' +
    'dental caries.' + CAVEAT,
  cause: 'Added sugars come from sweetened foods and drinks and from sugar added in cooking.',
  level: (ctx) => {
    const sugar = pending(ctx, 'addedSugarsG');
    const strong = ctx.targets.addedSugarsG;
    const conditional = ctx.targets.addedSugarsIdealG;
    if (sugar === null || !usable(strong) || !usable(conditional)) return null;
    return tier(sugar, strong, conditional);
  },
  portionNote: (ctx) => {
    const sugar = pending(ctx, 'addedSugarsG');
    const strong = ctx.targets.addedSugarsG;
    const conditional = ctx.targets.addedSugarsIdealG;
    if (sugar === null || !usable(strong) || !usable(conditional)) return 'The added sugar in this entry is not known.';
    return `This entry has about ${whole(sugar)} g of added sugar. For a whole day, 10% of your energy target is about ${whole(strong)} g and 5% is about ${whole(conditional)} g.`;
  },
};

export const addedSugarDailyRule: Rule = {
  id: 'added-sugar-daily',
  title: 'Added sugar today',
  category: 'nutrition',
  scope: 'daily',
  nutrientKey: 'addedSugarsG',
  requiresNutrients: ['addedSugarsG'],
  horizon: 'habitual',
  evidence,
  concern:
    "With this entry, today's logged added sugar is above WHO's conditional figure of 5% of energy. The card is " +
    "stronger above WHO's strong figure of 10%. The figures describe usual intake over time, and higher usual " +
    'intake is associated with weight gain and dental caries.' + CAVEAT,
  cause: 'Added sugars come from sweetened foods and drinks and from sugar added in cooking.',
  level: (ctx) => {
    const total = projectedDay(ctx, 'addedSugarsG');
    const strong = ctx.targets.addedSugarsG;
    const conditional = ctx.targets.addedSugarsIdealG;
    if (total === null || !usable(strong) || !usable(conditional)) return null;
    return tier(total, strong, conditional);
  },
  portionNote: (ctx) => {
    const total = projectedDay(ctx, 'addedSugarsG');
    const own = pending(ctx, 'addedSugarsG');
    const strong = ctx.targets.addedSugarsG;
    const conditional = ctx.targets.addedSugarsIdealG;
    if (total === null || own === null || !usable(strong) || !usable(conditional)) return "Today's added sugar total is not known.";
    return `Today comes to about ${whole(total)} g of added sugar with this entry (${whole(own)} g of it in this entry). 10% of your energy target is about ${whole(strong)} g and 5% is about ${whole(conditional)} g.`;
  },
};
