import type { Citation, Evidence, Rule } from '../types';
import { pending, projectedDay, usable, whole } from './shared';

/**
 * Verified against the WHO 2023 saturated and trans-fatty acid guideline: reduce saturated fat to 10% of energy
 * (strong recommendation, moderate-certainty evidence). Going BELOW 10% is a
 * separate conditional recommendation on very-low-certainty evidence, so it carries no tier here.
 */
const citation: Citation = {
  title: 'Saturated fatty acid and trans-fatty acid intake for adults and children: WHO guideline',
  publisher: 'World Health Organization',
  year: 2023,
  url: 'https://www.who.int/publications/i/item/9789240073630',
  conclusion:
    'WHO recommends that adults and children reduce saturated fatty acid intake to 10% of total energy intake ' +
    '(strong recommendation).',
};

const evidence: Evidence = {
  strength: 'moderate',
  body: 'WHO',
  summary:
    'WHO makes this a strong recommendation and rates the certainty of the evidence behind it as moderate. The ' +
    'recommendation concerns usual intake as a share of energy.',
  citation,
  isAssociational: false,
};

export const saturatedFatDailyRule: Rule = {
  id: 'saturated-fat-daily',
  title: 'Saturated fat today',
  category: 'nutrition',
  scope: 'daily',
  nutrientKey: 'satFatG',
  requiresNutrients: ['satFatG'],
  horizon: 'habitual',
  evidence,
  concern:
    "With this entry, today's logged saturated fat is above 10% of your energy target, the share WHO recommends. " +
    'The figure describes usual intake over time, so one day above it is not by itself a problem.',
  cause: 'Saturated fat is found in fatty meat, butter, cheese, cream, and palm and coconut oil.',
  alternatives: [
    {
      label: 'Polyunsaturated fat in place of saturated fat',
      reason: 'WHO strongly recommends replacing saturated fat with polyunsaturated fat.',
      citation: {
        title: citation.title, publisher: citation.publisher, year: citation.year, url: citation.url,
        conclusion:
          'WHO recommends replacing saturated fatty acids in the diet with polyunsaturated fatty acids (strong ' +
          'recommendation).',
      },
    },
  ],
  level: (ctx) => {
    const total = projectedDay(ctx, 'satFatG');
    const limit = ctx.targets.satFatG;
    if (total === null || !usable(limit)) return null;
    return total > limit ? 'MODERATE' : null;
  },
  portionNote: (ctx) => {
    const total = projectedDay(ctx, 'satFatG');
    const own = pending(ctx, 'satFatG');
    const limit = ctx.targets.satFatG;
    if (total === null || own === null || !usable(limit)) return "Today's saturated fat total is not known.";
    return `Today comes to about ${whole(total)} g of saturated fat with this entry (${whole(own)} g of it in this entry), against about ${whole(limit)} g, which is 10% of your energy target.`;
  },
};
