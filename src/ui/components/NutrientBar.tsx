import { isKnownValue } from '@/domain/nutrients';
import { directionOf, type TargetDirection } from '@/domain/targetDirection';
import type { NutrientKey } from '@/types/nutrients';
import CoverageNote, { NUTRIENT_LABEL } from './CoverageNote';

/** Whole numbers with a thousands separator; one decimal under 10. Never NaN. */
export function fmtAmount(n: number): string {
  if (!Number.isFinite(n)) return '?';
  const v = Math.abs(n) < 10 ? Math.round(n * 10) / 10 : Math.round(n);
  return v.toLocaleString('en-US');
}

/** The word the figure is measured against: something to reach, something to stay under, or neither. */
const FIGURE_WORD: Record<TargetDirection, string> = { floor: 'target', ceiling: 'limit', none: 'goal' };

/**
 * One nutrient against its target, with the target marked. Calm and neutral on purpose: this is not a warning surface,
 * so there is no alarm colour whether the figure is below or above the mark.
 *
 * A total is shown plainly only when it is COMPLETE: `coverage` is 'known' AND the energy-covered share is full. Both
 * are checked because the share can read 1 while coverage is 'partial' (an entry with no energy figure is invisible to the
 * ratio). Anything else is a floor ("at least"), and a nutrient nobody knew has no figure at all, never a zero.
 */
export default function NutrientBar({
  nutrient, value, coverage, energyCoveredShare, target, secondMark,
}: {
  nutrient: NutrientKey;
  value: number | undefined;
  coverage: 'known' | 'partial' | 'unknown' | undefined;
  energyCoveredShare: number;
  target: number;
  /** A second mark on the same bar (a lower figure that is not a nutrient of its own). It inherits the bar's direction. */
  secondMark?: { value: number; label: string };
}) {
  const word = FIGURE_WORD[directionOf(nutrient)];
  const { name, unit } = NUTRIENT_LABEL[nutrient];
  const known = isKnownValue(value);
  const cov = coverage ?? 'unknown';
  const complete = known && cov === 'known' && energyCoveredShare >= 0.999;
  const shown = known && cov !== 'unknown' ? value : undefined;
  const okTarget = Number.isFinite(target) && target > 0;
  const okSecond = okTarget && secondMark !== undefined && Number.isFinite(secondMark.value) && secondMark.value > 0;
  const scale = okTarget ? Math.max(target, shown ?? 0, okSecond ? secondMark.value : 0) * 1.25 : 1;
  const fillPct = shown !== undefined && okTarget ? Math.min(100, (shown / scale) * 100) : 0;
  const tickPct = okTarget ? (target / scale) * 100 : 0;
  const secondPct = okSecond ? (secondMark.value / scale) * 100 : 0;

  // The track's scale is wider than the mark, so valuenow stays inside valuemax even past a limit; the text carries the
  // reading. A partial total is a floor ("at least"), so it is never called over or under.
  let valueText = '';
  if (shown !== undefined) {
    const figure = `${fmtAmount(shown)} ${unit}`;
    const against = `the ${word} of ${fmtAmount(target)} ${unit}`;
    if (!complete) valueText = okTarget ? `at least ${figure}, against ${against}` : `at least ${figure}`;
    else if (!okTarget) valueText = figure;
    else if (shown > target) valueText = `${figure}, over ${against}`;
    else if (shown < target) valueText = `${figure}, under ${against}`;
    else valueText = `${figure}, at ${against}`;
  }

  return (
    <div data-testid={`bar-${nutrient}`} className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-base capitalize">{name}</span>
        {okTarget && <span className="text-xs text-slate-600 dark:text-slate-400">{`${word} ${fmtAmount(target)} ${unit}`}</span>}
      </div>
      {shown !== undefined && (
        <div
          role="progressbar"
          aria-label={`${name} against its ${word}`}
          aria-valuemin={0}
          aria-valuemax={Math.max(Math.ceil(scale), Math.round(shown))}
          aria-valuenow={Math.round(shown)}
          aria-valuetext={valueText}
          className="relative h-3 rounded-full bg-slate-200 dark:bg-slate-800"
        >
          <div className="absolute inset-y-0 left-0 rounded-full bg-sky-700 dark:bg-sky-500" style={{ width: `${fillPct}%` }} />
          {okTarget && <div aria-hidden data-mark="main" className="absolute -inset-y-1 w-0.5 bg-slate-900 dark:bg-slate-100" style={{ left: `${tickPct}%` }} />}
          {okSecond && <div aria-hidden data-mark="second" className="absolute -inset-y-0.5 w-0.5 bg-slate-500 dark:bg-slate-400" style={{ left: `${secondPct}%` }} />}
        </div>
      )}
      {okSecond && (
        <span className="block text-xs text-slate-600 dark:text-slate-400">{`${secondMark.label}: ${fmtAmount(secondMark.value)} ${unit}`}</span>
      )}
      {complete ? (
        <span className="text-sm font-semibold">{`${fmtAmount(value)} ${unit}`}</span>
      ) : (
        <CoverageNote nutrient={nutrient} coverage={shown === undefined ? 'unknown' : 'partial'} value={shown} />
      )}
    </div>
  );
}
