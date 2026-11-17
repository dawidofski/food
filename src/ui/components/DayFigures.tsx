import { useState, type SyntheticEvent } from 'react';
import { lsKey } from '@/data/db';
import { energySourceSentence } from '@/domain/energySource';
import type { DayTotals } from '@/domain/totals';
import type { NutrientKey } from '@/types/nutrients';
import type { Profile, Targets } from '@/types/profile';
import NutrientBar from './NutrientBar';

/** A second tick is drawn only when it sits clearly apart from the main one: at least 5% of the main figure below it. A typed override can land a gram away. */
const clearOf = (second: number, main: number): boolean => main - second >= main * 0.05;

type SecondMark = { value: number; label: string };

/**
 * `second` is a lower figure drawn on the same bar. Protein's is EFSA's floor beneath the target; added sugars' is WHO's
 * stricter conditional figure beneath the limit. It is left out when it would sit on the main mark.
 */
const TODAY_BARS: { key: NutrientKey; target: (t: Targets) => number; second?: (t: Targets) => SecondMark | undefined }[] = [
  { key: 'energyKcal', target: (t) => t.energyKcal },
  {
    key: 'proteinG',
    target: (t) => t.proteinG,
    second: (t) => (clearOf(t.proteinFloorG, t.proteinG) ? { value: t.proteinFloorG, label: 'EFSA reference intake for adults, 0.83 g per kg' } : undefined),
  },
  { key: 'fibreG', target: (t) => t.fibreG },
  { key: 'sodiumMg', target: (t) => t.sodiumMg },
  { key: 'satFatG', target: (t) => t.satFatG },
  {
    key: 'addedSugarsG',
    target: (t) => t.addedSugarsG,
    second: (t) => (clearOf(t.addedSugarsIdealG, t.addedSugarsG) ? { value: t.addedSugarsIdealG, label: "WHO's stricter, conditional advice, 5% of energy" } : undefined),
  },
];

/**
 * The footnote that says which of the figures behind the bars are this app's own working figures.
 *
 * It keys on what PRODUCED those figures — `basis.energy` and `basis.expenditure`, the same pair `energySource.ts` reads —
 * and not on whether the profile is generic. Each item is credited only where it reached a figure on this screen, so the
 * credit is never orphaned:
 *
 * - the activity factor, where the formula produced the expenditure figure AND the person did not type an energy target.
 *   A reported burn replaced the factor outright. A typed figure replaced its product: since amendment A3 the five
 *   share-derived limits are shares of the typed figure, so nothing left on this screen came through the factor.
 * - the goal offset, only where one can reach the energy target: never on the generic basis, and never under a typed
 *   energy figure, which `computeTargets` overlays while deleting `goalCapped`, so the goal moves the target by nothing.
 * - the fibre rule, always: it applies to whichever energy target is in force.
 */
export function ownTargetsNote(basis: Targets['basis'], isGeneric: boolean): string {
  const typed = basis.energy === 'custom';
  const usesFactor = !typed && basis.expenditure === 'formula';
  const usesGoal = !typed && !isGeneric;
  const own = [...(usesFactor ? ['the activity factor'] : []), ...(usesGoal ? ['the goal offset'] : []), 'the fibre rule'];
  const credit =
    own.length === 1
      ? `${own[0]!} is this app’s own working figure`
      : `${own.slice(0, -1).join(', ')} and ${own[own.length - 1]!} are this app’s own working figures`;
  const lead = usesGoal ? 'Any goal offset is added to the energy target; the' : 'The';
  return `${lead} fibre target is 14 g per 1,000 kcal, at least 30 g. ${credit[0]!.toUpperCase()}${credit.slice(1)}, not a published recommendation.`;
}

/** The summary the person taps to read where the figures came from. Exported so a test pins the exact words. */
export const PROVENANCE_SUMMARY = 'Where these figures come from';

const OPEN_KEY = 'dayFigures.open';

/**
 * A day's figures against their targets, with every sentence saying where those targets came from behind one
 * disclosure.
 *
 * It is one component, rendered by both the diary and the missing screen, because two screens must never keep
 * separate accounts of where a figure came from — a previous plan's whole-branch review found exactly that, and
 * fixing it one screen at a time produced a screen that was correct alone and wrong beside its neighbour.
 *
 * The provenance text is collapsed by default and loses nothing: the full account is inside, from the one shared
 * wording source, never a copy of it.
 */
export default function DayFigures({
  totals,
  targets,
  activityLevel,
  reportedDays,
  emptyText,
}: {
  totals: DayTotals;
  targets: Targets;
  activityLevel?: Profile['activityLevel'];
  /** How many of the window's days carried a reported burn figure. Absent when none did. */
  reportedDays?: number;
  /** Shown in place of the bars when nothing is logged. */
  emptyText: string;
}) {
  // Per-viewer convenience only. It can throw in a private window or with site data blocked, and it must never
  // decide whether the sentences exist — only whether they start open.
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(lsKey(OPEN_KEY)) === '1';
    } catch {
      return false;
    }
  });

  // The summary drives it rather than the element's own `toggle` event: `toggle` is not dispatched everywhere a
  // <details> can be opened, and a preference that silently fails to save is worse than none. `preventDefault`
  // stops the native toggle so `open` has exactly one source of truth.
  const toggle = (e: SyntheticEvent) => {
    e.preventDefault();
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(lsKey(OPEN_KEY), next ? '1' : '0');
    } catch {
      // Storage is unavailable; the disclosure still works for this visit.
    }
  };

  return (
    <div className="space-y-3">
      {totals.entryCount === 0 ? (
        <p className="text-base">{emptyText}</p>
      ) : (
        TODAY_BARS.map(({ key, target, second }) => {
          const secondMark = second?.(targets);
          return (
            <NutrientBar
              key={key}
              nutrient={key}
              value={totals.nutrients[key]}
              coverage={totals.coverage[key]}
              energyCoveredShare={totals.energyCoveredShare[key]}
              target={target(targets)}
              {...(secondMark ? { secondMark } : {})}
            />
          );
        })
      )}

      <details data-testid="figures-provenance" open={open}>
        <summary onClick={toggle} className="min-h-11 cursor-pointer py-2 text-xs text-slate-600 dark:text-slate-400">{PROVENANCE_SUMMARY}</summary>
        <div className="space-y-2 pb-1">
          {targets.isGeneric && <p className="text-xs text-slate-600 dark:text-slate-400">Targets use general adult guidelines until your profile is set up.</p>}
          <p data-testid="energy-source" className="text-xs text-slate-600 dark:text-slate-400">
            {energySourceSentence(targets.basis, activityLevel, reportedDays, targets.isGeneric)}
          </p>
          <p data-testid="own-targets-note" className="text-xs text-slate-600 dark:text-slate-400">
            {ownTargetsNote(targets.basis, targets.isGeneric)} WHO advises at least 25 g
            of fibre a day. Protein comes from two sources: EFSA&rsquo;s reference intake of 0.83 g
            per kg of body weight, and for people who exercise, the International Society of Sports Nutrition&rsquo;s range of 1.4 to 2.0 g
            per kg, within which this app uses the middle, 1.7 g, and the top, 2.0 g, when your goal is to lose weight. The sodium, saturated fat and added sugar limits are WHO&rsquo;s. You can change any
            target in Settings.
          </p>
        </div>
      </details>
    </div>
  );
}
