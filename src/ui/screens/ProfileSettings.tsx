import { useEffect, useState, type FormEvent } from 'react';
import { getProfile, putProfile } from '@/data/db';
import { localDayKey } from '@/domain/dayBoundary';
import { computeTargets } from '@/domain/targets';
import { unrecognisedAllergenFlags } from '@/rules/catalogue/allergen';
import type { Profile, Targets } from '@/types/profile';
import { BodyDataForm, fieldClass, parseNumber, weightProblem } from './FirstRun';

/**
 * Settings that need a profile: body data, the weight log, flagged allergens, conditions and target
 * overrides. With no profile it offers the same empty setup form as first run, and says that targets
 * are general until it is filled in.
 */

type OverrideKey = 'energyKcal' | 'proteinG' | 'fibreG' | 'sodiumMg' | 'satFatG' | 'addedSugarsG';
const OVERRIDES: { key: OverrideKey; label: string; unit: string }[] = [
  { key: 'energyKcal', label: 'Energy', unit: 'kcal' },
  { key: 'proteinG', label: 'Protein', unit: 'g' },
  { key: 'fibreG', label: 'Fibre', unit: 'g' },
  { key: 'sodiumMg', label: 'Sodium', unit: 'mg' },
  { key: 'satFatG', label: 'Saturated fat', unit: 'g' },
  { key: 'addedSugarsG', label: 'Added sugars', unit: 'g' },
];

const btn = 'min-h-11 rounded-lg border border-slate-400 dark:border-slate-500 px-4';
const section = 'space-y-3 rounded-xl border-2 border-slate-400 dark:border-slate-500 p-3';

export default function ProfileSettings() {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void getProfile().then((p) => {
      if (live) setProfile(p);
    });
    return () => {
      live = false;
    };
  }, []);

  /** Saves a change and only then shows it, so the screen never claims something that was not stored. */
  const save = async (next: Profile): Promise<boolean> => {
    try {
      await putProfile(next);
      setProfile(next);
      setError(null);
      return true;
    } catch (err) {
      setError(`That could not be saved: ${err instanceof Error ? err.message : 'this browser is not allowing local storage'}.`);
      return false;
    }
  };

  if (profile === undefined) return null;

  const base: Profile = profile ?? { weightLog: [], flaggedAllergens: [], conditions: [] };
  const hasBody =
    profile !== null &&
    profile.heightCm !== undefined && profile.dob !== undefined && profile.sex !== undefined && profile.activityLevel !== undefined;

  return (
    <>
      <section aria-labelledby="body-h" className={section}>
        <h2 id="body-h" className="text-lg font-semibold">Body data</h2>
        {!hasBody && (
          <p className="text-sm">
            Optional. It only sharpens your calorie and protein targets. Until it is set up, targets use general adult guidelines.
            The allergen and condition settings below do not need it.
          </p>
        )}
        <BodyDataForm initial={hasBody ? profile : null} base={profile} submitLabel="Save body data" onSaved={setProfile} />
      </section>
      {hasBody && <WeightLog profile={base} save={save} />}
      <FlagList
        profile={base}
        save={save}
        field="flaggedAllergens"
        heading="Allergens I react to"
        addLabel="Add allergen"
        help="Use the ordinary word, such as peanuts, soy, dairy, wheat or shellfish. A word the app does not recognise is not ignored: it is reported on every entry as something that could not be checked. Allergen tags in the food database are indicative and incomplete, so a food with no tag may still contain the allergen."
      />
      <FlagList
        profile={base}
        save={save}
        field="conditions"
        heading="Conditions"
        addLabel="Add condition"
        help="Kept on this device with your profile."
      />
      <Overrides profile={base} save={save} />
      {error && <p role="alert" className="text-sm text-red-800 dark:text-red-300">{error}</p>}
    </>
  );
}

type SaveFn = (p: Profile) => Promise<boolean>;

function WeightLog({ profile, save }: { profile: Profile; save: SaveFn }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newDate, setNewDate] = useState('');
  const [newKg, setNewKg] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const log = [...profile.weightLog].sort((a, b) => (a.date < b.date ? 1 : -1));

  const setKg = async (date: string, raw: string) => {
    const kg = parseNumber(raw);
    const problem = weightProblem(kg);
    if (problem) return setNote(problem);
    const weightLog = [...profile.weightLog.filter((w) => w.date !== date), { date, kg: Math.round(kg * 10) / 10 }];
    if (await save({ ...profile, weightLog })) {
      setNote(null);
      setDrafts((d) => {
        const { [date]: _gone, ...rest } = d;
        return rest;
      });
    }
  };
  const remove = async (date: string) => {
    if (profile.weightLog.length <= 1) return;
    await save({ ...profile, weightLog: profile.weightLog.filter((w) => w.date !== date) });
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate) || newDate > localDayKey(new Date())) return setNote('Enter a date that is not in the future.');
    await setKg(newDate, newKg);
    setNewDate('');
    setNewKg('');
  };

  return (
    <section aria-labelledby="weight-log-h" className={section}>
      <h2 id="weight-log-h" className="text-lg font-semibold">Weight log</h2>
      <p className="text-sm">Your latest weight is the one used for your targets. You can correct or remove any measurement.</p>
      <ul aria-label="Weight history" className="space-y-2">
        {log.map((w) => (
          <li key={w.date} className="flex flex-wrap items-end gap-2">
            <div className="flex-1">
              <label htmlFor={`w-${w.date}`} className="block text-xs text-slate-700 dark:text-slate-300">{`Weight on ${w.date} (kg)`}</label>
              <input
                id={`w-${w.date}`}
                type="number"
                inputMode="decimal"
                value={drafts[w.date] ?? String(w.kg)}
                onChange={(e) => setDrafts((d) => ({ ...d, [w.date]: e.target.value }))}
                className={fieldClass}
              />
            </div>
            <button type="button" aria-label={`Save weight on ${w.date}`} onClick={() => void setKg(w.date, drafts[w.date] ?? String(w.kg))} className={btn}>Save</button>
            <button
              type="button"
              aria-label={`Remove weight on ${w.date}`}
              disabled={profile.weightLog.length <= 1}
              onClick={() => void remove(w.date)}
              className={`${btn} disabled:opacity-50`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {profile.weightLog.length <= 1 && <p className="text-xs text-slate-700 dark:text-slate-300">The only measurement cannot be removed, because targets need a weight.</p>}
      <form onSubmit={(e) => void add(e)} className="flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <label htmlFor="new-w-date" className="block text-xs text-slate-700 dark:text-slate-300">New weight date</label>
          <input id="new-w-date" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className={fieldClass} />
        </div>
        <div className="flex-1">
          <label htmlFor="new-w-kg" className="block text-xs text-slate-700 dark:text-slate-300">New weight (kg)</label>
          <input id="new-w-kg" type="number" inputMode="decimal" value={newKg} onChange={(e) => setNewKg(e.target.value)} className={fieldClass} />
        </div>
        <button type="submit" className={btn}>Add weight</button>
      </form>
      {note && <p role="alert" className="text-sm text-red-800 dark:text-red-300">{note}</p>}
    </section>
  );
}

function FlagList({
  profile, save, field, heading, addLabel, help,
}: {
  profile: Profile;
  save: SaveFn;
  field: 'flaggedAllergens' | 'conditions';
  heading: string;
  addLabel: string;
  help: string;
}) {
  const [draft, setDraft] = useState('');
  const items = profile[field];
  const unknown = field === 'flaggedAllergens' ? new Set(unrecognisedAllergenFlags(items).map((s) => s.toLowerCase())) : new Set<string>();
  const id = `add-${field}`;

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const v = draft.trim();
    if (v === '' || items.some((x) => x.toLowerCase() === v.toLowerCase())) {
      setDraft('');
      return;
    }
    if (await save({ ...profile, [field]: [...items, v] })) setDraft('');
  };

  return (
    <section aria-labelledby={`${id}-h`} className={section}>
      <h2 id={`${id}-h`} className="text-lg font-semibold">{heading}</h2>
      <p className="text-sm">{help}</p>
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-base">{it}</span>
                <button type="button" aria-label={`Remove ${field === 'flaggedAllergens' ? 'allergen' : 'condition'} ${it}`} onClick={() => void save({ ...profile, [field]: items.filter((x) => x !== it) })} className={btn}>
                  Remove
                </button>
              </div>
              {unknown.has(it.toLowerCase()) && (
                <p className="text-sm text-amber-900 dark:text-amber-300">
                  {`The app has no tags for “${it}”, so foods are not checked against it. Each entry you log will say it could not check this, so read labels yourself.`}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(e) => void add(e)} className="space-y-2">
        <label htmlFor={id} className="block text-sm font-medium">{addLabel}</label>
        <input id={id} type="text" value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="off" className={fieldClass} />
        <button type="submit" className={btn}>{addLabel}</button>
      </form>
    </section>
  );
}

function Overrides({ profile, save }: { profile: Profile; save: SaveFn }) {
  const calculated = computeTargets({ ...profile, overrides: undefined }, new Date());
  const [vals, setVals] = useState<Record<OverrideKey, string>>(() => {
    const o = profile.overrides ?? {};
    return Object.fromEntries(OVERRIDES.map(({ key }) => [key, o[key] !== undefined ? String(o[key]) : ''])) as Record<OverrideKey, string>;
  });
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Partial<Targets> = { ...(profile.overrides ?? {}) };
    for (const { key, label } of OVERRIDES) {
      const raw = vals[key].trim();
      if (raw === '') {
        delete next[key];
        continue;
      }
      const n = parseNumber(raw);
      if (!Number.isFinite(n) || n <= 0) return setError(`${label} override must be a number above zero, or left empty to use the calculated figure.`);
      next[key] = n;
    }
    const { overrides: _old, ...rest } = profile;
    const ok = await save(Object.keys(next).length > 0 ? { ...rest, overrides: next } : rest);
    if (ok) setError(null);
  };

  return (
    <section aria-labelledby="overrides-h" className={section}>
      <h2 id="overrides-h" className="text-lg font-semibold">Target overrides</h2>
      <p className="text-sm">
        Targets are calculated from your body data{calculated.isGeneric ? ' (currently general adult guidelines, as the data is incomplete)' : ''}. Set a figure only if you have a reason to use a different one;
        leave a field empty to use the calculated figure.
      </p>
      <form onSubmit={(e) => void submit(e)} className="space-y-2">
        {OVERRIDES.map(({ key, label, unit }) => (
          <div key={key}>
            <label htmlFor={`ov-${key}`} className="block text-sm font-medium">{`${label} override (${unit})`}</label>
            <input
              id={`ov-${key}`}
              type="number"
              inputMode="decimal"
              value={vals[key]}
              placeholder={`Calculated: ${calculated[key]}`}
              onChange={(e) => setVals((v) => ({ ...v, [key]: e.target.value }))}
              className={fieldClass}
            />
          </div>
        ))}
        {error && <p role="alert" className="text-sm text-red-800 dark:text-red-300">{error}</p>}
        <button type="submit" className="min-h-12 rounded-lg bg-slate-900 dark:bg-slate-100 px-4 text-white dark:text-slate-900">Save overrides</button>
      </form>
    </section>
  );
}
