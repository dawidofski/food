import type { WeightTrend } from './weightTrend';

/** The owner chose twelve weeks. Past that the assumption behind the line stops being worth drawing. */
export const PROJECTION_WEEKS = 12;

/**
 * Ordinary day-to-day variation — water, a meal, the time of day — as a floor under the band's width.
 *
 * **This app's own working figure, not a published one**, and the screen says so. Without it a very tidy log
 * would produce a hairline band, implying a precision no bathroom scale has.
 */
export const DAILY_FLUCTUATION_KG = 0.5;

/** The ordinary 95% multiplier for a standard error. */
const CONFIDENCE_95 = 1.96;

export type ProjectedWeek = { week: number; kg: number; lowKg: number; highKg: number };

/**
 * Where the measured rate leads, with a band that widens as it goes.
 *
 * It follows the **measured** rate and nothing else: §8.5 is explicit that where the arithmetic and the scale
 * disagree, the scale governs the projection. The band widens both with distance and with how much this
 * person's own weigh-ins scatter, so a noisy log is honestly drawn as a wider cone rather than a confident line.
 *
 * Empty for an unknown trend. A band with no line behind it would be a guess with nothing to anchor it, which
 * is worse than drawing nothing.
 */
export function weightProjection(trend: WeightTrend, latestKg: number): ProjectedWeek[] {
  if (trend.kind === 'unknown' || !Number.isFinite(latestKg)) return [];
  const out: ProjectedWeek[] = [];
  for (let week = 1; week <= PROJECTION_WEEKS; week++) {
    const days = week * 7;
    const kg = latestKg + (trend.kgPerWeek / 7) * days;
    const half = DAILY_FLUCTUATION_KG + CONFIDENCE_95 * trend.seKgPerDay * days;
    if (!Number.isFinite(kg) || !Number.isFinite(half)) break;
    out.push({ week, kg, lowKg: kg - half, highKg: kg + half });
  }
  return out;
}
