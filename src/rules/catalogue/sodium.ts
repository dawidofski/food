import type { Citation, Evidence, Level, Rule } from '../types';
import { daysBeforeToday, daysBeforeTodayNote, pending, projectedDay, usable, whole } from './shared';

/**
 * Verified against the WHO sodium guideline (see the spec's Verification log). WHO states a recommendation for
 * average daily intake only. It publishes NO figure for a single serving, so the plan's "600 mg in one entry" is
 * not used: the entry rule compares one entry with WHO's whole-day figure and says so on the card.
 * Strength 'strong' is the certainty for the outcome the card names, blood pressure (high quality). WHO rates its
 * cardiovascular-outcome evidence lower, so the summary says that and the card claims nothing about those outcomes.
 * No magnitude tier: HIGH means concern "especially with frequent consumption" and no weekly sodium rule exists.
 */
const citation: Citation = {
  title: 'Guideline: Sodium intake for adults and children',
  publisher: 'World Health Organization',
  year: 2012,
  url: 'https://www.who.int/publications/i/item/9789241504836',
  conclusion: 'WHO recommends a reduction to <2 g/day sodium (5 g/day salt) in adults (strong recommendation).',
};

const evidence: Evidence = {
  strength: 'strong',
  body: 'WHO',
  summary:
    'In trials, lower sodium intake lowers blood pressure in adults, and WHO rates that evidence as high quality. ' +
    'WHO rates the evidence for cardiovascular outcomes, which concern usual intake over time, as lower quality. ' +
    'WHO states its figure for average daily intake. It states none for a single serving.',
  citation,
  isAssociational: false,
};

/**
 * The same count for both sodium cards, so whichever survives a merge carries it. It counts days, states WHO's own
 * whole-day figure, and names no frequency of its own: WHO publishes none.
 */
const sodiumPatternNote = (ctx: Parameters<Rule['level']>[0]): string | null => {
  const figure = ctx.targets.sodiumMg;
  if (!usable(figure)) return null;
  const d = daysBeforeToday(ctx, 'sodiumMg', figure);
  if (d === null) return null;
  return `${daysBeforeTodayNote(d, 'sodium', `${whole(figure)} mg`)} WHO's figure is about average intake over time.`;
};

export const sodiumEntryRule: Rule = {
  id: 'sodium-entry',
  title: 'Sodium in this entry',
  category: 'nutrition',
  scope: 'entry',
  nutrientKey: 'sodiumMg',
  requiresNutrients: ['sodiumMg'],
  horizon: 'habitual',
  evidence,
  concern:
    'This entry alone has more sodium than the whole-day figure WHO recommends for adults. WHO sets no limit for a ' +
    'single serving, so this card marks the circumstance and is not a threshold. ' +
    "WHO's strong rating is for blood pressure over time. WHO rates the evidence for mortality, cardiovascular disease, " +
    'stroke and coronary heart disease as lower quality, and that evidence concerns usual intake.',
  cause: 'Sodium comes mostly from salt and from salted or processed ingredients.',
  level: (ctx) => {
    const sodium = pending(ctx, 'sodiumMg');
    const figure = ctx.targets.sodiumMg;
    if (sodium === null || !usable(figure)) return null;
    return sodium > figure ? 'MODERATE' : null;
  },
  portionNote: (ctx) => {
    const sodium = pending(ctx, 'sodiumMg');
    const figure = ctx.targets.sodiumMg;
    if (sodium === null || !usable(figure)) return 'The sodium in this entry is not known.';
    return `This entry has about ${whole(sodium)} mg of sodium. WHO's figure for a whole day is ${whole(figure)} mg.`;
  },
  patternNote: sodiumPatternNote,
};

export const sodiumDailyRule: Rule = {
  id: 'sodium-daily',
  title: 'Sodium today',
  category: 'nutrition',
  scope: 'daily',
  nutrientKey: 'sodiumMg',
  requiresNutrients: ['sodiumMg'],
  horizon: 'habitual',
  evidence,
  concern:
    "With this entry, today's logged sodium is above the figure WHO recommends for average daily intake. The " +
    'figure describes usual intake over time, so one day above it is not by itself a problem. ' +
    "WHO's strong rating is for blood pressure over time. WHO rates the evidence for mortality, cardiovascular disease, " +
    'stroke and coronary heart disease as lower quality, and that evidence concerns usual intake.',
  cause: 'Sodium comes mostly from salt and from salted or processed ingredients.',
  level: (ctx): Level | null => {
    const total = projectedDay(ctx, 'sodiumMg');
    const figure = ctx.targets.sodiumMg;
    if (total === null || !usable(figure)) return null;
    return total > figure ? 'MODERATE' : null;
  },
  portionNote: (ctx) => {
    const total = projectedDay(ctx, 'sodiumMg');
    const own = pending(ctx, 'sodiumMg');
    const figure = ctx.targets.sodiumMg;
    if (total === null || own === null || !usable(figure)) return "Today's sodium total is not known.";
    return `Today comes to about ${whole(total)} mg of sodium with this entry (${whole(own)} mg of it in this entry), against WHO's ${whole(figure)} mg a day.`;
  },
  patternNote: sodiumPatternNote,
};
