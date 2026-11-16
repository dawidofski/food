import type { Citation, Evidence, Rule } from '../types';

/**
 * THE DESIGN'S NAMED TEST OF ANTI-GOAL A3 (spec 9.3). Decision: QUALITATIVE, INFO only, declared 'limited' and
 * associational. The plan's trigger, "NOVA 4 at a high share of the day's energy", is dropped for three reasons:
 *  1. No source defines a high share. Studies compare groups of people (highest versus lowest intake) and report
 *     associations; none gives a level at which anything changes for an individual.
 *  2. It cannot be computed. The context carries a NOVA group per item but no per-item energy, so the share of the day's
 *     energy from NOVA 4 is unavailable. Inventing an approximation would state a number the data cannot support.
 *  3. A trigger on grams or entries would flatten (anti-goal A4): NOVA 4 holds packaged wholemeal bread beside soft drinks.
 * The card therefore fires on the classification, says the category is broad, says the evidence is almost entirely
 * observational with likely residual confounding, says it is unclear whether processing or nutrient content explains
 * the link, and says no threshold is established. Verified against SACN's April 2025 rapid evidence update (read at
 * source) and WHO's May 2025 call for experts, which says WHO is still developing guidance.
 * INFO is the ceiling anyway: the engine caps 'limited' evidence at MODERATE, and this rule does not ask for that.
 * Reads a classification flag, not a nutrient, so it declares none and the coverage gate does not protect it. A mixed
 * entry fires when ANY food in it is NOVA 4 (the merged worst case), and the card says "at least one food".
 */
const citation: Citation = {
  title: "Processed foods and health: SACN's rapid evidence update summary",
  publisher: 'Scientific Advisory Committee on Nutrition (SACN), UK',
  year: 2025,
  url: 'https://www.gov.uk/government/publications/processed-foods-and-health-sacns-rapid-evidence-update/processed-foods-and-health-sacns-rapid-evidence-update-summary',
  conclusion:
    'SACN has found consistent associations between higher consumption of UPF and adverse health outcomes. ' +
    'The available evidence remains almost exclusively observational, with only one small RCT identified. ' +
    'Even after adjustments have been made, it is likely that some confounding will remain.',
};

const evidence: Evidence = {
  strength: 'limited',
  body: 'SACN',
  summary:
    'SACN found consistent associations between higher consumption of ultra-processed food and adverse health ' +
    'outcomes. The evidence is almost entirely observational, with one small trial, and some confounding is likely to ' +
    'remain, so it shows an association and not that processing is the reason.',
  citation,
  isAssociational: true,
};

export const ultraProcessedRule: Rule = {
  id: 'ultra-processed',
  title: 'Ultra-processed food',
  category: 'nutrition',
  scope: 'entry',
  requiresNutrients: [],
  horizon: 'habitual',
  evidence,
  concern:
    'This entry includes at least one food in NOVA group 4, the ultra-processed category. ' +
    'The category is broad: it covers foods of very different makeup, and the evidence does not separate them, so the ' +
    'group alone says little about this entry. ' +
    'Studies that observe people link higher usual consumption of ultra-processed food with adverse health outcomes, ' +
    'but the evidence is almost entirely observational and some confounding is likely to remain. ' +
    'It is unclear whether processing itself or the nutrient content of these foods explains the link. ' +
    'No threshold is established, and no figure for a single serving exists, so this card marks the classification ' +
    'and not an amount.',
  cause: 'NOVA group 4 describes industrial formulations of food substances, often with additives, as defined by the NOVA system.',
  level: (ctx) => (ctx.pending.classification.novaGroup === 4 ? 'INFO' : null),
  portionNote: () =>
    'The diary cannot tell what share of this entry, or of your day, is ultra-processed, so no share is stated.',
};
