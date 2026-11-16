import type { Citation, Evidence, Rule } from '../types';
import { pendingGramsOf, weekCount, whole } from './shared';

/**
 * Verified against the IARC press release for Monograph Volume 114 (26 October 2015), read from the PDF: processed meat
 * is Group 1 "based on sufficient evidence in humans that the consumption of processed meat causes colorectal cancer",
 * and "each 50 gram portion of processed meat eaten daily increases the risk of colorectal cancer by 18%". The 18% is a
 * RELATIVE figure for a DAILY amount over years. IARC adds that for an individual the risk "remains small". The Group 1
 * label is about how sure the evidence is, not how large the risk is, and the card says so.
 *
 * Declared 'strong' as the certainty that processed meat is linked to colorectal cancer (IARC: sufficient evidence).
 * HIGH on any processed-meat entry is the one HIGH in the catalogue: the design reserves HIGH for the nature of a concern
 * and its frequency (spec 9.2), and a Group 1 carcinogen is that case. The card attributes nothing to one serving.
 *
 * The weekly frequency rule below is INFO only. No source gives a number of occasions per week; three is the app's own
 * point for showing a count, and the card says so. It stays silent unless the pending entry itself has processed meat.
 * One alternative, from WCRF's recommendation page (read at source): "Use alternatives to ham in your sandwiches. Try
 * chicken, hard-boiled eggs, tinned tuna (in spring water), low-fat houmous or low-fat cream cheese." It is offered as WCRF
 * words it, for sandwiches, and the reason claims no outcome. The same page says "Swap beef mince for turkey or
 * vegetarian mince"; that is a red-meat swap and is not used here. WCRF's cancer-prevention recommendations page names no
 * replacement foods, so nothing broader is claimed.
 * Both rules read classification flags, not nutrients, so they declare no required nutrients and the coverage gate does
 * not protect them. That is deliberate: there is no nutrient value to be unknown.
 */
const THRESHOLDS = {
  /** IARC's reference amount, grams of processed meat eaten daily. */
  referenceGramsPerDay: 50,
  /** The app's own point for showing the count: not a published figure. */
  frequencyOccasionsInSevenDays: 3,
};

const citation: Citation = {
  title: 'IARC Monographs evaluate consumption of red meat and processed meat (Press release N. 240, Volume 114)',
  publisher: 'International Agency for Research on Cancer (IARC), WHO',
  year: 2015,
  url: 'https://www.iarc.who.int/wp-content/uploads/2018/07/pr240_E.pdf',
  conclusion:
    'Processed meat was classified as carcinogenic to humans (Group 1), based on sufficient evidence in humans that the ' +
    'consumption of processed meat causes colorectal cancer. The experts concluded that each 50 gram portion of ' +
    'processed meat eaten daily increases the risk of colorectal cancer by 18%.',
};

const wcrfAlternative: Citation = {
  title: 'Limit red meat and avoid processed meat',
  publisher: 'World Cancer Research Fund (WCRF)',
  /** Access year: the page carries no publication date, so an inferred publication year would be a guess stated as fact. */
  year: 2026,
  url: 'https://www.wcrf.org/preventing-cancer/our-cancer-prevention-recommendations/limit-red-meat-and-avoid-processed-meat/',
  conclusion:
    'Use alternatives to ham in your sandwiches. Try chicken, hard-boiled eggs, tinned tuna (in spring water), ' +
    'low-fat houmous or low-fat cream cheese.',
};

const evidence: Evidence = {
  strength: 'strong',
  body: 'IARC',
  summary:
    'IARC reviewed more than 800 studies, and the most influential were large prospective cohort studies. It found ' +
    'sufficient evidence in humans that regular consumption of processed meat is linked to colorectal cancer.',
  citation,
  isAssociational: false,
};

const STRENGTH_SENTENCE = 'The classification describes how strong the evidence is, not how large the risk is.';

/** The portion against the 50 g reference, in words so that a decimal never reads as a precise comparison. */
function relation(grams: number): string {
  const r = grams / THRESHOLDS.referenceGramsPerDay;
  if (r < 0.95) return 'less than the';
  if (r <= 1.05) return 'about the same as the';
  if (r < 2) return 'between one and two times the';
  if (r < 3) return 'between two and three times the';
  return `about ${Math.round(r)} times the`;
}

export const processedMeatRule: Rule = {
  id: 'processed-meat',
  title: 'Processed meat',
  category: 'nutrition',
  scope: 'entry',
  requiresNutrients: [],
  horizon: 'habitual',
  evidence,
  concern:
    'IARC classifies processed meat as carcinogenic to humans (Group 1), based on sufficient evidence in humans ' +
    'linking regular consumption to colorectal cancer. ' +
    `${STRENGTH_SENTENCE} ` +
    'IARC estimated that each 50 g portion eaten daily is associated with an 18% higher relative risk of colorectal ' +
    'cancer, a figure for habitual intake over time. ' +
    'For an individual, IARC notes, the risk of colorectal cancer from regular consumption remains small. ' +
    'These statements are about usual intake over years, not a single serving, and IARC gives no figure for one serving.',
  cause:
    'Processed meat is meat transformed through salting, curing, fermentation, smoking or other processes to improve ' +
    'flavour or preservation, such as ham, sausages and hot dogs.',
  alternatives: [
    {
      label: 'Chicken, hard-boiled egg, tinned tuna, low-fat houmous or low-fat cream cheese',
      reason:
        'WCRF gives these as its own example of alternatives to processed meat — it names them for ham in ' +
        'sandwiches, and they are listed here as that example rather than as advice tailored to this entry.',
      citation: wcrfAlternative,
    },
  ],
  level: (ctx) => (ctx.pending.classification.processedMeat ? 'HIGH' : null),
  portionNote: (ctx) => {
    const g = pendingGramsOf(ctx, 'processedMeat');
    if (g <= 0) return 'The weight of processed meat in this entry is not known.';
    return (
      `This entry has about ${whole(g)} g of processed meat, which is ${relation(g)} 50 g reference amount. ` +
      "IARC's 18% figure is for that amount eaten every day over years, so one entry does not match it."
    );
  },
};

export const processedMeatFrequencyRule: Rule = {
  id: 'processed-meat-frequency',
  title: 'Processed meat this week',
  category: 'nutrition',
  // Reads the week's count, not one entry, so it takes the aggregate scope and its usual-intake tone test.
  scope: 'daily',
  requiresNutrients: [],
  horizon: 'habitual',
  evidence,
  concern:
    "IARC's finding on processed meat concerns habitual intake over time. This card shows how often processed meat " +
    'appears in your diary. No source gives a number of occasions a week at which the risk changes, so the card marks ' +
    'a count and not a limit. ' +
    `The app starts to show the count at ${THRESHOLDS.frequencyOccasionsInSevenDays} entries in seven days; that point ` +
    "is the app's own choice and not a published figure. " +
    STRENGTH_SENTENCE,
  cause: 'Processed meat appears in several entries over the last seven days.',
  level: (ctx) => {
    if (!ctx.pending.classification.processedMeat) return null;
    const before = weekCount(ctx.week.processedMeatOccasions);
    if (before === null) return null;
    return before + 1 >= THRESHOLDS.frequencyOccasionsInSevenDays ? 'INFO' : null;
  },
  portionNote: (ctx) => {
    const before = weekCount(ctx.week.processedMeatOccasions);
    if (before === null) return 'How often processed meat was logged this week is not known.';
    return `With this entry, processed meat appears in ${before + 1} entries in the last seven days. The diary counts entries, not amounts.`;
  },
};
