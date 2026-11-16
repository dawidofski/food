import type { Citation, Evidence, Rule } from '../types';
import { pending, usable, whole } from './shared';

/**
 * Verified against the WHO 2023 guideline: reduce trans-fatty acids to 1% of energy (strong recommendation, moderate
 * certainty). Two plan assumptions did not survive the source:
 *  - the 1% limit covers ALL trans fat, ruminant (dairy, meat) as well as industrial, and the food data does not
 *    separate them, so "any industrial trans fat" cannot be detected and "any amount" would fire on milk;
 *  - WHO's remark is that foods with HIGH levels of industrial trans fat should largely be avoided, not any amount.
 * The rule therefore fires only when one entry alone exceeds the whole-day 1% figure, and says so. MODERATE, not
 * HIGH: WHO publishes no grade for one entry, the evidence is observational, and size of one entry is not frequency.
 * There is no daily trans-fat rule, so a day's excess spread over several entries stays silent.
 */
const citation: Citation = {
  title: 'Saturated fatty acid and trans-fatty acid intake for adults and children: WHO guideline',
  publisher: 'World Health Organization',
  year: 2023,
  url: 'https://www.who.int/publications/i/item/9789240073630',
  conclusion:
    'WHO recommends that adults and children reduce trans-fatty acid intake to 1% of total energy intake ' +
    '(strong recommendation).',
};

const evidence: Evidence = {
  strength: 'moderate',
  body: 'WHO',
  summary:
    'WHO makes this a strong recommendation and rates the certainty of the evidence behind it as moderate. WHO ' +
    'counts industrial and ruminant trans fat together. The app states no health outcome for trans fat, because the ' +
    'outcome and dose-response wording could not be confirmed at source.',
  citation,
  isAssociational: false, // the app now states no outcome, so there is no association to phrase
};

export const transFatRule: Rule = {
  id: 'trans-fat',
  title: 'Trans fat in this entry',
  category: 'nutrition',
  scope: 'entry',
  nutrientKey: 'transFatG',
  requiresNutrients: ['transFatG'],
  horizon: 'habitual',
  evidence,
  concern:
    "This entry alone has more trans fat than 1% of your energy target, WHO's figure for a whole day. WHO sets no " +
    'limit for a single serving, so this card marks the circumstance and is not a threshold. Food data does not ' +
    'say whether trans fat is industrial or from dairy and meat, and WHO\'s figure covers both.',
  cause: 'Trans fat comes from partially hydrogenated oils in some processed foods, and in small amounts from dairy and meat.',
  alternatives: [
    {
      label: 'Polyunsaturated or plant monounsaturated fat in place of trans fat',
      reason: 'WHO recommends replacing trans fat with these fats, as a conditional recommendation.',
      citation: {
        title: citation.title, publisher: citation.publisher, year: citation.year, url: citation.url,
        conclusion:
          'WHO recommends replacing trans-fatty acids in the diet with polyunsaturated fatty acids or monounsaturated ' +
          'fatty acids primarily from plant sources (conditional recommendation).',
      },
    },
  ],
  level: (ctx) => {
    const trans = pending(ctx, 'transFatG');
    const limit = ctx.targets.transFatG;
    if (trans === null || !usable(limit)) return null;
    return trans > limit ? 'MODERATE' : null;
  },
  portionNote: (ctx) => {
    const trans = pending(ctx, 'transFatG');
    const limit = ctx.targets.transFatG;
    if (trans === null || !usable(limit)) return 'The trans fat in this entry is not known.';
    return `This entry has about ${whole(trans)} g of trans fat. 1% of your energy target is about ${whole(limit)} g for a whole day.`;
  },
};
