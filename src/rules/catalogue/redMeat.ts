import type { Citation, Evidence, Rule } from '../types';
import { pendingGramsOf, weekCount, whole } from './shared';

/**
 * Verified: WCRF's recommendation page reads "We recommend limiting the amount of red meat we eat to 3 portions a week
 * (350-500g or 12-18oz cooked weight)". The plan's "> ~500 g" is the TOP of that range, so the card appears above 500 g
 * and says it is the top of WCRF's range. Two limits are stated on the card: WCRF's figure is COOKED weight and the diary
 * records weight as logged, which may be raw, so the comparison is approximate.
 *
 * Strength 'limited', not the plan's 'moderate': IARC (press release N. 240, Volume 114) classified red meat Group 2A
 * "based on limited evidence that the consumption of red meat causes cancer in humans and strong mechanistic evidence";
 * the association is mainly colorectal. IARC's own word for the human evidence is "limited", and the card follows it. The
 * IARC statements are sourced by a supporting citation (IARC), and WCRF's citation supports the weekly amount that fires
 * the card; a tone test requires a citation from every organisation the prose names.
 * The WCRF page is undated, so `year` is the year it was accessed, not a publication year. Its real title is used: the
 * tone tests no longer filter a quoted source's words through rules written for the app's own voice.
 * Counts the pending entry's red-meat items too, per item, so a mixed dish contributes only its red meat. Silent unless the
 * pending entry has red meat, so it does not repeat on every entry of the week.
 * Reads flags and the week's grams, not nutrients, so it declares none and the coverage gate does not protect it.
 */
const THRESHOLDS = {
  /** Top of WCRF's 350-500 g cooked-weight range, grams per seven days. */
  weeklyGramsTopOfRange: 500,
};

const citation: Citation = {
  title: 'Limit red meat and avoid processed meat',
  publisher: 'World Cancer Research Fund (WCRF)',
  /** Access year: the page carries no publication date. */
  year: 2026,
  url: 'https://www.wcrf.org/preventing-cancer/our-cancer-prevention-recommendations/limit-red-meat-and-avoid-processed-meat/',
  conclusion: 'We recommend limiting the amount of red meat we eat to 3 portions a week (350–500g or 12–18oz cooked weight).',
};

/** The classification the card names is IARC's claim, so IARC is cited for it; WCRF's citation supports the weekly amount. */
const iarcCitation: Citation = {
  title: 'IARC Monographs evaluate consumption of red meat and processed meat (Press release N. 240, Volume 114)',
  publisher: 'International Agency for Research on Cancer (IARC), WHO',
  year: 2015,
  url: 'https://www.iarc.who.int/wp-content/uploads/2018/07/pr240_E.pdf',
  conclusion:
    'A Working Group of 22 experts from 10 countries classified the consumption of red meat as probably carcinogenic ' +
    'to humans (Group 2A), based on limited evidence that the consumption of red meat causes cancer in humans and ' +
    'strong mechanistic evidence supporting a carcinogenic effect.',
};

const evidence: Evidence = {
  strength: 'limited',
  body: 'WCRF',
  summary:
    'IARC classified red meat as probably carcinogenic to humans (Group 2A), based on limited evidence in humans and ' +
    'strong mechanistic evidence. The studies found an association mainly with colorectal cancer. WCRF recommends limiting red ' +
    'meat to three portions a week.',
  citation,
  supportingCitations: [iarcCitation],
  isAssociational: true,
};

export const redMeatWeeklyRule: Rule = {
  id: 'red-meat-weekly',
  title: 'Red meat this week',
  category: 'nutrition',
  // Reads the week's grams, not one entry, so it takes the aggregate scope and its usual-intake tone test.
  scope: 'daily',
  requiresNutrients: [],
  horizon: 'habitual',
  evidence,
  concern:
    'WCRF recommends limiting red meat to three portions a week, which it gives as 350 to 500 g cooked weight. ' +
    `This card appears when the week's logged red meat, including this entry, is above ${THRESHOLDS.weeklyGramsTopOfRange} g, ` +
    'the top of that range. ' +
    "WCRF's figure is for cooked weight, and the diary records the weight as logged, which may be raw, so the comparison " +
    'is approximate. ' +
    'IARC classifies red meat as probably carcinogenic to humans (Group 2A), based on limited evidence from ' +
    'observational studies, mainly for colorectal cancer. ' +
    'The studies concern usual intake over time, not a single serving, and IARC gives no figure for one serving.',
  cause: 'Red meat means all mammalian muscle meat, such as beef, pork, lamb and veal.',
  level: (ctx) => {
    const own = pendingGramsOf(ctx, 'redMeat');
    const before = weekCount(ctx.week.redMeatGrams);
    if (own <= 0 || before === null) return null;
    return before + own > THRESHOLDS.weeklyGramsTopOfRange ? 'MODERATE' : null;
  },
  portionNote: (ctx) => {
    const own = pendingGramsOf(ctx, 'redMeat');
    const before = weekCount(ctx.week.redMeatGrams);
    if (own <= 0 || before === null) return 'The weight of red meat this week is not known.';
    return (
      `With this entry, about ${whole(before + own)} g of red meat is logged in the last seven days ` +
      `(${whole(own)} g of it in this entry), against ${THRESHOLDS.weeklyGramsTopOfRange} g, the top of WCRF's range.`
    );
  },
};
