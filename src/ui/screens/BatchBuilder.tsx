import { useHoldUpdates } from '@/state/updates';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { readIngredients } from '@/ai/aiFallback';
import { interpretEntry, readIngredientList } from '@/ai/deepseek';
import { getApiKey, isAiEnabled } from '@/state/aiSettings';
import { allBatches } from '@/data/db';
import { datasetLookup } from '@/data/datasetLookup';
import { loadFoods } from '@/data/foodRepository';
import {
  buildBatch, deleteBatch, rebuildBatch, recook, refreshBatches, saveBatch, type BatchInput, type BuildResult,
} from '@/domain/batches';
import { applyCorrection, type Correction } from '@/domain/corrections';
import { refreshCustomFoods, withCustomFoods } from '@/domain/customFoods';
import type { FoodLookup } from '@/domain/foodLookup';
import { isKnownValue } from '@/domain/nutrients';
import type { Batch } from '@/types/diary';
import type { NutrientKey } from '@/types/nutrients';
import { NUTRIENT_LABEL } from '@/ui/components/CoverageNote';
import CoverageNote from '@/ui/components/CoverageNote';
import { FIGURES_LEAD, PartialFigureNote, figureText, isPartialFigure, partialNoteId, readFigure } from '@/ui/components/figureForm';
import SelfReportedBadge from '@/ui/components/SelfReportedBadge';
import { fieldClass } from './FirstRun';

const input = 'min-h-12 w-full rounded-lg border-2 border-slate-400 dark:border-slate-500 px-3 text-base';
const SHOWN: NutrientKey[] = ['energyKcal', 'proteinG', 'fibreG', 'sodiumMg', 'satFatG', 'addedSugarsG'];
const btn = 'min-h-12 rounded-lg border border-slate-400 dark:border-slate-500 px-4 text-base';

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
  const [correcting, setCorrecting] = useState<Batch | null>(null);

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

  if (correcting) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-xl space-y-4 p-4">
        <BatchFigures
          batch={correcting}
          onSaved={() => { setCorrecting(null); load(); }}
          onCancel={() => setCorrecting(null)}
        />
      </main>
    );
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
      <p className="text-sm text-slate-700 dark:text-slate-300">Cook once, eat for days: enter what went in and how many portions it made.</p>
      <button type="button" onClick={() => setEditing('new')} className={`${btn} w-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900`}>Cook a batch</button>
      {loadError && <p role="alert" className="text-sm text-red-800 dark:text-red-300">Your batches could not be read.</p>}
      {batches?.length === 0 && <p className="text-sm text-slate-700 dark:text-slate-300">Nothing in the fridge yet.</p>}
      <ul aria-label="In the fridge">
        {batches?.map((b) => (
          <li key={b.id} className="space-y-2 border-b border-slate-200 dark:border-slate-800 py-3">
            <div>
              <p className="text-base font-medium">{b.name}</p>
              <p className="text-sm text-slate-700 dark:text-slate-300">
                <span data-testid="portions-left">{b.portionsRemaining} of {b.portionCount} portions left</span>
                {' · '}{kcal(b)} per portion
                {b.selfReported && <SelfReportedBadge />}
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
                  className="min-h-11 rounded-lg border border-slate-400 dark:border-slate-500 px-3 text-sm"
                >
                  Log a portion
                </button>
              )}
              <button
                type="button" onClick={() => void onRecook(b)} aria-label={`Cooked ${b.name} again`}
                className="min-h-11 rounded-lg border border-slate-400 dark:border-slate-500 px-3 text-sm"
              >
                Cooked again
              </button>
              <button
                type="button" onClick={() => setEditing(b)} aria-label={`Edit ${b.name}`}
                className="min-h-11 rounded-lg border border-slate-400 dark:border-slate-500 px-3 text-sm"
              >
                Edit
              </button>
              <button
                type="button" onClick={() => setCorrecting(b)} aria-label={`Correct the figures of ${b.name}`}
                className="min-h-11 rounded-lg border border-slate-400 dark:border-slate-500 px-3 text-sm"
              >
                Correct the figures
              </button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

function BatchForm({ deps, batch, onSaved, onCancel }: { deps: BatchDeps; batch?: Batch | undefined; onSaved: () => void; onCancel: () => void }) {
  useHoldUpdates(true); // mounted only while the form is open
  const [name, setName] = useState(batch?.name ?? '');
  const [lines, setLines] = useState(batch?.ingredients.map((i) => i.text).join('\n') ?? '');
  const [portions, setPortions] = useState(batch ? String(batch.portionCount) : '4');
  const [cooked, setCooked] = useState(batch?.totalCookedGrams !== undefined ? String(batch.totalCookedGrams) : '');
  const [result, setResult] = useState<BuildResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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

      <RecipeReader
        onLines={(read) => touch(setLines)((lines.trim() === '' ? '' : `${lines.trim()}\n`) + read.join('\n'))}
      />

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
      <p className="text-sm text-slate-700 dark:text-slate-300">
        The nutrition is the ingredients added up and divided by the number of portions. The cooked weight only says how
        much one portion weighs; it never changes the nutrition.
      </p>

      {error && <p role="alert" className="text-sm text-red-800 dark:text-red-300">{error}</p>}
      <button type="submit" disabled={busy} className={`${btn} w-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900`}>Work out the portions</button>

      {b && result && (
        <section aria-label="Result" className="space-y-3 rounded-xl border border-slate-300 dark:border-slate-700 p-3">
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
            <p key={n.ingredient} data-testid="cooked-weight-note" role="note" className="rounded-lg border-2 border-amber-600 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-2 text-sm text-amber-950 dark:text-amber-200">
              <strong>{n.ingredient}</strong> was read as {Math.round(n.grams)} g of <em>cooked</em> food ({n.foodName}). The
              database has no dry pasta or rice. If you weighed it dry, the energy is about twice what is shown here, and that
              error is spread across every portion. To correct it, enter the cooked weight instead.
            </p>
          ))}

          {missing.length > 0 && (
            <div role="alert" data-testid="unresolved" className="space-y-1 rounded-lg border-2 border-red-700 dark:border-red-400 p-2 text-sm">
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
            <p className="text-sm text-red-800 dark:text-red-300">Nothing could be found, so there is nothing to save yet.</p>
          ) : (
            <button type="button" disabled={busy} onClick={() => void onSave()} className={`${btn} w-full ${missing.length > 0 ? 'text-red-800 dark:text-red-300' : 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'}`}>
              {missing.length > 0 ? 'Save anyway, without those ingredients' : 'Save batch'}
            </button>
          )}
        </section>
      )}
      <button type="button" onClick={onCancel} className={`${btn} w-full`}>Cancel</button>
      {batch && !confirmingDelete && (
        <button type="button" onClick={() => setConfirmingDelete(true)} className={`${btn} w-full text-red-800 dark:text-red-300`}>Delete this batch</button>
      )}
      {batch && confirmingDelete && (
        <div role="group" aria-label="Confirm delete" className="space-y-2 rounded-xl border-2 border-red-700 dark:border-red-400 p-3">
          <p className="text-base">
            Delete &ldquo;{batch.name}&rdquo;? It will no longer be found when you log. Portions you already logged keep
            their numbers; nothing in your diary changes.
          </p>
          <button
            type="button" className={`${btn} w-full bg-red-800 dark:bg-red-900 text-white`}
            onClick={() => {
              void deleteBatch(batch.id)
                .then(onSaved)
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

/** Nutrients other than energy whose batch figure is only a floor; energy has its own line above. */
function NUTRIENT_PARTIALS(b: Batch): (keyof Batch['coverage'])[] {
  return (Object.keys(b.coverage) as (keyof Batch['coverage'])[]).filter(
    (k) => k !== 'energyKcal' && b.coverage[k] === 'partial' && isKnownValue(b.nutrientsPerPortion[k]) && (k === 'addedSugarsG' || k === 'sodiumMg' || k === 'satFatG'),
  );
}

const fieldText = (b: Batch, k: NutrientKey): string => figureText(b.nutrientsPerPortion[k]);

/** The batch's per-portion figures, typed by hand. Same field pattern and wording as an entry's figures. */
function BatchFigures({ batch, onSaved, onCancel }: { batch: Batch; onSaved: () => void; onCancel: () => void }) {
  useHoldUpdates(true);
  const [figures, setFigures] = useState<Partial<Record<NutrientKey, string>>>(() => Object.fromEntries(SHOWN.map((k) => [k, fieldText(batch, k)])));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Only fields that changed are sent: an untouched field changes nothing.
    const correction: Correction = {};
    for (const k of SHOWN) {
      // Read from the DOM now, never from a cached flag.
      const badInput = (e.currentTarget.elements.namedItem(`batch-fig-${k}`) as HTMLInputElement | null)?.validity.badInput ?? false;
      const read = readFigure(k, figures[k] ?? '', fieldText(batch, k), badInput);
      if (read.kind === 'refused') { setError(read.message); return; }
      if (read.kind === 'clear') correction[k] = null;
      else if (read.kind === 'set') correction[k] = read.value;
    }
    setError(null);
    if (Object.keys(correction).length === 0) { onCancel(); return; }
    setBusy(true);
    try {
      const applied = applyCorrection({ nutrients: batch.nutrientsPerPortion, coverage: batch.coverage }, correction);
      // A typed number is the person's own reading, so the batch is self-reported; a correction that only clears puts none of theirs in, so it marks nothing.
      const typed = Object.values(correction).some((v) => typeof v === 'number');
      await saveBatch({ ...batch, nutrientsPerPortion: applied.nutrients, coverage: applied.coverage, ...(typed ? { selfReported: true } : {}) });
      onSaved();
    } catch (err) {
      setError(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-3" aria-label="Correct the figures">
      <h2 className="text-lg font-semibold">{`Correct the figures of ${batch.name}`}</h2>
      <p className="text-sm text-slate-700 dark:text-slate-300">{FIGURES_LEAD}</p>
      <p className="text-sm text-slate-700 dark:text-slate-300">These are the figures for one portion.</p>
      {SHOWN.map((k) => (
        <div key={k}>
          <label htmlFor={`batch-fig-${k}`} className="block text-sm font-medium capitalize">{`${NUTRIENT_LABEL[k].name} (${NUTRIENT_LABEL[k].unit})`}</label>
          <input
            id={`batch-fig-${k}`} type="number" inputMode="decimal" step="any" value={figures[k] ?? ''}
            onChange={(e) => setFigures((f) => ({ ...f, [k]: e.target.value }))} className={fieldClass}
            {...(isPartialFigure(batch.coverage, k, batch.nutrientsPerPortion[k]) ? { 'aria-describedby': partialNoteId(`batch-fig-${k}`) } : {})}
          />
          <PartialFigureNote k={k} coverage={batch.coverage} value={batch.nutrientsPerPortion[k]} inputId={`batch-fig-${k}`} />
        </div>
      ))}
      <p className="text-sm text-slate-700 dark:text-slate-300">
        Portions you already logged keep their numbers; only portions logged from now on use these. Changing the
        ingredients or the number of portions works the figures out again and replaces anything typed here.
      </p>
      {error && <p role="alert" className="text-sm text-red-800 dark:text-red-300">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={`${btn} flex-1 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900`}>Save figures</button>
        <button type="button" onClick={onCancel} className={`${btn} flex-1`}>Discard</button>
      </div>
    </form>
  );
}

/**
 * Paste a recipe and get the ingredient lines out of it.
 *
 * It only fills the box above; nothing is saved and nothing is resolved here, so the person edits the lines
 * exactly as if they had typed them. Hidden entirely when the optional fallback is off, because a control that
 * does nothing is worse than no control.
 */
function RecipeReader({ onLines }: { onLines: (lines: string[]) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  if (!isAiEnabled()) return null;

  const read = () => {
    setBusy(true);
    setNote(null);
    void readIngredients(text, {
      isEnabled: isAiEnabled,
      getKey: getApiKey,
      isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
      interpret: interpretEntry,
      readIngredientList,
    })
      .then((lines) => {
        if (lines === null) {
          setNote('Nothing could be read from that. Type the ingredients in instead.');
          return;
        }
        onLines(lines);
        setText('');
        setOpen(false);
      })
      .catch(() => setNote('Nothing could be read from that. Type the ingredients in instead.'))
      .finally(() => setBusy(false));
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="min-h-11 text-sm underline">
        Paste a recipe instead
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-300 dark:border-slate-700 p-3">
      <label className="block text-sm">
        Paste or type the recipe
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="lasagna with 500g beef, 400g pasta, 2 jars of tomato sauce"
          className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
        />
      </label>
      <p className="text-xs text-slate-600 dark:text-slate-400">
        The text is sent to DeepSeek, which reads it into lines. It adds no ingredient your text does not
        mention and keeps every amount you stated; a line with no amount is left out rather than guessed. The
        lines land in the box above for you to check and change.
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={read} disabled={busy || text.trim() === ''} className="min-h-11 flex-1 rounded-lg border border-slate-900 dark:border-slate-100 px-3 text-sm font-semibold disabled:opacity-50">
          {busy ? 'Reading…' : 'Read it'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-lg border border-slate-300 dark:border-slate-700 px-3 text-sm">
          Cancel
        </button>
      </div>
      {note && <p role="alert" className="text-sm">{note}</p>}
    </div>
  );
}
