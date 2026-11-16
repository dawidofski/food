import { useCallback, useEffect, useState } from 'react';
import { allBatches } from '@/data/db';
import { datasetLookup } from '@/data/datasetLookup';
import { loadFoods } from '@/data/foodRepository';
import {
  buildBatch, rebuildBatch, recook, refreshBatches, saveBatch, type BatchInput, type BuildResult,
} from '@/domain/batches';
import { refreshCustomFoods, withCustomFoods } from '@/domain/customFoods';
import type { FoodLookup } from '@/domain/foodLookup';
import { isKnownValue } from '@/domain/nutrients';
import type { Batch } from '@/types/diary';
import CoverageNote from '@/ui/components/CoverageNote';

const input = 'min-h-12 w-full rounded-lg border-2 border-slate-400 px-3 text-base';
const btn = 'min-h-12 rounded-lg border border-slate-400 px-4 text-base';

export type BatchDeps = { lookup: FoodLookup; loadData: () => Promise<void> };

/** Ingredients resolve against the dataset and the person's own foods, never against other batches. */
export const defaultBatchDeps: BatchDeps = {
  lookup: withCustomFoods(datasetLookup),
  loadData: async () => {
    await loadFoods();
    await refreshCustomFoods().catch(() => undefined);
  },
};

const kcal = (b: Batch): string => {
  const v = b.nutrientsPerPortion.energyKcal;
  return isKnownValue(v) ? `${Math.round(v).toLocaleString('en-US')} kcal` : 'energy unknown';
};

type Props = {
  deps?: BatchDeps;
  /** Hands "a portion of <name>" to the log, where the warning gate runs as for any entry. */
  onLogPortion?: (text: string) => void;
};

/** The fridge list, and the form that makes a batch or edits one. */
export default function BatchBuilder({ deps = defaultBatchDeps, onLogPortion }: Props) {
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<Batch | 'new' | null>(null);

  const load = useCallback(() => {
    allBatches()
      .then((rows) => {
        setBatches([...rows].sort((a, b) => b.cookedAt.localeCompare(a.cookedAt)));
        setLoadError(false);
      })
      .catch(() => setLoadError(true));
  }, []);
  useEffect(load, [load]);

  async function onRecook(b: Batch) {
    await saveBatch(recook(b));
    load();
  }

  if (editing) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-xl space-y-4 p-4">
        <BatchForm
          deps={deps}
          batch={editing === 'new' ? undefined : editing}
          onSaved={() => { setEditing(null); load(); }}
          onCancel={() => setEditing(null)}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Batches</h1>
      <p className="text-sm text-slate-700">Cook once, eat for days: enter what went in and how many portions it made.</p>
      <button type="button" onClick={() => setEditing('new')} className={`${btn} w-full bg-slate-900 text-white`}>Cook a batch</button>
      {loadError && <p role="alert" className="text-sm text-red-800">Your batches could not be read.</p>}
      {batches?.length === 0 && <p className="text-sm text-slate-700">Nothing in the fridge yet.</p>}
      <ul aria-label="In the fridge">
        {batches?.map((b) => (
          <li key={b.id} className="space-y-2 border-b border-slate-200 py-3">
            <div>
              <p className="text-base font-medium">{b.name}</p>
              <p className="text-sm text-slate-700">
                <span data-testid="portions-left">{b.portionsRemaining} of {b.portionCount} portions left</span>
                {' · '}{kcal(b)} per portion
                {b.totalCookedGrams !== undefined && ` · about ${Math.round(b.totalCookedGrams / b.portionCount)} g each`}
              </p>
              {b.coverage.energyKcal === 'partial' && isKnownValue(b.nutrientsPerPortion.energyKcal) && (
                <CoverageNote nutrient="energyKcal" coverage="partial" value={b.nutrientsPerPortion.energyKcal} />
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {onLogPortion && (
                <button
                  type="button" onClick={() => onLogPortion(`a portion of ${b.name}`)} aria-label={`Log a portion of ${b.name}`}
                  className="min-h-11 rounded-lg border border-slate-400 px-3 text-sm"
                >
                  Log a portion
                </button>
              )}
              <button
                type="button" onClick={() => void onRecook(b)} aria-label={`Cooked ${b.name} again`}
                className="min-h-11 rounded-lg border border-slate-400 px-3 text-sm"
              >
                Cooked again
              </button>
              <button
                type="button" onClick={() => setEditing(b)} aria-label={`Edit ${b.name}`}
                className="min-h-11 rounded-lg border border-slate-400 px-3 text-sm"
              >
                Edit
              </button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

function BatchForm({ deps, batch, onSaved, onCancel }: { deps: BatchDeps; batch?: Batch | undefined; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(batch?.name ?? '');
  const [lines, setLines] = useState(batch?.ingredients.map((i) => i.text).join('\n') ?? '');
  const [portions, setPortions] = useState(batch ? String(batch.portionCount) : '4');
  const [cooked, setCooked] = useState(batch?.totalCookedGrams !== undefined ? String(batch.totalCookedGrams) : '');
  const [result, setResult] = useState<BuildResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Any edit makes the worked-out figures stale, so they are cleared rather than left to be saved by mistake.
  const touch = <T,>(set: (v: T) => void) => (v: T) => { set(v); setResult(null); };

  function readInput(): BatchInput | null {
    const count = Number(portions.trim());
    const t = cooked.trim().replace(',', '.');
    const grams = t === '' ? undefined : Number(t);
    if (grams !== undefined && !(Number.isFinite(grams) && grams > 0)) {
      setError('The cooked weight must be a number of grams, or left empty.');
      return null;
    }
    return {
      name, portionCount: count, totalCookedGrams: grams,
      ingredientLines: lines.split('\n').map((l) => l.trim()).filter((l) => l !== ''),
    };
  }

  async function onWorkOut() {
    setError(null);
    const body = readInput();
    if (!body) return;
    setBusy(true);
    try {
      await deps.loadData();
      setResult(batch ? rebuildBatch(batch, body, deps.lookup) : buildBatch(body, deps.lookup));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  async function onSave() {
    if (!result) return;
    setBusy(true);
    try {
      await saveBatch(result.batch);
      await refreshBatches();
      onSaved();
    } catch (e) {
      setError(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  }

  const b = result?.batch;
  const missing = result?.needsHelp ?? [];
  const resolvedCount = b ? b.ingredients.filter((i) => i.refs.length > 0).length : 0;

  return (
    <form onSubmit={(e) => { e.preventDefault(); void onWorkOut(); }} className="space-y-4" aria-label={batch ? 'Edit batch' : 'New batch'}>
      <h2 className="text-lg font-semibold">{batch ? 'Edit batch' : 'Cook a batch'}</h2>
      <label className="block text-sm">
        Name
        <input type="text" value={name} onChange={(e) => touch(setName)(e.target.value)} autoComplete="off" className={input} />
      </label>
      <label className="block text-sm">
        Ingredients, one per line or separated by commas
        <textarea
          value={lines} onChange={(e) => touch(setLines)(e.target.value)} rows={6} placeholder="500 g penne, 400 g passata, 300 g chicken breast, 2 tbsp olive oil"
          className={`${input} py-2`}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          Portions it makes
          <input type="text" inputMode="numeric" value={portions} onChange={(e) => touch(setPortions)(e.target.value)} className={input} />
        </label>
        <label className="block text-sm">
          Total cooked weight (g), optional
          <input type="text" inputMode="decimal" value={cooked} onChange={(e) => touch(setCooked)(e.target.value)} className={input} />
        </label>
      </div>
      <p className="text-sm text-slate-700">
        The nutrition is the ingredients added up and divided by the number of portions. The cooked weight only says how
        much one portion weighs; it never changes the nutrition.
      </p>

      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      <button type="submit" disabled={busy} className={`${btn} w-full bg-slate-900 text-white`}>Work out the portions</button>

      {b && result && (
        <section aria-label="Result" className="space-y-3 rounded-xl border border-slate-300 p-3">
          <p className="text-base" data-testid="per-portion">
            Each portion: {kcal(b)}
            {b.coverage.energyKcal === 'partial' && isKnownValue(b.nutrientsPerPortion.energyKcal) ? ' (at least)' : ''}
            {b.totalCookedGrams !== undefined && `, about ${Math.round(b.totalCookedGrams / b.portionCount)} g`}
          </p>
          {b.coverage.energyKcal === 'partial' && isKnownValue(b.nutrientsPerPortion.energyKcal) && (
            <CoverageNote nutrient="energyKcal" coverage="partial" value={b.nutrientsPerPortion.energyKcal} />
          )}
          {NUTRIENT_PARTIALS(b).map((k) => (
            <CoverageNote key={k} nutrient={k} coverage="partial" />
          ))}

          {result.cookedWeightNotes.map((n) => (
            <p key={n.ingredient} data-testid="cooked-weight-note" role="note" className="rounded-lg border-2 border-amber-600 bg-amber-50 p-2 text-sm text-amber-950">
              <strong>{n.ingredient}</strong> was read as {Math.round(n.grams)} g of <em>cooked</em> food ({n.foodName}). The
              database has no dry pasta or rice. If you weighed it dry, the energy is about twice what is shown here, and that
              error is spread across every portion. To correct it, enter the cooked weight instead.
            </p>
          ))}

          {missing.length > 0 && (
            <div role="alert" data-testid="unresolved" className="space-y-1 rounded-lg border-2 border-red-700 p-2 text-sm">
              <p className="font-semibold">
                {missing.length === 1 ? 'This ingredient' : 'These ingredients'} could not be found, so {missing.length === 1 ? 'it is' : 'they are'} not in the total:
              </p>
              <ul className="list-disc pl-5">
                {missing.map((m) => <li key={m.rawFragment}>{m.rawFragment}</li>)}
              </ul>
              <p>
                Change the wording above and work it out again, or save anyway knowing every figure is then a minimum. You can
                also add the food under My foods and come back.
              </p>
            </div>
          )}

          {resolvedCount === 0 ? (
            <p className="text-sm text-red-800">Nothing could be found, so there is nothing to save yet.</p>
          ) : (
            <button type="button" disabled={busy} onClick={() => void onSave()} className={`${btn} w-full ${missing.length > 0 ? 'text-red-800' : 'bg-slate-900 text-white'}`}>
              {missing.length > 0 ? 'Save anyway, without those ingredients' : 'Save batch'}
            </button>
          )}
        </section>
      )}
      <button type="button" onClick={onCancel} className={`${btn} w-full`}>Cancel</button>
    </form>
  );
}

/** Nutrients other than energy whose batch figure is only a floor; energy has its own line above. */
function NUTRIENT_PARTIALS(b: Batch): (keyof Batch['coverage'])[] {
  return (Object.keys(b.coverage) as (keyof Batch['coverage'])[]).filter(
    (k) => k !== 'energyKcal' && b.coverage[k] === 'partial' && isKnownValue(b.nutrientsPerPortion[k]) && (k === 'addedSugarsG' || k === 'sodiumMg' || k === 'satFatG'),
  );
}
