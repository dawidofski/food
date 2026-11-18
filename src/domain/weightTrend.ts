/**
 * Which way the person's weight is actually going, from the scale and nothing else.
 *
 * The three figures below are **this app's own choice, not a published definition**, and the screen says so.
 * They exist for one reason: two weigh-ins a day apart imply a rate of tens of kilograms a week. That is water,
 * meals and the time of day, not fat, and drawing an arrow from it would be confident nonsense about someone's
 * own body. So the app says nothing until there is enough to say something with.
 */

/** Fewer weigh-ins than this and no direction is named. */
export const MIN_WEIGH_INS = 3;
/** A rate measured over a shorter span than this is noise, however many weigh-ins it has. */
export const MIN_SPAN_DAYS = 14;
/** Inside this, in either direction, it is holding steady rather than drifting. */
export const HOLDING_KG_PER_WEEK = 0.1;

export type WeightTrend =
  | {
      kind: 'losing' | 'gaining' | 'holding';
      /** Negative when losing. */
      kgPerWeek: number;
      spanDays: number;
      points: number;
      /**
       * The standard error of the fitted daily slope: how much this person's own weigh-ins scatter around the
       * line. The projection widens its band with it, so a tidy log gets a narrow band and a noisy one a wide
       * band. 0 when there are too few points to estimate it.
       */
      seKgPerDay: number;
    }
  | { kind: 'unknown'; reason: 'none' | 'too-few' | 'too-short'; points: number; spanDays: number };

const DAY_MS = 86_400_000;

/** Midday of a `YYYY-MM-DD` key, so a daylight-saving shift cannot move a weigh-in to the day before. */
function noonOf(dayKey: string): number {
  const [y, m, d] = dayKey.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) return Number.NaN;
  return new Date(y, m - 1, d, 12).getTime();
}

/**
 * The measured trend over the whole log.
 *
 * The rate is an ordinary least-squares fit over (day, kg) — the fit *is* the smoothing, which is why there is
 * no second smoother anywhere. `on` is accepted so the caller controls the clock and nothing here reads it.
 *
 * The log is deduplicated by date keeping the last figure for a day, sorted, and stripped of rows whose weight
 * is not a finite number, because a caller must not have to have done any of that.
 */
export function weightTrend(log: { date: string; kg: number }[], _on: Date): WeightTrend {
  const byDate = new Map<string, number>();
  for (const row of log) {
    if (typeof row?.date !== 'string' || !Number.isFinite(row?.kg)) continue;
    const t = noonOf(row.date);
    if (!Number.isFinite(t)) continue;
    byDate.set(row.date, row.kg);
  }
  const points = [...byDate.entries()]
    .map(([date, kg]) => ({ t: noonOf(date), kg }))
    .sort((a, b) => a.t - b.t);

  const n = points.length;
  const first = points[0];
  const last = points[n - 1];
  const spanDays = n >= 2 && first !== undefined && last !== undefined ? Math.round((last.t - first.t) / DAY_MS) : 0;

  if (n === 0) return { kind: 'unknown', reason: 'none', points: 0, spanDays: 0 };
  if (n < MIN_WEIGH_INS) return { kind: 'unknown', reason: 'too-few', points: n, spanDays };
  if (spanDays < MIN_SPAN_DAYS) return { kind: 'unknown', reason: 'too-short', points: n, spanDays };

  // Days since the first weigh-in, so the numbers stay small and the intercept means something.
  const xs = points.map((p) => (p.t - (first?.t ?? 0)) / DAY_MS);
  const ys = points.map((p) => p.kg);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] ?? 0) - meanX;
    sxx += dx * dx;
    sxy += dx * ((ys[i] ?? 0) - meanY);
  }
  // Every weigh-in on one day: no slope exists. The span gate above already catches this in practice; the guard
  // stays because a division by zero here would put Infinity on a screen about someone's body.
  if (!(sxx > 0)) return { kind: 'unknown', reason: 'too-short', points: n, spanDays };

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  // Residual scatter about the line, then the standard error of the slope itself.
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const fitted = intercept + slope * (xs[i] ?? 0);
    const r = (ys[i] ?? 0) - fitted;
    ss += r * r;
  }
  const seKgPerDay = n > 2 ? Math.sqrt(ss / (n - 2) / sxx) : 0;

  const kgPerWeek = slope * 7;
  const kind = Math.abs(kgPerWeek) < HOLDING_KG_PER_WEEK ? 'holding' : kgPerWeek < 0 ? 'losing' : 'gaining';
  return {
    kind,
    kgPerWeek: Number.isFinite(kgPerWeek) ? kgPerWeek : 0,
    spanDays,
    points: n,
    seKgPerDay: Number.isFinite(seKgPerDay) ? seKgPerDay : 0,
  };
}
