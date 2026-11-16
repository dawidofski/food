import type { Citation, Evidence, Rule } from '../types';
import { occasionsNote, occasionsWithThisEntry, pendingGramsOf, whole } from './shared';

/**
 * Verified against the WHO 2015 sugars guideline (executive summary and evidence table, read from a PDF copy; the WHO
 * IRIS file returned 403). Two plan assumptions changed:
 *  - 'moderate' becomes 'limited'. WHO rates the evidence for sugar-sweetened beverages specifically (children's cohort
 *    studies, highest versus lowest intake, odds ratio 1.55 for overweight or obesity) as LOW quality. WHO rates the
 *    adult evidence on free sugars and body weight overall as moderate, and the adult trials that raised sugars intake
 *    were mostly sweetened drinks. The card names both and the declared strength follows the weaker, drink-specific one.
 *  - WHO gives no limit for a sweetened drink or a single serving. Its figure is free sugars below 10% of energy. The
 *    rule is INFO and qualitative: it fires on the classification and says so.
 * Reads a classification flag, not a nutrient, so it declares none and the coverage gate does not protect it.
 * No alternatives: the guideline names no replacement drink.
 */
const citation: Citation = {
  title: 'Guideline: Sugars intake for adults and children',
  publisher: 'World Health Organization',
  year: 2015,
  url: 'https://www.who.int/publications/i/item/9789241549028',
  conclusion:
    'Meta-analysis of prospective cohort studies, with follow-up times of 1 year or more, found that children with the ' +
    'highest intakes of sugar-sweetened beverages had a greater likelihood of being overweight or obese than children ' +
    'with the lowest intakes.',
};

const evidence: Evidence = {
  strength: 'limited',
  body: 'WHO',
  summary:
    'In cohort studies in children, higher sugar-sweetened beverage intake was associated with being overweight or ' +
    'obese, and WHO rated that evidence as low quality. In adult trials that raised sugars intake, mostly as sweetened ' +
    'drinks, body weight rose, and WHO rated the adult evidence on free sugars and body weight as moderate overall. ' +
    'Strength is declared at the lower, drink-specific rating.',
  citation,
  isAssociational: true,
};

export const sweetDrinkRule: Rule = {
  id: 'sweet-drink',
  title: 'Sugar-sweetened drink',
  category: 'nutrition',
  scope: 'entry',
  requiresNutrients: [],
  horizon: 'habitual',
  evidence,
  concern:
    'Sugar-sweetened drinks are a source of free sugars, and WHO recommends keeping free sugars below 10% of total ' +
    'energy intake. ' +
    "In WHO's review, children with the highest usual intake of sugar-sweetened beverages were more likely to be " +
    'overweight or obese than children with the lowest, and WHO rated that evidence as low quality. ' +
    'In adult trials that increased sugars intake, mostly as sweetened drinks, body weight rose over time, and WHO ' +
    'rated the adult evidence on free sugars and body weight as moderate overall. ' +
    'The child finding is an association seen in observational studies. ' +
    'WHO gives no limit for one serving of a sweetened drink.',
  cause: 'A sugar-sweetened drink adds free sugars and energy without much else.',
  level: (ctx) => (ctx.pending.classification.sweetDrink ? 'INFO' : null),
  portionNote: (ctx) => {
    const g = pendingGramsOf(ctx, 'sweetDrink');
    if (g <= 0) return 'The amount of sweetened drink in this entry is not known.';
    return `This entry has about ${whole(g)} g of sugar-sweetened drink. Its added sugar is counted on the added-sugar cards.`;
  },
  // How often, as the diary's own count. WHO's figure is a share of energy; it gives no number of drinks a week.
  patternNote: (ctx) => {
    const o = occasionsWithThisEntry(ctx, ctx.week.sweetDrinkOccasions);
    if (o === null) return null;
    return (
      `${occasionsNote(o, 'sugar-sweetened drinks appear')} ` +
      'The diary counts entries, not drinks: an entry with two glasses counts once.'
    );
  },
};
