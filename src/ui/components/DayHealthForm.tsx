import { useEffect, useState, type FormEvent } from 'react';
import { getHealthDay, putHealthDay } from '@/data/db';
import { computeTargets } from '@/domain/targets';
import type { HealthDay } from '@/types/health';
import type { Profile } from '@/types/profile';
import { figureText, readNamedFigure, type FigureRead } from '@/ui/components/figureForm';

/**
 * The app's own choice and not a published figure: a whole-day burn above this is far above a usual day and more likely a slip (an extra digit). It only asks for a
 * second look; it never refuses.
 */
export const BURN_IMPLAUSIBLY_HIGH_KCAL = 10000;

const field = 'min-h-12 w-full rounded-lg border-2 border-slate-400 dark:border-slate-500 bg-white dark:bg-slate-950 px-3 text-base';
const btn = 'min-h-12 rounded-lg border-2 border-slate-900 dark:border-slate-100 px-4 text-base font-medium';
const note = 'mt-1 text-sm text-slate-700 dark:text-slate-300';
const flagBox = 'mt-2 rounded-lg border-2 border-amber-700 dark:border-amber-400 bg-amber-50 dark:bg-amber-950 p-2 text-sm text-amber-950 dark:text-amber-200';

type Flag = { kind: 'low' | 'high'; value: number };
type FigureKey = 'sleepScore' | 'steps' | 'energyBurnedKcal';

/** The resting rate to compare a burn figure against, or undefined when there is no usable profile to derive one from. */
function restingRate(profile: Profile | null, now: Date): number | undefined {
  if (profile === null) return undefined;
  const t = computeTargets(profile, now);
  return !t.isGeneric && Number.isFinite(t.rmrKcal) && t.rmrKcal > 0 ? t.rmrKcal : undefined;
}

/** Sleep score, steps and energy burned for one local day, typed in from Samsung Health. Reloads when the day changes. */
export default function DayHealthForm({ dayKey, profile, now = new Date() }: { dayKey: string; profile: Profile | null; now?: Date }) {
  const [loaded, setLoaded] = useState<{ day: HealthDay | undefined; key: string } | null>(null);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    let live = true;
    setLoadError(false);
    getHealthDay(dayKey).then(
      (day) => { if (live) setLoaded({ day, key: dayKey }); },
      () => { if (live) setLoadError(true); },
    );
    return () => { live = false; };
  }, [dayKey]);

  if (loadError) return <p role="alert" className="text-sm text-slate-900 dark:text-slate-100">This day’s figures could not be read. Nothing has been lost.</p>;
  if (loaded === null || loaded.key !== dayKey) return null;
  return <Fields key={dayKey} dayKey={dayKey} initial={loaded.day} profile={profile} now={now} />;
}

function Fields({ dayKey, initial, profile, now }: { dayKey: string; initial: HealthDay | undefined; profile: Profile | null; now: Date }) {
  const [held, setHeld] = useState<HealthDay | undefined>(initial);
  const [sleep, setSleep] = useState(figureText(initial?.sleepScore));
  const [steps, setSteps] = useState(figureText(initial?.steps));
  const [burn, setBurn] = useState(figureText(initial?.energyBurnedKcal));
  const [error, setError] = useState<string | null>(null);
  const [flag, setFlag] = useState<Flag | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const rmr = restingRate(profile, now);

  const edit = (set: (v: string) => void) => (v: string) => { set(v); setFlag(null); setStatus(null); setError(null); };

  const run = (form: HTMLFormElement, confirmed: boolean) => {
    // Read from the DOM now, never cached: a flag mirrored into state goes stale when the DOM changes without a React event.
    const bad = (id: string) => (form.elements.namedItem(id) as HTMLInputElement | null)?.validity.badInput ?? false;
    const reads: Array<[FigureKey, FigureRead]> = [
      ['sleepScore', readNamedFigure('Sleep score', sleep, figureText(held?.sleepScore), bad('dh-sleep'))],
      ['steps', readNamedFigure('Steps', steps, figureText(held?.steps), bad('dh-steps'))],
      ['energyBurnedKcal', readNamedFigure('Energy burned', burn, figureText(held?.energyBurnedKcal), bad('dh-burn'))],
    ];
    for (const [, r] of reads) if (r.kind === 'refused') { setError(r.message); return; }
    const [, sleepRead] = reads[0]!;
    if (sleepRead.kind === 'set' && sleepRead.value > 100) {
      setError('Sleep score needs a number between 0 and 100. Nothing has been changed.');
      return;
    }
    const [, burnRead] = reads[2]!;
    if (!confirmed && burnRead.kind === 'set') {
      if (rmr !== undefined && burnRead.value < rmr) { setError(null); setFlag({ kind: 'low', value: burnRead.value }); return; }
      if (burnRead.value > BURN_IMPLAUSIBLY_HIGH_KCAL) { setError(null); setFlag({ kind: 'high', value: burnRead.value }); return; }
    }
    const next: HealthDay = { date: dayKey };
    for (const [k, r] of reads) {
      const was = held?.[k];
      if (r.kind === 'set') next[k] = r.value;
      else if (r.kind === 'unchanged' && was !== undefined) next[k] = was;
      // 'clear', or unchanged and unknown: left absent
    }
    setError(null);
    setFlag(null);
    putHealthDay(next).then(
      () => {
        const stored = next.sleepScore !== undefined || next.steps !== undefined || next.energyBurnedKcal !== undefined ? next : undefined;
        setHeld(stored);
        setSleep(figureText(stored?.sleepScore));
        setSteps(figureText(stored?.steps));
        setBurn(figureText(stored?.energyBurnedKcal));
        setStatus('Saved.');
      },
      () => setError('This day’s figures could not be saved. Nothing has been changed.'),
    );
  };

  return (
    <section className="rounded-xl border border-slate-300 dark:border-slate-700 p-3">
      <h2 className="text-base font-semibold">Sleep, steps and energy burned</h2>
      <p className={note}>You entered these figures yourself; they are your own readings. Leave a field blank if you do not know it; blank is not zero.</p>
      <form onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); run(e.currentTarget, false); }} className="mt-3 space-y-4" noValidate>
        <div>
          <label htmlFor="dh-sleep" className="block text-sm font-medium">Sleep score (0–100), Samsung Health’s own score</label>
          <input id="dh-sleep" name="dh-sleep" type="number" inputMode="decimal" step="any" value={sleep} onChange={(ev) => edit(setSleep)(ev.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="dh-steps" className="block text-sm font-medium">Steps</label>
          <input id="dh-steps" name="dh-steps" type="number" inputMode="numeric" step="any" value={steps} onChange={(ev) => edit(setSteps)(ev.target.value)} className={field} aria-describedby="dh-steps-note" />
          <p id="dh-steps-note" data-testid="steps-note" className={note}>
            Steps are recorded as context and are not added to any calculation, because a whole-day energy burned figure already includes them.
          </p>
        </div>
        <div>
          <label htmlFor="dh-burn" className="block text-sm font-medium">Energy burned (kcal), the whole day, not active calories</label>
          <input id="dh-burn" name="dh-burn" type="number" inputMode="decimal" step="any" value={burn} onChange={(ev) => edit(setBurn)(ev.target.value)} className={field} aria-describedby={flag ? 'dh-burn-note dh-burn-flag' : 'dh-burn-note'} />
          <p id="dh-burn-note" data-testid="burn-note" className={note}>
            {`Copy the total energy burned for the day, not the active figure. They differ by roughly a resting metabolism.${rmr !== undefined ? ` Typing the active one would put the figure about ${rmr} kcal too low.` : ""}`}
          </p>
          {flag?.kind === 'low' && rmr !== undefined && (
            <p id="dh-burn-flag" data-testid="burn-below-resting" className={flagBox}>
              {`${flag.value} kcal is below your resting rate of about ${rmr} kcal, which a whole day does not normally come in under. This looks like the active-energy figure rather than the whole day's. Your resting rate is only an estimate, so a real day can come in under it; if this figure is right, keep it.`}
            </p>
          )}
          {flag?.kind === 'high' && (
            <p id="dh-burn-flag" data-testid="burn-implausibly-high" className={flagBox}>
              {`${flag.value} kcal is more than ${BURN_IMPLAUSIBLY_HIGH_KCAL} kcal for one day, which is far above a usual day. Check for an extra digit. If it is right, keep it.`}
            </p>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-red-800 dark:text-red-300">{error}</p>}
        {status && <p role="status" className="text-sm text-slate-700 dark:text-slate-300">{status}</p>}
        {flag ? (
          <div className="flex gap-2">
            <button type="button" className={`${btn} flex-1 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900`} onClick={(ev) => run(ev.currentTarget.form!, true)}>
              {`Keep ${flag.value} kcal`}
            </button>
            <button type="button" className={`${btn} flex-1`} onClick={() => setFlag(null)}>Change it</button>
          </div>
        ) : (
          <button type="submit" className={`${btn} w-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900`}>Save this day’s figures</button>
        )}
      </form>
    </section>
  );
}
