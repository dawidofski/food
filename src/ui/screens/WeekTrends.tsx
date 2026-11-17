import { useEffect, useMemo, useState } from 'react';
import { entriesBetween } from '@/data/db';
import { lastNDayKeys, localDayKey, localDayRange } from '@/domain/dayBoundary';
import { MIN_LOGGED_DAYS, TREND_NUTRIENTS, weeklyTrends, type Point, type TrendWeek } from '@/domain/trends';
import type { DiaryEntry } from '@/types/diary';
import { NUTRIENT_LABEL } from '@/ui/components/CoverageNote';
import { fmtAmount } from '@/ui/components/NutrientBar';

/**
 * Change over weeks. Facts about what was logged, never a verdict: no score, grade, streak or "better/worse", and no
 * alarm colour. A week without enough logged days (or without complete data for a figure) is left blank and labelled,
 * so a sparse diary can never draw itself as a falling line.
 */

export const TREND_WEEKS = 12;

export type TrendsDeps = {
  now: () => Date;
  store: { entriesBetween: typeof entriesBetween };
};

export const defaultTrendsDeps: TrendsDeps = { now: () => new Date(), store: { entriesBetween } };

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function dayText(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
const rangeText = (w: TrendWeek): string => `${dayText(w.startKey)} – ${dayText(w.endKey)}`;

type Metric = {
  id: string;
  title: string;
  point: (w: TrendWeek) => Point;
  /** The figure in words, for a week that has a value. */
  say: (p: Extract<Point, { status: 'value' }>) => string;
  /** The figure alone, for the week-by-week list. */
  short: (p: Extract<Point, { status: 'value' }>) => string;
  /** Fixed top of the scale, when the quantity has a natural ceiling. */
  ceiling?: number;
  /** What a blank week means for this metric. */
  gap: string;
};

const floorWord = (p: { atLeast?: true }): string => (p.atLeast ? 'at least ' : '');

const nutrientMetric = (key: (typeof TREND_NUTRIENTS)[number]): Metric => {
  const { name, unit } = NUTRIENT_LABEL[key];
  return {
    id: key,
    title: name.charAt(0).toUpperCase() + name.slice(1),
    point: (w) => w.metrics[key],
    say: (p) => `${fmtAmount(p.value)} ${unit} on the median day, over ${plural(p.days ?? 0, 'day', 'days')} with complete data`,
    short: (p) => `${fmtAmount(p.value)} ${unit}`,
    gap: `some foods had no ${name} figure`,
  };
};

const METRICS: Metric[] = [
  {
    id: 'days',
    title: 'Days logged',
    point: (w) => ({ status: 'value', value: w.loggedDays }),
    say: (p) => `${p.value} of 7 days logged`,
    short: (p) => `${p.value} of 7`,
    ceiling: 7,
    gap: '',
  },
  {
    id: 'processedMeat',
    title: 'Processed meat',
    point: (w) => w.processedMeat,
    say: (p) => plural(p.value, 'meal', 'meals'),
    short: (p) => String(p.value),
    gap: '',
  },
  {
    id: 'vegDays',
    title: 'Vegetable days',
    point: (w) => w.vegDays,
    say: (p) => `${floorWord(p)}${plural(p.value, 'day', 'days')} with a vegetable serving`,
    short: (p) => `${floorWord(p)}${p.value}`,
    ceiling: 7,
    gap: '',
  },
  ...TREND_NUTRIENTS.map(nutrientMetric),
];

const SLOT = 24;
const H = 48;

/** Small bars, one per week, from a zero baseline. A blank week is a mark, not a bar: a dot for too few days, a "?" for incomplete data. */
function Bars({ weeks, metric, label }: { weeks: TrendWeek[]; metric: Metric; label: string }) {
  const points = weeks.map((w) => metric.point(w));
  const max = metric.ceiling ?? Math.max(1, ...points.map((p) => (p.status === 'value' ? p.value : 0)));
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${SLOT * weeks.length} ${H + 6}`} className="h-16 w-full">
      <line x1="0" x2={SLOT * weeks.length} y1={H} y2={H} strokeWidth="1" className="stroke-slate-300 dark:stroke-slate-700" />
      {points.map((p, i) => {
        const x = i * SLOT + 4;
        const w = weeks[i]!;
        if (p.status === 'value') {
          const h = Math.max(1.5, (p.value / max) * (H - 4));
          const floor = p.atLeast === true;
          return (
            <rect
              key={w.startKey}
              data-status="value"
              x={x}
              y={H - h}
              width={SLOT - 8}
              height={h}
              rx="1.5"
              className={floor ? 'fill-sky-700/50 dark:fill-sky-400/50' : 'fill-sky-700 dark:fill-sky-400'}
            >
              <title>{`${rangeText(w)}: ${metric.short(p)}`}</title>
            </rect>
          );
        }
        const unknown = p.status === 'unknown';
        return (
          <text
            key={w.startKey}
            data-status={p.status}
            x={i * SLOT + SLOT / 2}
            y={unknown ? H - 14 : H - 6}
            textAnchor="middle"
            fontSize={unknown ? 20 : 14}
            className="fill-slate-600 dark:fill-slate-400"
          >
            {unknown ? '?' : '·'}
            <title>{`${rangeText(w)}: ${unknown ? 'data incomplete' : 'too few days logged'}`}</title>
          </text>
        );
      })}
    </svg>
  );
}

function headline(weeks: TrendWeek[], metric: Metric): string {
  for (let i = weeks.length - 1; i >= 0; i--) {
    const p = metric.point(weeks[i]!);
    if (p.status === 'value') {
      const lead = i === weeks.length - 1 ? 'Last 7 days' : `Latest week with enough data (${rangeText(weeks[i]!)})`;
      return `${lead}: ${metric.say(p)}.`;
    }
  }
  const anyUnknown = weeks.some((w) => metric.point(w).status === 'unknown');
  return anyUnknown
    ? `Not enough complete data to show this yet: days where ${metric.gap} are left out, not counted as zero.`
    : `No week has enough logged days yet (at least ${MIN_LOGGED_DAYS} of 7).`;
}

function MetricCard({ weeks, metric }: { weeks: TrendWeek[]; metric: Metric }) {
  const id = `trend-${metric.id}`;
  const first = rangeText(weeks[0]!);
  const last = rangeText(weeks[weeks.length - 1]!);
  return (
    <section aria-labelledby={id} className="space-y-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3">
      <h2 id={id} className="text-lg font-semibold">{metric.title}</h2>
      <p className="text-sm">{headline(weeks, metric)}</p>
      <Bars weeks={weeks} metric={metric} label={`${metric.title} by week, ${first} to ${last}`} />
      {weeks.some((w) => metric.point(w).status !== 'value') && (
        <p className="text-xs text-slate-600 dark:text-slate-400">
          {weeks.some((w) => metric.point(w).status === 'unknown') && <span className="block">? means we do not know: too much of this figure was missing. It is not a low week.</span>}
          {weeks.some((w) => metric.point(w).status === 'thin') && <span className="block">A dot means too few days were logged that week. It is not a low week.</span>}
        </p>
      )}
      <details className="text-sm">
        <summary className="min-h-12 cursor-pointer py-3">Week by week</summary>
        <ol className="space-y-1 pb-2">
          {weeks
            .map((w) => ({ w, p: metric.point(w) }))
            .reverse()
            .map(({ w, p }) => (
              <li key={w.startKey} className="flex justify-between gap-2 border-b border-slate-200 dark:border-slate-800 py-1">
                <span>{rangeText(w)}</span>
                <span>{p.status === 'value' ? metric.short(p) : p.status === 'unknown' ? 'data incomplete' : 'too few days logged'}</span>
              </li>
            ))}
        </ol>
      </details>
    </section>
  );
}

export default function Trends({ deps = defaultTrendsDeps }: { deps?: TrendsDeps }) {
  const [state, setState] = useState<DiaryEntry[] | 'loading' | 'error'>('loading');
  const todayKey = localDayKey(deps.now());

  useEffect(() => {
    let live = true;
    const keys = lastNDayKeys(deps.now(), TREND_WEEKS * 7);
    deps.store
      .entriesBetween(localDayRange(keys[0]!).fromISO, localDayRange(keys[keys.length - 1]!).toISO)
      .then((rows) => live && setState(rows))
      .catch(() => live && setState('error'));
    return () => {
      live = false;
    };
  }, [deps]);

  // A year of entries is not re-aggregated on every render: only when the rows or the day change.
  const weeks = useMemo(() => (Array.isArray(state) ? weeklyTrends(state, deps.now(), TREND_WEEKS) : []), [state, todayKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state === 'loading') return <main className="mx-auto w-full max-w-xl p-4"><p className="text-sm">Loading&hellip;</p></main>;
  if (state === 'error') {
    return (
      <main className="mx-auto w-full max-w-xl p-4">
        <p role="alert" className="text-sm">The diary could not be read, so nothing is shown here. Nothing has been lost.</p>
      </main>
    );
  }

  const anyLogged = weeks.some((w) => w.loggedDays > 0);
  return (
    <main className="mx-auto min-h-screen w-full max-w-xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Trends</h1>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        {`Week by week over the last ${TREND_WEEKS} weeks, as logged. Each week is seven days, the newest ending today. These are facts about what was logged, not a measure of how you are doing.`}
      </p>
      {!anyLogged ? (
        <p className="text-base">
          {`Nothing logged in the last ${TREND_WEEKS} weeks yet. Trends appear once a week has at least ${MIN_LOGGED_DAYS} logged days.`}
        </p>
      ) : (
        <>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            {`A week with fewer than ${MIN_LOGGED_DAYS} logged days is left blank (a dot), because a thin week says little about the week. A ? marks a week with enough days where too much of a figure was missing to give a number. Neither is a low week, and a blank is never counted as zero. Figures are the median day; a day with any food missing that figure is left out of it.`}
          </p>
          {METRICS.map((m) => <MetricCard key={m.id} weeks={weeks} metric={m} />)}
        </>
      )}
    </main>
  );
}
