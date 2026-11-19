import { useHoldUpdates } from '@/state/updates';
import LabelPhoto from '@/ui/components/LabelPhoto';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { allCustomFoods } from '@/data/db';
import {
  ALLERGEN_TAGS, NO_FLAGS, NutrientRangeError, createCustomFood, deleteCustomFood, parseNutrientField, updateCustomFood,
  type CustomFoodInput,
} from '@/domain/customFoods';
import type { CustomFood } from '@/types/diary';
import { NUTRIENT_KEYS, type ClassificationFlags, type NutrientKey } from '@/types/nutrients';
import { NUTRIENT_LABEL } from '@/ui/components/CoverageNote';
import SelfReportedBadge from '@/ui/components/SelfReportedBadge';

/** Fields people can usually read off a package, in label order. The rest sit under "More nutrients". */
const LABEL_KEYS: NutrientKey[] = ['energyKcal', 'fatG', 'satFatG', 'carbG', 'sugarsG', 'fibreG', 'proteinG', 'sodiumMg'];
const MORE_KEYS = NUTRIENT_KEYS.filter((k) => !LABEL_KEYS.includes(k));
/** EU labels print salt, not sodium: salt g / 2.5 = sodium g. */
const SALT_TO_SODIUM_MG = 400;

type FlagKey = Exclude<keyof ClassificationFlags, 'novaGroup'>;
const FLAG_OPTIONS: { key: FlagKey; label: string; hint: string }[] = [
  { key: 'processedMeat', label: 'Processed meat', hint: 'sausage, ham, bacon, frikandel, bitterballen with meat' },
  { key: 'redMeat', label: 'Red meat', hint: 'beef, pork, lamb, game' },
  { key: 'sweetDrink', label: 'Sweetened drink', hint: 'soda, sweet juice drinks' },
  { key: 'alcohol', label: 'Contains alcohol', hint: 'beer, wine, spirits' },
  { key: 'refinedGrain', label: 'Refined grain', hint: 'white bread, white rice, plain pasta' },
  { key: 'vegetable', label: 'Contains vegetables', hint: '' },
  { key: 'fruit', label: 'Contains fruit', hint: '' },
  { key: 'legume', label: 'Contains legumes', hint: 'beans, lentils, chickpeas' },
  { key: 'oilyFish', label: 'Oily fish', hint: 'salmon, mackerel, herring' },
];

const input = 'min-h-12 w-full rounded-lg border-2 border-slate-400 dark:border-slate-500 px-3 text-base';
const btn = 'min-h-12 rounded-lg border border-slate-400 dark:border-slate-500 px-4 text-base';

/** Label wording for a field: "Energy (kcal)". The accessible name starts with the nutrient so tests and screen readers find it. */
const fieldLabel = (k: NutrientKey): string => {
  const { name, unit } = NUTRIENT_LABEL[k];
  return `${name[0]!.toUpperCase()}${name.slice(1)} (${unit})`;
};

type Props = {
  /** Editing this food; absent = a new one. */
  food?: CustomFood;
  /** A starting name for a new food, e.g. what the person just typed in the log. */
  initialName?: string;
  onSaved: (food: CustomFood) => void;
  onCancel: () => void;
  /** Called after a delete; the delete control shows only when editing a saved food. */
  onDeleted?: () => void;
};

/**
 * The custom-food form. Every nutrient field starts EMPTY and an empty field is saved as unknown (no key), never as 0:
 * state is kept as the raw text, and the only text-to-number step is parseNutrientField.
 */
export function FoodEditor({ food, initialName = '', onSaved, onCancel, onDeleted }: Props) {
  useHoldUpdates(true); // mounted only while editing
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [name, setName] = useState(food?.name ?? initialName);
  const [synonyms, setSynonyms] = useState(food?.synonyms.join(', ') ?? '');
  const [portionLabel, setPortionLabel] = useState(food?.referencePortion.label ?? '1 serving');
  const [portionGrams, setPortionGrams] = useState(food ? String(food.referencePortion.grams) : '100');
  const [nutrients, setNutrients] = useState<Partial<Record<NutrientKey | 'saltG', string>>>(() => {
    const t: Partial<Record<NutrientKey, string>> = {};
    for (const k of NUTRIENT_KEYS) {
      const v = food?.nutrientsPer100g[k];
      if (typeof v === 'number') t[k] = String(Math.round(v * 1000) / 1000);
    }
    return t;
  });
  const [flags, setFlags] = useState<Record<FlagKey, boolean>>(() => {
    const f = {} as Record<FlagKey, boolean>;
    for (const o of FLAG_OPTIONS) f[o.key] = food?.classification[o.key] ?? false;
    return f;
  });
  const [ultra, setUltra] = useState(food?.classification.novaGroup === 4);
  const [allergens, setAllergens] = useState<string[]>(food?.allergens ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const setN = (k: NutrientKey | 'saltG', v: string) => setNutrients((n) => ({ ...n, [k]: v }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const per100g: Partial<Record<NutrientKey, number>> = {};
    for (const k of NUTRIENT_KEYS) {
      const r = parseNutrientField(nutrients[k] ?? '');
      if (!r.ok) return setError(`${fieldLabel(k)} must be a plain number such as 12 or 12.5, or left empty if you do not know it.`);
      if (r.value !== undefined) per100g[k] = r.value;
    }
    const salt = parseNutrientField(nutrients.saltG ?? '');
    if (!salt.ok) return setError('Salt (g) must be a plain number such as 1.5, or left empty if you do not know it.');
    // Salt only fills sodium when sodium itself was left empty, and only when salt was actually typed.
    if (salt.value !== undefined && per100g.sodiumMg === undefined) per100g.sodiumMg = salt.value * SALT_TO_SODIUM_MG;

    const grams = parseNutrientField(portionGrams);
    if (!grams.ok || grams.value === undefined || grams.value <= 0) return setError('Enter the weight of one portion in grams.');

    const body: CustomFoodInput = {
      name,
      synonyms: synonyms.split(',').map((s) => s.trim()).filter((s) => s !== ''),
      per100g,
      classification: { ...NO_FLAGS, ...flags, novaGroup: ultra ? 4 : 1 },
      allergens,
      referencePortion: { label: portionLabel, grams: grams.value },
    };
    setSaving(true);
    try {
      const saved = food ? await updateCustomFood(food.id, body) : await createCustomFood(body);
      setError(null);
      onSaved(saved);
    } catch (err) {
      // Named as the person sees the field, never as the internal key.
      setError(
        err instanceof NutrientRangeError
          ? `${fieldLabel(err.key)} must be a number between 0 and ${err.ceiling}.`
          : err instanceof Error
            ? err.message
            : String(err),
      );
      setSaving(false);
    }
  }

  const numberField = (k: NutrientKey) => (
    <label key={k} className="block text-sm">
      {fieldLabel(k)}
      <input
        type="text" inputMode="decimal" autoComplete="off" value={nutrients[k] ?? ''} placeholder="unknown"
        onChange={(e) => setN(k, e.target.value)} className={input}
      />
    </label>
  );

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" aria-label={food ? 'Edit food' : 'New food'}>
      <h2 className="text-lg font-semibold">{food ? 'Edit food' : 'Add your own food'}</h2>

      {/*
        Fills the fields below; it saves nothing. Every figure lands in a box the person can see and change,
        exactly as if they had typed it, and the food is stored as their own and marked self-reported.
      */}
      <LabelPhoto
        onRead={(label) => {
          if (label.name !== undefined && name.trim() === '') setName(label.name);
          setNutrients((n) => {
            const next = { ...n };
            // Only what the label actually printed. An absent figure is left absent, never written as 0.
            const map: [keyof typeof label.per100, NutrientKey | 'saltG'][] = [
              ['energyKcal', 'energyKcal'], ['proteinG', 'proteinG'], ['carbsG', 'carbG'],
              ['sugarsG', 'sugarsG'], ['fatG', 'fatG'], ['satFatG', 'satFatG'],
              ['fibreG', 'fibreG'], ['saltG', 'saltG'],
            ];
            for (const [from, to] of map) {
              const v = label.per100[from];
              if (typeof v === 'number') next[to] = String(v);
            }
            return next;
          });
        }}
      />

      <label className="block text-sm">
        Name
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" className={input} />
      </label>
      <label className="block text-sm">
        Other names, separated by commas
        <input type="text" value={synonyms} onChange={(e) => setSynonyms(e.target.value)} autoComplete="off" className={input} />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          One portion is called
          <input type="text" value={portionLabel} onChange={(e) => setPortionLabel(e.target.value)} className={input} />
        </label>
        <label className="block text-sm">
          One portion weighs (g)
          <input type="text" inputMode="decimal" value={portionGrams} onChange={(e) => setPortionGrams(e.target.value)} className={input} />
        </label>
      </div>

      <fieldset className="space-y-3 rounded-xl border border-slate-300 dark:border-slate-700 p-3">
        <legend className="px-1 text-sm font-semibold">Nutrition per 100 g, from the package</legend>
        <p className="text-sm text-slate-700 dark:text-slate-300">
          Fill in only what you can read. A field you leave empty is saved as <strong>unknown</strong>, not as zero, and the
          app will not warn about a number nobody measured.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {LABEL_KEYS.map(numberField)}
          <label className="block text-sm">
            Salt (g), if the label shows salt
            <input
              type="text" inputMode="decimal" autoComplete="off" value={nutrients.saltG ?? ''} placeholder="unknown"
              onChange={(e) => setN('saltG', e.target.value)} className={input}
            />
          </label>
        </div>
        <details>
          <summary className="min-h-11 py-2 text-sm underline">More nutrients</summary>
          <div className="mt-2 grid grid-cols-2 gap-3">{MORE_KEYS.map(numberField)}</div>
        </details>
      </fieldset>

      <fieldset className="space-y-1 rounded-xl border border-slate-300 dark:border-slate-700 p-3">
        <legend className="px-1 text-sm font-semibold">What kind of food is it?</legend>
        <p className="text-sm text-slate-700 dark:text-slate-300">
          Worth ticking even with no numbers: a sausage marked as processed meat still shows the processed-meat warning,
          because that warning looks at the kind of food, not at the nutrition figures.
        </p>
        {FLAG_OPTIONS.map((o) => (
          <label key={o.key} className="flex min-h-12 items-start gap-3 py-1 text-base">
            <input
              type="checkbox" checked={flags[o.key]} onChange={(e) => setFlags((f) => ({ ...f, [o.key]: e.target.checked }))}
              className="mt-1 h-6 w-6 shrink-0"
            />
            <span>
              {o.label}
              {o.hint && <span className="block text-sm text-slate-600 dark:text-slate-400">{o.hint}</span>}
            </span>
          </label>
        ))}
        <label className="flex min-h-12 items-start gap-3 py-1 text-base">
          <input type="checkbox" checked={ultra} onChange={(e) => setUltra(e.target.checked)} className="mt-1 h-6 w-6 shrink-0" />
          <span>
            Ultra-processed (NOVA 4)
            <span className="block text-sm text-slate-600 dark:text-slate-400">industrial snacks, ready meals, most fried snack foods</span>
          </span>
        </label>
      </fieldset>

      <fieldset className="space-y-1 rounded-xl border border-slate-300 dark:border-slate-700 p-3">
        <legend className="px-1 text-sm font-semibold">Allergens it contains</legend>
        <p className="text-sm text-slate-700 dark:text-slate-300">
          Tick what the label says. An unticked box tells the app nothing; it does not mean the food is free of it.
        </p>
        {ALLERGEN_TAGS.map((a) => (
          <label key={a} className="flex min-h-12 items-center gap-3 py-1 text-base capitalize">
            <input
              type="checkbox" checked={allergens.includes(a)} className="h-6 w-6 shrink-0"
              onChange={(e) => setAllergens((xs) => (e.target.checked ? [...xs, a] : xs.filter((x) => x !== a)))}
            />
            {a}
          </label>
        ))}
      </fieldset>

      {error && <p role="alert" className="text-sm text-red-800 dark:text-red-300">{error}</p>}
      <div className="flex flex-col gap-2">
        <button type="submit" disabled={saving} className={`${btn} bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900`}>Save food</button>
        <button type="button" onClick={onCancel} className={btn}>Cancel</button>
        {food && !confirmingDelete && (
          <button type="button" onClick={() => setConfirmingDelete(true)} className={`${btn} text-red-800 dark:text-red-300`}>Delete this food</button>
        )}
      </div>
      {food && confirmingDelete && (
        <div role="group" aria-label="Confirm delete" className="space-y-2 rounded-xl border-2 border-red-700 dark:border-red-400 p-3">
          <p className="text-base">
            Delete &ldquo;{food.name}&rdquo;? It will no longer be found when you log, and a saved meal that uses it
            will stop logging — it will say so rather than logging a smaller meal. Entries you already logged keep
            their numbers; nothing in your diary changes.
          </p>
          <button
            type="button" className={`${btn} w-full bg-red-800 dark:bg-red-900 text-white`}
            onClick={() => {
              void deleteCustomFood(food.id)
                .then(() => onDeleted?.())
                .catch((err: unknown) => {
                  setConfirmingDelete(false);
                  setError(`Could not delete: ${err instanceof Error ? err.message : String(err)}`);
                });
            }}
          >
            Yes, delete it
          </button>
          <button type="button" onClick={() => setConfirmingDelete(false)} className={`${btn} w-full`}>Keep it</button>
        </div>
      )}
    </form>
  );
}

/** The saved foods: add, edit, reuse. Each is marked self-reported, since its numbers came from the person. */
export default function MyFoods() {
  const [foods, setFoods] = useState<CustomFood[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<CustomFood | 'new' | null>(null);

  const load = useCallback(() => {
    allCustomFoods()
      .then((rows) => {
        setFoods([...rows].sort((a, b) => a.name.localeCompare(b.name)));
        setLoadError(false);
      })
      .catch(() => setLoadError(true));
  }, []);
  useEffect(load, [load]);

  if (editing) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-xl space-y-4 p-4">
        <FoodEditor
          food={editing === 'new' ? undefined : editing}
          onSaved={() => { setEditing(null); load(); }}
          onDeleted={() => { setEditing(null); load(); }}
          onCancel={() => setEditing(null)}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">My foods</h1>
      <button type="button" onClick={() => setEditing('new')} className={`${btn} w-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900`}>Add a food</button>
      {loadError && <p role="alert" className="text-sm text-red-800 dark:text-red-300">Your foods could not be read.</p>}
      {foods?.length === 0 && <p className="text-sm text-slate-700 dark:text-slate-300">Nothing here yet. Foods you add can be logged by name.</p>}
      <ul>
        {foods?.map((f) => (
          <li key={f.id} className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-800 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-base">{f.name}</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {f.referencePortion.label}, {f.referencePortion.grams} g
                <SelfReportedBadge />
              </p>
            </div>
            <button type="button" onClick={() => setEditing(f)} aria-label={`Edit ${f.name}`} className="min-h-11 shrink-0 rounded-lg border border-slate-400 dark:border-slate-500 px-3 text-sm">
              Edit
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
