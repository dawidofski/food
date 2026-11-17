import type { ReactNode } from 'react';
import { isKnownValue } from '@/domain/nutrients';
import type { DayTotals, MealGroup } from '@/domain/totals';
import type { NutrientKey } from '@/types/nutrients';
import { NUTRIENT_LABEL } from './CoverageNote';
import { fmtAmount } from './NutrientBar';

const GROUP_LABEL: Record<MealGroup, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
  earlier: 'Earlier',
};

/** The figures a slot heading carries beneath its energy: what this meal contributed, so a thin breakfast is visible. */
const SUB_FIGURES: NutrientKey[] = ['proteinG', 'satFatG'];

/**
 * One figure for a slot, or nothing at all.
 *
 * A key no entry in the slot knew has no figure — never `0`, which would read as "this meal had none". A total that
 * is only partly known is a floor and says "at least", the same reading `NutrientBar` gives it, because some of the
 * slot's entries carried no value for it.
 */
function figure(totals: DayTotals, key: NutrientKey): string | undefined {
  const v = totals.nutrients[key];
  if (!isKnownValue(v) || totals.coverage[key] === 'unknown') return undefined;
  const complete = totals.coverage[key] === 'known' && totals.energyCoveredShare[key] >= 0.999;
  const { unit } = NUTRIENT_LABEL[key];
  return `${complete ? '' : 'at least '}${fmtAmount(v)} ${unit}`;
}

/**
 * A meal slot: what it contributed, then what was logged in it.
 *
 * The heading's figures are this slot's own, so the person can see which meal is thin on protein and which carries
 * the saturated fat. The app states the figures and does not grade them: a verdict would need cutoffs nobody
 * published, and inventing authority is what this project refuses to do.
 *
 * An empty slot shows a dash. `earlier` holds entries logged before slots existed, or a value this build does not
 * recognise; its caller renders it only when it has something in it.
 */
export default function MealSection({
  group,
  totals,
  children,
}: {
  group: MealGroup;
  totals: DayTotals;
  /** The slot's entry rows. */
  children: ReactNode;
}) {
  const energy = figure(totals, 'energyKcal');
  const subs = SUB_FIGURES.map((k) => figure(totals, k)).filter((s): s is string => s !== undefined);
  const empty = totals.entryCount === 0;

  return (
    <section aria-labelledby={`meal-${group}`} data-testid={`meal-${group}`} className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 border-b border-slate-300 dark:border-slate-700 pt-3 pb-1">
        <h3 id={`meal-${group}`} className="text-sm font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">
          {GROUP_LABEL[group]}
        </h3>
        <span className="text-sm text-slate-700 dark:text-slate-300">{empty ? '—' : (energy ?? '')}</span>
      </div>
      {!empty && subs.length > 0 && (
        <p className="text-xs text-slate-600 dark:text-slate-400">{subs.join(' · ')}</p>
      )}
      {children}
    </section>
  );
}
