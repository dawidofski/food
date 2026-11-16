import type { Citation, Evidence, Rule } from '../types';
import { occasionsNote, occasionsWithThisEntry, weekCount } from './shared';

/**
 * THE DESIGN'S NAMED TEST OF ANTI-GOAL A3 (spec 9.3). Decision: a DAILY, qualitative INFO, declared 'limited' and
 * associational. It counts the share of the day's ENTRIES that are NOVA 4, and fires only at a high share.
 *
 * Why not the plan's "NOVA 4 at a high share of the day's energy": the context carries a NOVA group per entry but no
 * per-entry energy, so the energy share cannot be computed, and no source defines what a high share is. Why not a flag on
 * every NOVA 4 item (the first version of this rule): about a third of the dataset is NOVA 4, so it would fire on a third of
 * everything logged and train the reader to stop reading cards (warning fatigue, which would also silence the processed-meat
 * card). A statement about the day's pattern is the kind of claim the evidence is about, and it fires rarely.
 *
 * The trigger is the APP'S OWN CHOICE, not a published figure, and the card says so: MORE THAN HALF of the day's entries,
 * this one included, with at least THREE entries so that one logged snack cannot trigger it. It also requires the pending
 * entry to be NOVA 4 itself, so the card does not repeat on every later entry of the day. The card discloses that it counts
 * entries, not energy or amount, so it marks a daily pattern rather than measuring one, and that the triggering share is the
 * app's own choice rather than a published figure. Flattening (anti-goal A4): the card also says the category is
 * broad.
 *
 * Verified against SACN's April 2025 rapid evidence update (read at source: consistent associations, evidence almost
 * exclusively observational, residual confounding likely) and WHO's May 2025 call for experts (WHO is still developing a
 * guideline). INFO is the ceiling anyway: the engine caps 'limited' evidence at MODERATE, and this rule does not ask for it.
 * Reads classification counts, not nutrients, so it declares no required nutrients and the coverage gate does not protect it.
 * A mixed entry is NOVA 4 when ANY food in it is (the merged worst case).
 */
const THRESHOLDS = {
  /** The share of the day's entries, this one included, that must be NOVA 4 (more than). The app's own choice. */
  shareOfEntriesMoreThan: 0.5,
  /** Entries in the day, this one included, before the share means anything. The app's own choice. */
  minEntries: 3,
};

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

/** This entry plus the day so far, as counts of entries. Null when any count cannot be trusted. */
function dayCounts(ctx: Parameters<Rule['level']>[0]): { nova4: number; total: number } | null {
  const before = weekCount(ctx.today.entryCount);
  const beforeNova4 = weekCount(ctx.today.nova4EntryCount);
  if (before === null || beforeNova4 === null || beforeNova4 > before) return null;
  return { nova4: beforeNova4 + 1, total: before + 1 };
}

export const ultraProcessedRule: Rule = {
  id: 'ultra-processed',
  title: 'Ultra-processed food today',
  category: 'nutrition',
  // Reads the day's entries, not one entry, so it takes the aggregate scope and its usual-intake tone test.
  scope: 'daily',
  requiresNutrients: [],
  horizon: 'habitual',
  evidence,
  concern:
    'With this entry, most of what you have logged today is in NOVA group 4, the ultra-processed category. ' +
    'This card counts entries, not energy or amount, so it marks a daily pattern rather than measuring one. ' +
    'The category is broad: it covers foods of very different makeup, and the evidence does not separate them, so the ' +
    'group alone says little about any one entry. ' +
    'Studies that observe people link higher usual consumption of ultra-processed food with adverse health outcomes, ' +
    'but the evidence is almost entirely observational and some confounding is likely to remain. ' +
    'It is unclear whether processing itself or the nutrient content of these foods explains the link. ' +
    'No threshold is established, so this card marks a pattern and not an amount. ' +
    `It appears when more than half of today's entries, and at least ${THRESHOLDS.minEntries}, are NOVA 4; that point ` +
    "is the app's own choice and not a published figure.",
  cause: 'NOVA group 4 describes industrial formulations of food substances, often with additives, as defined by the NOVA system.',
  level: (ctx) => {
    if (ctx.pending.classification.novaGroup !== 4) return null;
    const c = dayCounts(ctx);
    if (c === null || c.total < THRESHOLDS.minEntries) return null;
    return c.nova4 / c.total > THRESHOLDS.shareOfEntriesMoreThan ? 'INFO' : null;
  },
  portionNote: (ctx) => {
    const c = dayCounts(ctx);
    if (c === null) return 'How many of today\'s entries are ultra-processed is not known.';
    return `With this entry, ${c.nova4} of ${c.total} entries today are NOVA 4. The diary counts entries, not how much energy each supplied.`;
  },
  // The day the card fires on, widened to the week as a count of entries. SACN names no number of entries a week.
  patternNote: (ctx) => {
    const o = occasionsWithThisEntry(ctx, ctx.week.ultraProcessedOccasions);
    if (o === null) return null;
    return `${occasionsNote(o, 'NOVA group 4 food appears')} The diary counts entries, not energy or amount.`;
  },
};
