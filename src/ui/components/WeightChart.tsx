import type { ProjectedWeek } from '@/domain/weightProjection';

const W = 320;
const H = 120;
const PAD = 8;

const DAY_MS = 86_400_000;

function noonOf(dayKey: string): number {
  const [y, m, d] = dayKey.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) return Number.NaN;
  return new Date(y, m - 1, d, 12).getTime();
}

/**
 * The logged weights, and where the measured rate leads.
 *
 * The two are drawn so they cannot be mistaken for each other: what was weighed is a solid line with a dot per
 * weigh-in, what is projected is a dashed line inside a faded band. The band is the point — it says the further
 * out you look the less this is worth trusting — and the chart carries a visible label saying the shaded part
 * is an estimate, because a picture is exactly where a guess gets mistaken for a measurement.
 *
 * `role="img"` with a sentence for an `aria-label`, since a line is nothing to a screen reader.
 */
export default function WeightChart({
  log,
  projection,
  label,
}: {
  /** Any order; this sorts. */
  log: { date: string; kg: number }[];
  projection: ProjectedWeek[];
  /** The sentence a screen reader hears in place of the picture. */
  label: string;
}) {
  const points = log
    .filter((w) => Number.isFinite(w.kg) && Number.isFinite(noonOf(w.date)))
    .map((w) => ({ t: noonOf(w.date), kg: w.kg }))
    .sort((a, b) => a.t - b.t);

  if (points.length === 0) return null;

  const lastT = points[points.length - 1]?.t ?? 0;
  const firstT = points[0]?.t ?? lastT;
  const endT = projection.length > 0 ? lastT + (projection[projection.length - 1]?.week ?? 0) * 7 * DAY_MS : lastT;

  const kgs = [
    ...points.map((p) => p.kg),
    ...projection.flatMap((p) => [p.lowKg, p.highKg]),
  ].filter((v) => Number.isFinite(v));
  const lo = Math.min(...kgs);
  const hi = Math.max(...kgs);
  // A flat log would give a zero-height axis and divide by zero; a kilogram of room is enough to draw it.
  const span = hi - lo > 0.2 ? hi - lo : 1;
  const tSpan = endT - firstT > 0 ? endT - firstT : DAY_MS;

  const x = (t: number) => PAD + ((t - firstT) / tSpan) * (W - PAD * 2);
  const y = (kg: number) => PAD + (1 - (kg - lo) / span) * (H - PAD * 2);

  const measured = points.map((p) => `${x(p.t)},${y(p.kg)}`).join(' ');
  const projPoints = projection.map((p) => ({ t: lastT + p.week * 7 * DAY_MS, ...p }));
  const centre = [`${x(lastT)},${y(points[points.length - 1]?.kg ?? 0)}`, ...projPoints.map((p) => `${x(p.t)},${y(p.kg)}`)].join(' ');
  const band =
    projPoints.length > 0
      ? [
          `${x(lastT)},${y(points[points.length - 1]?.kg ?? 0)}`,
          ...projPoints.map((p) => `${x(p.t)},${y(p.highKg)}`),
          ...[...projPoints].reverse().map((p) => `${x(p.t)},${y(p.lowKg)}`),
        ].join(' ')
      : '';

  // Said only when true: with a near-perfect log the band is the fluctuation floor and barely moves, and a
  // caption claiming it widens would describe something the picture does not do.
  const firstW = projection[0] === undefined ? 0 : projection[0].highKg - projection[0].lowKg;
  const lastW = projection[projection.length - 1] === undefined ? 0 : (projection[projection.length - 1]?.highKg ?? 0) - (projection[projection.length - 1]?.lowKg ?? 0);
  const widens = lastW > firstW * 1.2;

  return (
    <figure className="m-0">
      <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${H}`} className="h-32 w-full">
        {band !== '' && (
          <polygon points={band} className="fill-sky-700/15 dark:fill-sky-400/15" />
        )}
        {band !== '' && (
          <polyline points={centre} fill="none" strokeDasharray="4 3" strokeWidth="1.5" className="stroke-sky-700/70 dark:stroke-sky-400/70" />
        )}
        <polyline points={measured} fill="none" strokeWidth="2" className="stroke-sky-700 dark:stroke-sky-400" />
        {points.map((p) => (
          <circle key={p.t} cx={x(p.t)} cy={y(p.kg)} r="2.5" className="fill-sky-700 dark:fill-sky-400" />
        ))}
      </svg>
      {projection.length > 0 && (
        <figcaption className="text-xs text-slate-600 dark:text-slate-400">
          The solid line is what you weighed. The shaded part is an estimate of where this rate would lead, not a
          measurement.
          {widens
            ? ' It widens because the further ahead you look the less it is worth trusting.'
            : ' Its width is the ordinary day-to-day variation of a bathroom scale; your weigh-ins are so close to a straight line that they add almost nothing to it.'}
        </figcaption>
      )}
    </figure>
  );
}
