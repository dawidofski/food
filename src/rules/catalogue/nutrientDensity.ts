import type { Citation, Evidence, Rule } from '../types';
import { pending, usable } from './shared';

/**
 * Context, not risk (spec 9.3). No source publishes a nutrient-density figure for an entry, so none is claimed. The rule
 * is the app's own comparison of ONE entry with the day's targets: it fires INFO when the entry supplies at least a tenth
 * of the day's energy target but a smaller share of the fibre target AND of the protein target. The one-tenth floor stops
 * it firing on a coffee or a snack; it is a display choice and the card says it is not a published figure.
 * Declared 'limited': the card names no health outcome, and the figures it compares with are the app's targets, whose
 * WHO basis (at least 25 g fibre a day) is a recommendation whose certainty was not read here. The plan's "micronutrients"
 * part is dropped: the context's micronutrient coverage is too patchy to compare, and no source sets entry-level figures.
 * The one citation is WHO's healthy-diet fact sheet (carbohydrate should come mainly from whole grains, vegetables,
 * fruits and pulses). Its wording is free of disease and risk language on purpose; the tests check that.
 * Reads energy, fibre and protein, so it declares them: the engine stays silent when any is unknown for the entry.
 */
const THRESHOLDS = {
  /** Smallest share of the day's energy target an entry must supply before the comparison is shown. */
  minEnergyShare: 0.1,
};

const citation: Citation = {
  title: 'Healthy diet (fact sheet)',
  publisher: 'World Health Organization',
  year: 2026,
  url: 'https://www.who.int/news-room/fact-sheets/detail/healthy-diet',
  conclusion: 'Carbohydrates in the diet should come primarily from whole grains, vegetables, fruits and pulses.',
};

const evidence: Evidence = {
  strength: 'limited',
  body: 'WHO',
  summary:
    'This card is entirely the app’s own comparison of one entry’s energy against your fibre and protein ' +
    'targets. No guideline sets it, and the citation below is background on diet quality rather than a source for ' +
    'this comparison: nothing cited here concerns protein, energy share, or any single entry.',
  citation,
  isAssociational: false,
};

function shares(ctx: Parameters<Rule['level']>[0]): { energy: number; fibre: number; protein: number } | null {
  const e = pending(ctx, 'energyKcal');
  const f = pending(ctx, 'fibreG');
  const p = pending(ctx, 'proteinG');
  const { energyKcal, fibreG, proteinG } = ctx.targets;
  if (e === null || f === null || p === null) return null;
  if (!usable(energyKcal) || !usable(fibreG) || !usable(proteinG)) return null;
  return { energy: e / energyKcal, fibre: f / fibreG, protein: p / proteinG };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export const nutrientDensityRule: Rule = {
  id: 'nutrient-density',
  title: 'Energy compared with fibre and protein',
  category: 'nutrition',
  scope: 'entry',
  requiresNutrients: ['energyKcal', 'fibreG', 'proteinG'],
  horizon: 'occasional',
  evidence,
  concern:
    'This entry supplies a larger share of your energy target than of your fibre target and of your protein target. ' +
    "That describes the entry's makeup against whole-day targets, and other entries today may balance it. " +
    'No standard sets a nutrient density figure for a single serving, and the card appears from one tenth of the ' +
    "day's energy target as the app's own choice, not a published figure.",
  cause: 'The entry is high in energy for its fibre and protein.',
  level: (ctx) => {
    const s = shares(ctx);
    if (s === null) return null;
    return s.energy >= THRESHOLDS.minEnergyShare && s.fibre < s.energy && s.protein < s.energy ? 'INFO' : null;
  },
  portionNote: (ctx) => {
    const s = shares(ctx);
    if (s === null) return 'The energy, fibre or protein in this entry is not known.';
    return `This entry has ${pct(s.energy)} of your energy target, ${pct(s.fibre)} of your fibre target and ${pct(s.protein)} of your protein target.`;
  },
};
