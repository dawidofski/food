import { useEffect, useState, type FormEvent } from 'react';
import { getProfile, putProfile } from '@/data/db';
import { localDayKey } from '@/domain/dayBoundary';
import {
  CONVERSION_NOTE, dailyKcalForRate, dailyToRatePhrase, formatRate, offsetWord, rateForDailyKcal, rateToDailyPhrase,
} from '@/domain/goalConversion';
import { computeTargets, MAX_GOAL_RATE_KG_PER_WEEK } from '@/domain/targets';
import { unrecognisedAllergenFlags } from '@/rules/catalogue/allergen';
import type { Goal, Profile, Targets } from '@/types/profile';
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
      <GoalSection profile={base} hasBody={hasBody} save={save} />
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

type GoalChoice = 'none' | Goal['kind'];
const GOAL_CHOICES: { value: GoalChoice; label: string; hint: string }[] = [
  { value: 'none', label: 'No goal', hint: 'Nothing stated. Targets stay at maintenance.' },
  { value: 'lose', label: 'Lose', hint: 'Raises the protein target if you exercise, and sets a deficit if you give a rate.' },
  { value: 'hold', label: 'Hold', hint: 'Keeps energy at maintenance.' },
  { value: 'gain', label: 'Gain', hint: 'Sets a surplus if you give a rate.' },
];

const BODY_FAT_MIN = 3;
const BODY_FAT_MAX = 60;

function GoalSection({ profile, hasBody, save }: { profile: Profile; hasBody: boolean; save: SaveFn }) {
  const g = profile.goal;
  const [kind, setKind] = useState<GoalChoice>(g?.kind ?? 'none');
  const [rateNum, setRateNum] = useState<number | undefined>(g?.rateKgPerWeek);
  const [rateText, setRateText] = useState(g?.rateKgPerWeek !== undefined ? formatRate(g.rateKgPerWeek) : '');
  const [kcalText, setKcalText] = useState(g?.rateKgPerWeek !== undefined ? String(dailyKcalForRate(g.rateKgPerWeek)) : '');
  const [bfText, setBfText] = useState(profile.bodyFatPct !== undefined ? String(profile.bodyFatPct) : '');
  const [error, setError] = useState<string | null>(null);

  if (!hasBody) {
    return (
      <section aria-labelledby="goal-h" className={section}>
        <h2 id="goal-h" className="text-lg font-semibold">Your goal</h2>
        <p className="text-sm">A weight goal needs your body data, because a deficit worked out for someone the app knows nothing about would mean nothing. Fill in body data above first.</p>
      </section>
    );
  }

  const offsetKind = kind === 'lose' || kind === 'gain' ? kind : undefined;
  const word = offsetKind ? offsetWord(offsetKind) : 'deficit';

  const onRate = (raw: string) => {
    setRateText(raw);
    if (raw.trim() === '') {
      setRateNum(undefined);
      setKcalText('');
      return;
    }
    const n = parseNumber(raw);
    setRateNum(n);
    setKcalText(Number.isFinite(n) && n > 0 ? String(dailyKcalForRate(n)) : '');
  };
  const onKcal = (raw: string) => {
    setKcalText(raw);
    if (raw.trim() === '') {
      setRateNum(undefined);
      setRateText('');
      return;
    }
    const n = parseNumber(raw);
    const rate = Number.isFinite(n) && n > 0 ? rateForDailyKcal(n) : NaN;
    setRateNum(rate);
    setRateText(Number.isFinite(rate) ? formatRate(rate) : '');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    let bodyFatPct: number | undefined;
    if (bfText.trim() !== '') {
      bodyFatPct = parseNumber(bfText);
      if (!Number.isFinite(bodyFatPct) || bodyFatPct < BODY_FAT_MIN || bodyFatPct > BODY_FAT_MAX) {
        return setError(`Body fat must be between ${BODY_FAT_MIN} and ${BODY_FAT_MAX} %, or left blank if you do not know it.`);
      }
    }
    let goal: Goal | undefined;
    if (kind === 'hold') goal = { kind: 'hold' };
    else if (kind === 'lose' || kind === 'gain') {
      if (rateNum !== undefined && !(Number.isFinite(rateNum) && rateNum > 0)) return setError('The rate must be a number above zero, or left blank.');
      goal = rateNum === undefined ? { kind } : { kind, rateKgPerWeek: rateNum };
    }
    const { goal: _g, bodyFatPct: _b, ...rest } = profile;
    const ok = await save({ ...rest, ...(goal ? { goal } : {}), ...(bodyFatPct !== undefined ? { bodyFatPct } : {}) });
    if (ok) setError(null);
  };

  const hint = 'text-xs text-slate-700 dark:text-slate-300';

  return (
    <section aria-labelledby="goal-h" className={section}>
      <h2 id="goal-h" className="text-lg font-semibold">Your goal</h2>
      <form onSubmit={(e) => void submit(e)} className="space-y-3">
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">What are you aiming for?</legend>
          {GOAL_CHOICES.map((c) => (
            <label key={c.value} className="flex min-h-11 items-start gap-3 py-2">
              <input type="radio" name="goal-kind" value={c.value} checked={kind === c.value} onChange={() => setKind(c.value)} className="mt-1 h-5 w-5" />
              <span>
                <span className="block text-base">{c.label}</span>
                <span className={`block ${hint}`}>{c.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {offsetKind && (
          <div className="space-y-2">
            <p className="text-sm">A rate is optional. Without one, the app does not invent a {word} for you.</p>
            <div>
              <label htmlFor="goal-rate" className="block text-sm font-medium">Rate (kg a week)</label>
              <input id="goal-rate" type="number" inputMode="decimal" step="any" value={rateText} onChange={(e) => onRate(e.target.value)} className={fieldClass} />
            </div>
            <div>
              <label htmlFor="goal-kcal" className="block text-sm font-medium">{`Daily ${word} (kcal)`}</label>
              <input id="goal-kcal" type="number" inputMode="decimal" step="any" value={kcalText} onChange={(e) => onKcal(e.target.value)} className={fieldClass} />
            </div>
            {rateNum !== undefined && Number.isFinite(rateNum) && rateNum > 0 && (
              <>
                <p className="text-sm">{rateToDailyPhrase(offsetKind, rateNum)}</p>
                <p className="text-sm">{dailyToRatePhrase(offsetKind, dailyKcalForRate(rateNum))}</p>
              </>
            )}
            <p className={hint}>
              {CONVERSION_NOTE} {`The app's own maximum is ${MAX_GOAL_RATE_KG_PER_WEEK} kg a week; that is its own choice, not a published figure.`}
            </p>
          </div>
        )}

        <div>
          <label htmlFor="goal-bf" className="block text-sm font-medium">Body fat (%, optional)</label>
          <input id="goal-bf" type="number" inputMode="decimal" step="any" value={bfText} onChange={(e) => setBfText(e.target.value)} className={fieldClass} />
          <p className={hint}>
            {`Leave it blank if you do not know it: blank means unknown, not 0 %. A figure from ${BODY_FAT_MIN} to ${BODY_FAT_MAX} % lets the app estimate your resting energy from lean mass; otherwise it uses your height, weight, age and sex.`}
          </p>
        </div>

        {error && <p role="alert" className="text-sm text-red-800 dark:text-red-300">{error}</p>}
        <button type="submit" className="min-h-12 rounded-lg bg-slate-900 dark:bg-slate-100 px-4 text-white dark:text-slate-900">Save goal</button>
      </form>
      <TargetSources profile={profile} />
    </section>
  );
}

/** Says where each saved target came from. A figure the person typed is theirs: it never carries a citation. */
function TargetSources({ profile }: { profile: Profile }) {
  const t = computeTargets(profile, new Date());
  const { basis } = t;
  const kind = profile.goal?.kind;
  const rate = profile.goal?.rateKgPerWeek;
  const hasRate = (kind === 'lose' || kind === 'gain') && typeof rate === 'number' && Number.isFinite(rate) && rate > 0;

  const protein =
    basis.protein === 'custom'
      ? 'Protein: your own figure, not calculated by the app.'
      : basis.protein === 'efsa-pri'
        ? 'Protein: 0.83 g per kg of body weight, the population reference intake for adults from EFSA (EFSA Journal 2012;10(2):2557). It is used for people who do not exercise.'
        : kind === 'lose'
          ? 'Protein: 2.0 g per kg of body weight, the top of the 1.4 to 2.0 g per kg range in the ISSN position stand (Jager et al., 2017). The app takes the top of the range for a weight-loss goal.'
          : 'Protein: 1.7 g per kg of body weight, within the 1.4 to 2.0 g per kg range in the ISSN position stand (Jager et al., 2017). The app chose the middle of that range.';
  const energy =
    basis.energy === 'custom'
      ? 'Energy: your own figure, not calculated by the app.'
      : basis.energy === 'katch-mcardle'
        ? 'Energy: resting energy from the Katch-McArdle equation, using your body-fat percentage, multiplied by your activity level.'
        : 'Energy: resting energy from the Mifflin-St Jeor equation, multiplied by your activity level.';

  const lines: string[] = [protein, energy];
  if (basis.energy === 'mifflin' && profile.bodyFatPct !== undefined) {
    lines.push(`The body-fat percentage you gave (${profile.bodyFatPct} %) is outside ${BODY_FAT_MIN} to ${BODY_FAT_MAX} %, so it was not used and resting energy comes from the Mifflin-St Jeor equation.`);
  }

  if (basis.energy === 'custom') {
    if (kind === 'lose' || kind === 'gain') lines.push('Your own energy figure replaces anything your goal would have set.');
  } else if (kind === 'hold') {
    lines.push('Your goal is to hold, so your energy target stays at maintenance.');
  } else if ((kind === 'lose' || kind === 'gain') && !hasRate) {
    const proteinMoved = kind === 'lose' && basis.protein === 'issn-range';
    lines.push(
      `Choosing ${kind} without a rate ${proteinMoved ? 'raises your protein target to 2.0 g per kg. Your' : 'does not move energy: your'} energy target stays at maintenance, because the app will not invent a ${offsetWord(kind)} you did not ask for. Add a rate to set one.`,
    );
  } else if (hasRate && t.goalCapped) {
    const why: string[] = [];
    if (rate > MAX_GOAL_RATE_KG_PER_WEEK) {
      why.push(`The app's own maximum is ${MAX_GOAL_RATE_KG_PER_WEEK} kg a week (its own choice, not a published figure), so a faster rate is reduced to that.`);
    }
    if (kind === 'lose' && t.energyKcal <= t.rmrKcal) {
      why.push(`A deficit that deep would take your energy below your resting energy of ${t.rmrKcal} kcal a day, so the target stops there.`);
    }
    lines.push(`We could not give you the rate you asked for. ${why.join(' ')} Your energy target is ${t.energyKcal} kcal a day.`);
  } else if (hasRate) {
    const n = dailyKcalForRate(rate);
    lines.push(
      kind === 'lose'
        ? `Your goal takes ${n} kcal a day off your maintenance energy. ${CONVERSION_NOTE}`
        : `Your goal adds ${n} kcal a day to your maintenance energy. ${CONVERSION_NOTE}`,
    );
  }

  return (
    <div className="space-y-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-3">
      <h3 className="text-sm font-semibold">Where your targets come from</h3>
      <ul className="space-y-1 text-sm">
        {lines.map((l) => <li key={l}>{l}</li>)}
      </ul>
    </div>
  );
}


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
