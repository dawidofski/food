import { useEffect, useState, type FormEvent } from 'react';
import { entriesBetween, getProfile, putProfile } from '@/data/db';
import { loadReportedEnergy } from '@/data/reportedEnergy';
import type { healthDaysBetween } from '@/data/healthDays';
import { energySourceSentence } from '@/domain/energySource';
import type { ReportedExpenditure } from '@/domain/expenditure';
import { last7DayKeys, localDayKey, localDayRange } from '@/domain/dayBoundary';
import { isKnownValue } from '@/domain/nutrients';
import { MIN_LOGGED_DAYS } from '@/domain/trends';
import { computeTargets, MICRO_KIND } from '@/domain/targets';
import { weekContext, type DayTotals } from '@/domain/totals';
import type { DiaryEntry } from '@/types/diary';
import type { NutrientKey } from '@/types/nutrients';
import type { Profile, Targets } from '@/types/profile';
import { NUTRIENT_LABEL } from '@/ui/components/CoverageNote';
import NutrientBar, { fmtAmount } from '@/ui/components/NutrientBar';

/**
 * The "what's missing" view (design section 11). Opportunities, never failures: every line is a fact about what was
 * logged, with no score, grade, rating or streak, and no alarm styling. It is not a warning surface.
 */

/** A gap across the week is only stated when at least this many of the seven days have entries (defined with the trends, which gate the same way). */
export { MIN_LOGGED_DAYS };

export type MissingDeps = {
  now: () => Date;
  store: {
    entriesBetween: typeof entriesBetween;
    getProfile: () => Promise<Profile | null>;
    putProfile: (p: Profile) => Promise<void>;
    /** Optional: absent means the real store. */
    healthDaysBetween?: typeof healthDaysBetween;
  };
};

export const defaultMissingDeps: MissingDeps = {
  now: () => new Date(),
  store: { entriesBetween, getProfile, putProfile },
};

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

export const MICRO_ORDER: NutrientKey[] = [
  'calciumMg', 'ironMg', 'magnesiumMg', 'zincMg', 'vitaminCMg', 'vitaminDUg', 'vitaminB12Ug', 'folateUg', 'potassiumMg',
];

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

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
function ownTargetsNote(basis: Targets['basis'], isGeneric: boolean): string {
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

function dayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
}

/** A day's figure that may be partial: 'at least' for a floor, 'no data' for unknown, and a dash for a day with no entries. */
function cell(day: DayTotals, key: NutrientKey, unit: string): string {
  if (day.entryCount === 0) return '–';
  const v = day.nutrients[key];
  const cov = day.coverage[key];
  if (!isKnownValue(v) || cov === undefined || cov === 'unknown') return 'no data';
  const complete = cov === 'known' && day.energyCoveredShare[key] >= 0.999;
  return `${complete ? '' : 'at least '}${fmtAmount(v)} ${unit}`;
}

/** Cup-equivalents, the same way: a lower bound unless every entry carried FPED data. */
function cupCell(entryCount: number, cups: number, known: 'known' | 'partial' | 'unknown'): string {
  if (entryCount === 0) return '–';
  if (known === 'unknown') return 'no data';
  return `${known === 'partial' ? 'at least ' : ''}${fmtAmount(cups)} cups`;
}

type FruitDay = { cups: number; coverage: 'known' | 'partial' | 'unknown' };
function fruitByDay(entries: DiaryEntry[], keys: string[]): FruitDay[] {
  return keys.map((k) => {
    const day = entries.filter((e) => localDayKey(e.at) === k);
    let cups = 0;
    let withFped = 0;
    for (const e of day) {
      if (e.fped && isKnownValue(e.fped.fruitCupEq)) {
        cups += e.fped.fruitCupEq;
        withFped++;
      }
    }
    return { cups, coverage: withFped === day.length ? 'known' : withFped === 0 ? 'unknown' : 'partial' };
  });
}

function WeightPanel({
  profile, today, onSave,
}: {
  profile: Profile | null;
  today: string;
  onSave: (kg: number) => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const log = profile ? [...profile.weightLog].filter((w) => Number.isFinite(w.kg)).sort((a, b) => (a.date < b.date ? 1 : -1)) : [];
  const oldestFirst = [...log].reverse();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const kg = Number(value.replace(',', '.'));
    if (!Number.isFinite(kg) || kg < 20 || kg > 400) {
      setNote('Enter a number of kilograms between 20 and 400.');
      return;
    }
    setNote(null);
    void onSave(Math.round(kg * 10) / 10).then(() => setValue('')).catch(() => setNote('That could not be saved.'));
  };

  let trend = null;
  if (oldestFirst.length >= 2) {
    const ks = oldestFirst.map((w) => w.kg);
    const lo = Math.min(...ks);
    const hi = Math.max(...ks);
    const span = hi - lo || 1;
    const pts = oldestFirst
      .map((w, i) => `${(i / (oldestFirst.length - 1)) * 280 + 10},${50 - ((w.kg - lo) / span) * 40}`)
      .join(' ');
    trend = (
      <svg role="img" aria-label="Weight trend over the logged measurements" viewBox="0 0 300 60" className="h-16 w-full">
        <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" className="text-sky-700 dark:text-sky-400" />
      </svg>
    );
  }

  return (
    <section aria-labelledby="weight-h" className="space-y-2">
      <h2 id="weight-h" className="text-lg font-semibold">Weight</h2>
      {profile === null ? (
        <p className="text-sm">Set up your profile to keep a weight log.</p>
      ) : (
        <>
          {trend}
          {log.length === 0 ? (
            <p className="text-sm">No weight logged yet.</p>
          ) : (
            <ul className="text-sm">
              {log.slice(0, 12).map((w) => (
                <li key={w.date} className="flex justify-between border-b border-slate-200 dark:border-slate-800 py-1">
                  <span>{w.date}</span>
                  <span>{`${w.kg.toFixed(1)} kg`}</span>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={submit} className="flex items-end gap-2">
            <div className="flex-1">
              <label htmlFor="weight-kg" className="block text-sm">{`Weight for ${today} (kg)`}</label>
              <input
                id="weight-kg"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="min-h-12 w-full rounded-lg border-2 border-slate-400 dark:border-slate-500 px-3 text-base"
              />
            </div>
            <button type="submit" className="min-h-12 rounded-lg border border-slate-400 dark:border-slate-500 px-4 text-base">Save weight</button>
          </form>
          {note && <p role="status" className="text-sm">{note}</p>}
        </>
      )}
    </section>
  );
}

export default function Missing({ deps = defaultMissingDeps }: { deps?: MissingDeps }) {
  const [state, setState] = useState<{ entries: DiaryEntry[]; profile: Profile | null; reported: ReportedExpenditure | undefined } | 'loading' | 'error'>('loading');
  const [reload, setReload] = useState(0);
  const now = deps.now();
  const keys = last7DayKeys(now);

  useEffect(() => {
    let live = true;
    const k = last7DayKeys(deps.now());
    Promise.all([
      deps.store.entriesBetween(localDayRange(k[0]!).fromISO, localDayRange(k[6]!).toISO),
      deps.store.getProfile().catch(() => null),
      loadReportedEnergy(deps.now(), deps.store.healthDaysBetween),
    ])
      .then(([entries, profile, reported]) => live && setState({ entries, profile, reported }))
      .catch(() => live && setState('error'));
    return () => {
      live = false;
    };
  }, [deps, reload]);

  if (state === 'loading') return <main className="mx-auto w-full max-w-xl p-4"><p className="text-sm">Loading&hellip;</p></main>;
  if (state === 'error') {
    return (
      <main className="mx-auto w-full max-w-xl p-4">
        <p role="alert" className="text-sm">The diary could not be read, so nothing is shown here. Nothing has been lost.</p>
      </main>
    );
  }

  const { entries, profile, reported } = state;
  const week = weekContext(entries, now);
  const today = week.days[6]!;
  const targets = computeTargets(profile, now, reported?.kcal);
  const logged = week.days.filter((d) => d.entryCount > 0);
  const enough = logged.length >= MIN_LOGGED_DAYS;
  const fruit = fruitByDay(entries, keys);

  // An empty day is not a day without vegetables: only days with entries are judged, and only on known data.
  const noveg = logged.filter((d) => d.vegCoverage === 'known' && d.vegCupEq === 0 && !d.hasVegetableFlag).length;
  const vegUnknown = logged.filter((d) => d.vegCoverage !== 'known' && d.vegCupEq === 0 && !d.hasVegetableFlag).length;
  const oilyFishDays = new Set(entries.filter((e) => e.classification?.oilyFish).map((e) => localDayKey(e.at))).size;

  const gaps: { key: NutrientKey; under: number; complete: number; ref: number }[] = [];
  let tooFew = 0;
  for (const key of MICRO_ORDER) {
    const ref = targets.micronutrients[key];
    if (ref === undefined) continue;
    const complete = logged.filter((d) => {
      const v = d.nutrients[key];
      return isKnownValue(v) && d.coverage[key] === 'known' && d.energyCoveredShare[key] >= 0.999;
    });
    if (complete.length < MIN_LOGGED_DAYS) {
      tooFew++;
      continue;
    }
    const under = complete.filter((d) => (d.nutrients[key] as number) < ref).length;
    if (under / complete.length >= 0.8) gaps.push({ key, under, complete: complete.length, ref });
  }

  const saveWeight = async (kg: number) => {
    if (!profile) return;
    const date = localDayKey(now);
    const weightLog = [...profile.weightLog.filter((w) => w.date !== date), { date, kg }];
    await deps.store.putProfile({ ...profile, weightLog });
    setReload((n) => n + 1);
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-xl space-y-6 p-4">
      <h1 className="text-xl font-semibold">What&rsquo;s missing</h1>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        What your diary shows is left out or thin, as facts about what was logged. These are things to add, not things you got wrong.
      </p>

      <section aria-labelledby="today-h" className="space-y-3">
        <h2 id="today-h" className="text-lg font-semibold">Today</h2>
        {today.entryCount === 0 ? (
          <p className="text-base">Nothing logged today yet.</p>
        ) : (
          TODAY_BARS.map(({ key, target, second }) => {
            const secondMark = second?.(targets);
            return (
            <NutrientBar
              key={key}
              nutrient={key}
              value={today.nutrients[key]}
              coverage={today.coverage[key]}
              energyCoveredShare={today.energyCoveredShare[key]}
              target={target(targets)}
              {...(secondMark ? { secondMark } : {})}
            />
            );
          })
        )}
        {targets.isGeneric && <p className="text-xs text-slate-600 dark:text-slate-400">Targets use general adult guidelines until your profile is set up.</p>}
        <p data-testid="energy-source" className="text-xs text-slate-600 dark:text-slate-400">{energySourceSentence(targets.basis, profile?.activityLevel, reported?.days, targets.isGeneric)}</p>
        <p data-testid="own-targets-note" className="text-xs text-slate-600 dark:text-slate-400">
          {ownTargetsNote(targets.basis, targets.isGeneric)} WHO advises at least 25 g
          of fibre a day. Protein comes from two sources: EFSA&rsquo;s reference intake of 0.83 g
          per kg of body weight, and for people who exercise, the International Society of Sports Nutrition&rsquo;s range of 1.4 to 2.0 g
          per kg, within which this app uses the middle, 1.7 g, and the top, 2.0 g, when your goal is to lose weight. The sodium, saturated fat and added sugar limits are WHO&rsquo;s. You can change any
          target in Settings.
        </p>
      </section>

      <section aria-labelledby="week-h" className="space-y-3">
        <h2 id="week-h" className="text-lg font-semibold">This week</h2>
        {!enough ? (
          <p className="text-base">
            {logged.length === 0
              ? 'No days in the last 7 have entries yet, so there is nothing to compare.'
              : `Only ${logged.length} of the last 7 days have entries, which is too few to say what is missing across the week.`}{' '}
            It fills in as you log more days.
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-700 dark:text-slate-300">{`Based on ${logged.length} of the last 7 days that have entries.`}</p>
            <ul className="space-y-1 text-base">
              {noveg > 0 && <li>{`${plural(noveg, 'day', 'days')} without a vegetable serving`}</li>}
              {noveg === 0 && vegUnknown < logged.length && <li>A vegetable serving on every day where the data is complete.</li>}
              {vegUnknown > 0 && (
                <li>
                  {`${plural(vegUnknown, 'day', 'days')} where vegetable data is missing`}
                  <span className="block text-sm text-slate-700 dark:text-slate-300">
                    Some foods carry no vegetable data, so those days are not counted either way.
                  </span>
                </li>
              )}
              <li>{week.processedMeatOccasions > 0 ? `Processed meat in ${plural(week.processedMeatOccasions, 'meal', 'meals')}` : 'No processed meat logged'}</li>
              <li>{oilyFishDays > 0 ? `Oily fish on ${plural(oilyFishDays, 'day', 'days')}` : 'No oily fish logged'}</li>
            </ul>

            <ul aria-label="Day by day" className="space-y-2">
              {week.days.map((d, i) => (
                <li key={d.dayKey} className="rounded-lg border border-slate-300 dark:border-slate-700 p-2 text-sm">
                  <p className="font-semibold">{dayLabel(d.dayKey)}</p>
                  <p>{`Vegetables ${cupCell(d.entryCount, d.vegCupEq, d.vegCoverage)} · Fruit ${cupCell(d.entryCount, fruit[i]?.cups ?? 0, fruit[i]?.coverage ?? 'unknown')}`}</p>
                  <p>{`Fibre ${cell(d, 'fibreG', 'g')} · Protein ${cell(d, 'proteinG', 'g')}`}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {enough && (
        <section aria-labelledby="gaps-h" className="space-y-2">
          <h2 id="gaps-h" className="text-lg font-semibold">Worth a look</h2>
          {gaps.length === 0 ? (
            <p className="text-base">No micronutrient stands out as low on the days with complete data.</p>
          ) : (
            <ul className="space-y-2">
              {gaps.map((g) => {
                const { name, unit } = NUTRIENT_LABEL[g.key];
                return (
                  <li key={g.key} data-testid={`gap-${g.key}`} className="text-base">
                    {`${name.charAt(0).toUpperCase()}${name.slice(1)} was under the ${fmtAmount(g.ref)} ${unit} ${MICRO_KIND[g.key] === 'AI' ? 'adequate intake (a best estimate)' : 'population reference intake'} on ${g.under} of ${g.complete} days with complete ${name} data.`}
                  </li>
                );
              })}
            </ul>
          )}
          {tooFew > 0 && (
            <p className="text-sm text-slate-700 dark:text-slate-300">
              {`For ${plural(tooFew, 'nutrient', 'nutrients')}, too few days had complete data to say anything.`}
            </p>
          )}
          <p className="text-xs text-slate-600 dark:text-slate-400">
            These are EFSA&rsquo;s values for adults, for populations and not a requirement for you personally. A population reference intake covers nearly everyone&rsquo;s needs. An adequate intake (magnesium, potassium, vitamin D and vitamin B12) is a best estimate, set where the evidence could not support a reference intake.
          </p>
        </section>
      )}

      <WeightPanel profile={profile} today={localDayKey(now)} onSave={saveWeight} />
    </main>
  );
}
