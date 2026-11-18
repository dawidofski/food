import { useEffect, useState, type FormEvent } from 'react';
import { entriesBetween, getProfile, putProfile } from '@/data/db';
import { loadReportedEnergy } from '@/data/reportedEnergy';
import { lastNDayKeys, localDayKey, localDayRange } from '@/domain/dayBoundary';
import { BALANCE_WINDOW_DAYS, MIN_COMPLETE_DAYS, energyBalance } from '@/domain/energyBalance';
import { CONVERSION_NOTE, KCAL_PER_KG } from '@/domain/goalConversion';
import { isKnownValue } from '@/domain/nutrients';
import { computeTargets } from '@/domain/targets';
import { dayTotals } from '@/domain/totals';
import { DAILY_FLUCTUATION_KG, PROJECTION_WEEKS, weightProjection } from '@/domain/weightProjection';
import { HOLDING_KG_PER_WEEK, MIN_SPAN_DAYS, MIN_WEIGH_INS, STALE_AFTER_DAYS, weightTrend } from '@/domain/weightTrend';
import type { DiaryEntry } from '@/types/diary';
import type { Profile } from '@/types/profile';
import { fmtAmount } from '@/ui/components/NutrientBar';
import WeightChart from '@/ui/components/WeightChart';

const rate = (n: number): string => `${Math.abs(n).toFixed(2)} kg a week`;
/** A rate with its direction, for anywhere two rates sit side by side. Without this, −0.25 and +0.25 read alike. */
const signedRate = (n: number): string =>
  Math.abs(n) < 0.005 ? 'no change' : `${Math.abs(n).toFixed(2)} kg a week ${n < 0 ? 'down' : 'up'}`;

/** Inside this the two readings are called agreement. This app's own working figure, said on screen. */
const AGREEMENT_KG_PER_WEEK = 0.1;

/** Where the expenditure figure came from, in the words the rest of the app uses. */
const BASIS_WORDS: Record<'formula' | 'reported' | 'observed', string> = {
  formula: 'a resting-energy equation times an activity factor, this app’s own working figure',
  reported: 'your own reported energy burn, averaged over the days you logged one',
  observed: 'what your own weight and logging imply',
};

/**
 * Which way the weight is going, where that leads, and the arithmetic behind it (design §8.5).
 *
 * The one rule that shapes this screen: **the scale has the last word.** The arithmetic is shown in full,
 * including the conversion it uses, and where it disagrees with what the scale says, the page says they
 * disagree and names the two ordinary reasons — rather than quietly picking whichever is more flattering.
 * The projection follows the measured rate, never the implied one.
 */
export default function WeightView() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [reportedKcal, setReportedKcal] = useState<number | undefined>(undefined);
  const [reload, setReload] = useState(0);
  const now = new Date();

  useEffect(() => {
    let live = true;
    void getProfile().then((p) => { if (live) setProfile(p); });
    return () => { live = false; };
  }, [reload]);

  useEffect(() => {
    let live = true;
    const keys = lastNDayKeys(now, BALANCE_WINDOW_DAYS);
    void entriesBetween(localDayRange(keys[0]!).fromISO, localDayRange(keys[keys.length - 1]!).toISO)
      .then((rows) => { if (live) setEntries(rows); })
      .catch(() => undefined);
    void loadReportedEnergy(now).then((r) => { if (live) setReportedKcal(r?.kcal); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  const targets = computeTargets(profile, now, reportedKcal);

  const log = (profile?.weightLog ?? []).filter((w) => Number.isFinite(w.kg));
  const trend = weightTrend(log, now);
  const sorted = [...log].sort((a, b) => (a.date < b.date ? -1 : 1));
  const latest = sorted[sorted.length - 1];

  const days = lastNDayKeys(now, BALANCE_WINDOW_DAYS).map((k) => dayTotals(entries, k));
  // maintenanceKcal, NOT energyKcal: the latter is what to EAT, which a goal moves away from expenditure by up
  // to 1,100 kcal a day. Passing it would print a deficit of zero for someone eating exactly to a 1 kg/week
  // goal, and then blame their logging for the gap against the scale.
  const balance = energyBalance(days, targets.maintenanceKcal, targets.basis.expenditure);
  // A balance needs an expenditure figure that is about THIS person. A general adult's is not, and a resting
  // rate they typed themselves makes the app unable to say where the whole-day figure came from.
  const canStateBalance = !targets.isGeneric && targets.basis.energy !== 'custom';
  const projection = latest ? weightProjection(trend, latest.kg) : [];

  // The biggest single entries by energy over the window. Arithmetic about energy, nothing more.
  const contributors = entries
    .filter((e) => e.state === 'active' && e.userAction !== 'cancelled' && isKnownValue(e.nutrients.energyKcal))
    .sort((a, b) => (b.nutrients.energyKcal ?? 0) - (a.nutrients.energyKcal ?? 0))
    .slice(0, 5);

  let heading: string;
  if (trend.kind === 'unknown') {
    heading =
      trend.reason === 'none'
        ? 'No weight logged yet, so there is nothing to show a direction from.'
        : trend.reason === 'too-few'
          ? `${trend.points} of the ${MIN_WEIGH_INS} weigh-ins needed. Weigh yourself a few more times and this will say which way you are going. Three is this app’s own working minimum, not a published one.`
          : trend.reason === 'stale'
            ? `Your last weigh-in was ${trend.daysSinceLast} days ago. The app will not describe that as how things are going now; weigh yourself again and it will pick the trend back up. ${STALE_AFTER_DAYS} days is this app’s own working limit.`
            : `${trend.points} weigh-ins, but only ${trend.spanDays} days apart. Over less than ${MIN_SPAN_DAYS} days the figure would be water and the time of day rather than fat, so the app says nothing yet. A fortnight is this app’s own working minimum.`;
  } else if (trend.kind === 'holding') {
    heading = `Holding steady — within ${HOLDING_KG_PER_WEEK} kg a week either way, which is this app’s own working idea of steady — over the last ${trend.spanDays} days.`;
  } else {
    heading = `${trend.kind === 'losing' ? 'Losing' : 'Gaining'} about ${rate(trend.kgPerWeek)}, measured over the last ${trend.spanDays} days.`;
  }

  const disagreement =
    trend.kind !== 'unknown' && balance.kind === 'known'
      ? Math.abs(balance.impliedKgPerWeek - trend.kgPerWeek)
      : null;

  return (
    <main className="mx-auto min-h-screen w-full max-w-xl space-y-6 p-4">
      <h1 className="text-xl font-semibold">Weight</h1>

      <section aria-labelledby="dir-h" className="space-y-2">
        <h2 id="dir-h" className="sr-only">Which way it is going</h2>
        <p className="text-base" data-testid="weight-direction">{heading}</p>
        {latest && (
          <WeightChart
            log={log}
            projection={projection}
            label={
              trend.kind === 'unknown'
                ? `Your ${log.length} logged weights. Not enough to show a direction yet.`
                : `Your logged weights over ${trend.spanDays} days, ${trend.kind} about ${rate(trend.kgPerWeek)}, with an estimate of the next ${PROJECTION_WEEKS} weeks at that rate.`
            }
          />
        )}
        {projection.length > 0 && (
          <p className="text-xs text-slate-600 dark:text-slate-400">
            The estimate assumes today&rsquo;s eating carries on unchanged. Its band starts at {DAILY_FLUCTUATION_KG} kg,
            this app&rsquo;s own working figure for ordinary day-to-day variation, and widens with how much your own
            weigh-ins scatter.
          </p>
        )}
      </section>

      <section aria-labelledby="why-h" className="space-y-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3">
        <h2 id="why-h" className="text-lg font-semibold">Why</h2>
        {!canStateBalance ? (
          <p className="text-sm" data-testid="balance-unavailable">
            {targets.isGeneric
              ? 'Your profile is not set up, so the only energy-out figure available is a general adult’s. Working a balance from a stranger’s body would be worse than saying nothing.'
              : 'You set your own resting-energy figure, so the app cannot say where your whole-day energy out came from, and will not put a number on the balance it cannot source.'}
          </p>
        ) : balance.kind === 'patchy' ? (
          <p className="text-sm" data-testid="balance-patchy">
            {balance.completeDays} of the last {BALANCE_WINDOW_DAYS} days have a full record, and this needs at
            least {MIN_COMPLETE_DAYS}. Rather than average over days it cannot see, the app says nothing about
            your intake yet.
          </p>
        ) : (
          <div className="space-y-1 text-sm" data-testid="balance-known">
            <p>{`You ate about ${fmtAmount(balance.intakeKcal)} kcal a day, over the ${balance.completeDays} of the last ${BALANCE_WINDOW_DAYS} days with a full record.`}</p>
            <p>{`Your energy out is about ${fmtAmount(balance.expenditureKcal)} kcal a day, from ${BASIS_WORDS[balance.basis]}.`}</p>
            <p>{`That leaves ${balance.balanceKcal < 0 ? 'a deficit' : 'a surplus'} of about ${fmtAmount(Math.abs(balance.balanceKcal))} kcal a day.`}</p>
            <p className="font-semibold">{`At ${fmtAmount(KCAL_PER_KG)} kcal per kg, that works out at about ${rate(balance.impliedKgPerWeek)} ${balance.impliedKgPerWeek < 0 ? 'lost' : 'gained'}.`}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400">{CONVERSION_NOTE}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {`Averaged over the last ${BALANCE_WINDOW_DAYS} days, needing at least ${MIN_COMPLETE_DAYS} of them fully logged. Both are this app’s own working figures, not published ones.`}
            </p>
            {trend.kind === 'unknown' && (
              <p className="text-xs text-slate-600 dark:text-slate-400" data-testid="implied-alone">
                The scale has not said anything yet, so this is arithmetic on its own. Once there are enough
                weigh-ins, what the scale says is what counts.
              </p>
            )}
          </div>
        )}

        {disagreement !== null && balance.kind === 'known' && trend.kind !== 'unknown' && (
          <p className="text-sm" data-testid="disagreement">
            {disagreement < AGREEMENT_KG_PER_WEEK && Math.sign(trend.kgPerWeek) === Math.sign(balance.impliedKgPerWeek)
              ? `The scale agrees: it says ${signedRate(trend.kgPerWeek)}.`
              : `The scale says ${signedRate(trend.kgPerWeek)}, and the arithmetic above says ${signedRate(balance.impliedKgPerWeek)}. They disagree, which usually means the logging is incomplete, or the energy-out figure is too high, or both. The estimate above follows the scale, because the scale is a measurement and the arithmetic is not.`}
          </p>
        )}
      </section>

      {contributors.length > 0 && (
        <section aria-labelledby="contrib-h" className="space-y-1">
          <h2 id="contrib-h" className="text-lg font-semibold">What carried the most energy</h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Arithmetic about energy over the last {BALANCE_WINDOW_DAYS} days, and nothing more: no entry here is
            said to have caused a change in your weight.
          </p>
          <ul className="text-sm">
            {contributors.map((e) => (
              <li key={e.id} className="flex justify-between border-b border-slate-200 dark:border-slate-800 py-1">
                <span>{e.rawText}</span>
                <span>{`${fmtAmount(e.nutrients.energyKcal ?? 0)} kcal`}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="log-h" className="space-y-1">
        <h2 id="log-h" className="text-lg font-semibold">What you weighed</h2>
        {sorted.length === 0 ? (
          <p className="text-sm">Nothing logged yet.</p>
        ) : (
          <ul className="text-sm" data-testid="weight-log">
            {[...sorted].reverse().slice(0, 12).map((w) => (
              <li key={w.date} className="flex justify-between border-b border-slate-200 dark:border-slate-800 py-1">
                <span>{w.date}</span>
                <span>{`${w.kg.toFixed(1)} kg`}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <WeightForm
        profile={profile}
        today={localDayKey(now)}
        onSaved={() => setReload((n) => n + 1)}
      />
    </main>
  );
}

/** The entry form, moved here from the missing screen unchanged in behaviour. */
function WeightForm({ profile, today, onSaved }: { profile: Profile | null; today: string; onSaved: () => void }) {
  const [value, setValue] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // A Spanish-locale keyboard types "79,4". Refusing it with "enter a number" would be false: it is a
    // number, in the notation the owner's phone offers him.
    const kg = Number(value.trim().replace(',', '.'));
    if (!Number.isFinite(kg) || kg < 20 || kg > 400) {
      setNote('Enter a number of kilograms between 20 and 400.');
      return;
    }
    if (!profile) return;
    setNote(null);
    const rounded = Math.round(kg * 10) / 10;
    const weightLog = [...profile.weightLog.filter((w) => w.date !== today), { date: today, kg: rounded }];
    void putProfile({ ...profile, weightLog })
      .then(() => { setValue(''); onSaved(); })
      .catch(() => setNote('That could not be saved.'));
  };

  if (profile === null) return <p className="text-sm">Set up your profile to keep a weight log.</p>;

  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor="weight-kg" className="block text-sm">{`Weight for ${today} (kg)`}</label>
      <div className="flex items-end gap-2">
        <input
          id="weight-kg"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-h-12 flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3"
        />
        <button type="submit" className="min-h-12 rounded-lg border border-slate-900 dark:border-slate-100 px-4 text-sm font-semibold">
          Save weight
        </button>
      </div>
      {note && <p role="alert" className="text-sm">{note}</p>}
    </form>
  );
}
