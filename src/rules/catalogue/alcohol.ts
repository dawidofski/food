import type { Citation, Evidence, Rule } from '../types';
import { weekCount } from './shared';

/**
 * Verified against WHO/Europe's 4 January 2023 statement: alcohol is an IARC Group 1 carcinogen, "there is no safe
 * amount that does not affect health", it "causes at least seven types of cancer", "the risk of developing cancer
 * increases substantially as alcohol consumption increases", and current evidence "cannot indicate the existence of a
 * threshold". The IARC monograph text itself was not read; the Group 1 classification is cited to IARC's own press
 * release N. 371 (8 October 2025, read from the PDF) as a supporting citation.
 *
 * The plan's "escalates with the weekly total" is dropped. There is no established threshold to escalate at, and the only
 * count available is entries that contain alcohol, not drinks and not units (the dataset has no alcohol-gram nutrient),
 * so any escalation point would be invented. The rule fires MODERATE on any alcohol entry, qualitatively, and says no
 * threshold exists. The portion note shows the entry count and says it is not a drink count. Not HIGH: nothing here is
 * about frequency in a way the data can measure.
 * Declared 'strong' as the certainty that alcohol is linked to cancer (IARC sufficient evidence); it covers the link, not
 * the size of risk from any amount.
 * Reads a classification flag, not a nutrient, so it declares none and the coverage gate does not protect it.
 */
const citation: Citation = {
  title: 'No level of alcohol consumption is safe for our health',
  publisher: 'World Health Organization, Regional Office for Europe',
  year: 2023,
  url: 'https://www.who.int/europe/news/item/04-01-2023-no-level-of-alcohol-consumption-is-safe-for-our-health',
  conclusion:
    'The risk of developing cancer increases substantially as alcohol consumption increases. ' +
    'Alcohol causes at least seven types of cancer, including the most common cancer types.',
};

/** The Group 1 classification is IARC's claim, so IARC is cited for it. Read from IARC's own press release. */
const iarcCitation: Citation = {
  title: 'Alcohol: a major preventable cause of cancer (IARC Evidence Summary Brief No. 6), press release N. 371',
  publisher: 'International Agency for Research on Cancer (IARC), WHO',
  year: 2025,
  url: 'https://www.iarc.who.int/wp-content/uploads/2025/10/pr371_E.pdf',
  conclusion:
    'In 1988, the IARC Monographs programme classified alcoholic beverages as carcinogenic to humans (Group 1). ' +
    'Even low levels of drinking increase cancer risk.',
};

const evidence: Evidence = {
  strength: 'strong',
  body: 'WHO',
  summary:
    'WHO states that alcohol causes at least seven types of cancer; the link concerns regular drinking over time, and ' +
    'the risk rises as consumption rises. WHO also states that current evidence cannot indicate a threshold.',
  citation,
  supportingCitations: [iarcCitation],
  isAssociational: false,
};

export const alcoholRule: Rule = {
  id: 'alcohol',
  title: 'Alcohol',
  category: 'nutrition',
  scope: 'entry',
  requiresNutrients: [],
  horizon: 'habitual',
  evidence,
  concern:
    'WHO states that there is no safe amount of alcohol that does not affect health, and that alcohol is classified ' +
    'by IARC as a Group 1 carcinogen. ' +
    'The classification describes how strong the evidence is, not how large the risk is. ' +
    "Cancer risk rises with usual alcohol consumption, and WHO says current evidence cannot indicate a threshold at " +
    "which alcohol's carcinogenic effects begin, so this card marks any alcohol and does not mark a limit. " +
    'These statements are about drinking over time, not about a single serving, and WHO gives no amount for one entry. ' +
    'The diary counts entries that contain alcohol and cannot tell how much was drunk.',
  cause: 'This entry includes a food or drink flagged as containing alcohol.',
  level: (ctx) => (ctx.pending.classification.alcohol ? 'MODERATE' : null),
  portionNote: (ctx) => {
    const before = weekCount(ctx.week.alcoholOccasions);
    if (before === null) return 'How often alcohol was logged this week is not known.';
    return (
      `With this entry, alcohol appears in ${before + 1} diary entries in the last seven days. ` +
      'These are entries, not drinks: the diary cannot tell how much was drunk.'
    );
  },
};
