import { isKnownValue } from '@/domain/nutrients';
import type { NutrientKey } from '@/types/nutrients';
import CoverageNote, { NUTRIENT_LABEL } from './CoverageNote';

/** Whole numbers with a thousands separator; one decimal under 10. Never NaN. */
export function fmtAmount(n: number): string {
  if (!Number.isFinite(n)) return '?';
  const v = Math.abs(n) < 10 ? Math.round(n * 10) / 10 : Math.round(n);
  return v.toLocaleString('en-US');
}

/**
 * One nutrient against its target, with the target marked. Calm and neutral on purpose: this is not a warning surface,
 * so there is no alarm colour whether the figure is below or above the mark.
 *
 * A total is shown plainly only when it is COMPLETE: `coverage` is 'known' AND the energy-covered share is full. Both
 * are checked because the share can read 1 while coverage is 'partial' (an entry with no energy figure is invisible to the
 * ratio). Anything else is a floor ("at least"), and a nutrient nobody knew has no figure at all, never a zero.
 */
export default function NutrientBar({
  nutrient, value, coverage, energyCoveredShare, target,
}: {
  nutrient: NutrientKey;
  value: number | undefined;
  coverage: 'known' | 'partial' | 'unknown' | undefined;
  energyCoveredShare: number;
  target: number;
}) {
  const { name, unit } = NUTRIENT_LABEL[nutrient];
  const known = isKnownValue(value);
  const cov = coverage ?? 'unknown';
  const complete = known && cov === 'known' && energyCoveredShare >= 0.999;
  const shown = known && cov !== 'unknown' ? value : undefined;
  const okTarget = Number.isFinite(target) && target > 0;
  const scale = okTarget ? Math.max(target, shown ?? 0) * 1.25 : 1;
  const fillPct = shown !== undefined && okTarget ? Math.min(100, (shown / scale) * 100) : 0;
  const tickPct = okTarget ? (target / scale) * 100 : 0;

  return (
    <div data-testid={`bar-${nutrient}`} className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-base capitalize">{name}</span>
        {okTarget && <span className="text-xs text-slate-600">{`target ${fmtAmount(target)} ${unit}`}</span>}
      </div>
      {shown !== undefined && (
        <div
          role="progressbar"
          aria-label={`${name} against its target`}
          aria-valuemin={0}
          aria-valuemax={okTarget ? Math.round(target) : 0}
          aria-valuenow={Math.round(shown)}
          className="relative h-3 rounded-full bg-slate-200"
        >
          <div className="absolute inset-y-0 left-0 rounded-full bg-sky-700" style={{ width: `${fillPct}%` }} />
          {okTarget && <div aria-hidden className="absolute -inset-y-1 w-0.5 bg-slate-900" style={{ left: `${tickPct}%` }} />}
        </div>
      )}
      {complete ? (
        <span className="text-sm font-semibold">{`${fmtAmount(value)} ${unit}`}</span>
      ) : (
        <CoverageNote nutrient={nutrient} coverage={shown === undefined ? 'unknown' : 'partial'} value={shown} />
      )}
    </div>
  );
}
