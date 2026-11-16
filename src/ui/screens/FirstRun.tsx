import { useState, type FormEvent } from 'react';
import { putProfile } from '@/data/db';
import { localDayKey } from '@/domain/dayBoundary';
import type { ActivityLevel, Profile, Sex } from '@/types/profile';

/**
 * First-run setup. Nothing is prefilled: height, date of birth, sex, activity level and weight are all
 * asked for, and none of them is ever part of the source code. They are stored on this device only.
 * The app works without them (general adult targets), so this screen can be skipped.
 */

const SEXES: { value: Sex; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'unspecified', label: 'Prefer not to say (uses an average)' },
];
const ACTIVITY: { value: ActivityLevel; label: string }[] = [
  { value: 'sedentary', label: 'Sedentary: little or no exercise' },
  { value: 'light', label: 'Light: exercise 1 to 3 days a week' },
  { value: 'moderate', label: 'Moderate: exercise 3 to 5 days a week' },
  { value: 'active', label: 'Active: hard exercise 6 to 7 days a week' },
  { value: 'veryActive', label: 'Very active: hard exercise and a physical job' },
];

export const parseNumber = (s: string): number => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));

/** Returns an error message, or null when the value is a plausible adult weight in kilograms. */
export function weightProblem(kg: number): string | null {
  return Number.isFinite(kg) && kg >= 20 && kg <= 400 ? null : 'Enter a weight in kilograms between 20 and 400.';
}

export const fieldClass = 'min-h-12 w-full rounded-lg border-2 border-slate-400 dark:border-slate-500 bg-white dark:bg-slate-950 px-3 text-base';

export function BodyDataForm({
  initial, base, onSaved, submitLabel,
}: {
  /** The existing profile when editing; null on first run, where every field starts empty. */
  initial: Profile | null;
  /** A profile that has no body data yet (it may hold allergens): its other fields are kept when this form saves. */
  base?: Profile | null;
  onSaved: (p: Profile) => void;
  submitLabel: string;
}) {
  const [height, setHeight] = useState(initial ? String(initial.heightCm) : '');
  const [dob, setDob] = useState(initial?.dob ?? '');
  const [sex, setSex] = useState<string>(initial?.sex ?? '');
  const [activity, setActivity] = useState<string>(initial?.activityLevel ?? '');
  const [weight, setWeight] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const h = parseNumber(height);
    const w = parseNumber(weight);
    const born = /^\d{4}-\d{2}-\d{2}$/.test(dob) ? new Date(`${dob}T12:00:00`) : null;
    const today = localDayKey(new Date());
    if (!Number.isFinite(h) || h < 100 || h > 250) return setError('Enter your height in centimetres, between 100 and 250.');
    if (!born || !Number.isFinite(born.getTime()) || dob > today || dob < '1900-01-01') {
      return setError('Enter your date of birth as a real date in the past.');
    }
    if (!SEXES.some((s) => s.value === sex)) return setError('Choose an option for sex.');
    if (!ACTIVITY.some((a) => a.value === activity)) return setError('Choose your activity level.');
    if (!initial) {
      const problem = weightProblem(w);
      if (problem) return setError(problem);
    }
    const next: Profile = initial
      ? { ...initial, heightCm: h, dob, sex: sex as Sex, activityLevel: activity as ActivityLevel }
      : {
          ...(base ?? { flaggedAllergens: [], conditions: [] }),
          heightCm: h, dob, sex: sex as Sex, activityLevel: activity as ActivityLevel,
          weightLog: [...(base?.weightLog ?? []).filter((x) => x.date !== today), { date: today, kg: Math.round(w * 10) / 10 }],
        };
    setSaving(true);
    try {
      await putProfile(next);
      setError(null);
      onSaved(next);
    } catch (err) {
      setError(`That could not be saved: ${err instanceof Error ? err.message : 'this browser is not allowing local storage'}.`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3" noValidate>
      <div>
        <label htmlFor="bd-height" className="block text-sm font-medium">Height (cm)</label>
        <input id="bd-height" type="number" inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} className={fieldClass} />
      </div>
      <div>
        <label htmlFor="bd-dob" className="block text-sm font-medium">Date of birth</label>
        <input id="bd-dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} className={fieldClass} />
      </div>
      <div>
        <label htmlFor="bd-sex" className="block text-sm font-medium">Sex</label>
        <select id="bd-sex" value={sex} onChange={(e) => setSex(e.target.value)} className={fieldClass}>
          <option value="">Choose&hellip;</option>
          {SEXES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="bd-activity" className="block text-sm font-medium">Activity level</label>
        <select id="bd-activity" value={activity} onChange={(e) => setActivity(e.target.value)} className={fieldClass}>
          <option value="">Choose&hellip;</option>
          {ACTIVITY.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
      </div>
      {!initial && (
        <div>
          <label htmlFor="bd-weight" className="block text-sm font-medium">Weight (kg)</label>
          <input id="bd-weight" type="number" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} className={fieldClass} />
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-800 dark:text-red-300">{error}</p>}
      <button type="submit" disabled={saving} className="min-h-12 w-full rounded-lg bg-slate-900 dark:bg-slate-100 px-4 text-white dark:text-slate-900 disabled:opacity-50">{submitLabel}</button>
    </form>
  );
}

export default function FirstRun({ onDone, onSkip }: { onDone?: (p: Profile) => void; onSkip?: () => void }) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Set up your targets</h1>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        Your height, date of birth, sex, activity level and weight are used to work out daily targets for you. They are stored on this
        device only and are never sent anywhere.
      </p>
      <BodyDataForm initial={null} submitLabel="Save and continue" onSaved={(p) => onDone?.(p)} />
      <div className="space-y-1 border-t border-slate-300 dark:border-slate-700 pt-3">
        <p className="text-sm text-slate-700 dark:text-slate-300">
          You can use the app without this. Until your profile is set up, targets use general adult guidelines, and the app says so wherever they matter.
        </p>
        <button type="button" onClick={() => onSkip?.()} className="min-h-12 w-full rounded-lg border border-slate-400 dark:border-slate-500 px-4">
          Skip for now
        </button>
      </div>
    </main>
  );
}
