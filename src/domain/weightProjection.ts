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

/**
 * The 95% multiplier for a standard error estimated on `df` degrees of freedom.
 *
 * NOT a flat 1.96. At the three-weigh-ins this app allows as a minimum there is one degree of freedom, where the
 * right multiplier is 12.71 — using 1.96 there would draw a band about six times too narrow exactly where the
 * data is thinnest, which is the opposite of honest. Values are the usual two-tailed t table; beyond 30 the
 * difference from 1.96 stops mattering.
 */
const T95: Record<number, number> = {
  1: 12.71, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
  12: 2.179, 15: 2.131, 20: 2.086, 25: 2.060, 30: 2.042,
};

function t95(df: number): number {
  if (df <= 0) return T95[1] ?? 12.71;
  if (df >= 30) return 1.96;
  const keys = Object.keys(T95).map(Number).sort((a, b) => a - b);
  const at = keys.filter((k) => k <= df).pop() ?? 1;
  return T95[at] ?? 1.96;
}

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
  const t = t95(trend.points - 2);
  const out: ProjectedWeek[] = [];
  for (let week = 1; week <= PROJECTION_WEEKS; week++) {
    const days = week * 7;
    const kg = latestKg + (trend.kgPerWeek / 7) * days;
    // Three separate uncertainties, added rather than one replacing another:
    //  - the scale and the body on any given morning (the floor);
    //  - how far the fitted rate itself could be out, which compounds with distance;
    //  - the scatter of the weigh-ins about the line, which does not shrink just because we are predicting.
    const rateDoubt = t * trend.seKgPerDay * (days + trend.spanDays / 2);
    const scatter = trend.seKgPerDay * Math.sqrt(Math.max(trend.points, 1)) * Math.sqrt(trend.spanDays || 1);
    const half = DAILY_FLUCTUATION_KG + rateDoubt + scatter;
    if (!Number.isFinite(kg) || !Number.isFinite(half)) break;
    out.push({ week, kg, lowKg: kg - half, highKg: kg + half });
  }
  return out;
}
