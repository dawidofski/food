import { useEffect, useState, type FormEvent } from 'react';
import { localDayKey } from '@/domain/dayBoundary';
import { isKnownValue } from '@/domain/nutrients';
import type { Correction } from '@/domain/corrections';
import { deleteEntry } from '@/data/db';
import { offProductMeta } from '@/data/offCache';
import { useEntryFlow, type FlowDeps } from '@/state/useEntryFlow';
import type { DiaryEntry, Level } from '@/types/diary';
import type { NutrientKey } from '@/types/nutrients';
import CoverageNote, { NUTRIENT_LABEL } from '@/ui/components/CoverageNote';
import { fmtAmount } from '@/ui/components/NutrientBar';
import { FIGURES_LEAD, PartialFigureNote, figureText, isPartialFigure, partialNoteId, readFigure } from '@/ui/components/figureForm';
import OpenFoodFactsBadge from '@/ui/components/OpenFoodFactsBadge';
import SelfReportedBadge from '@/ui/components/SelfReportedBadge';
import CorrectedBadge from '@/ui/components/CorrectedBadge';
import WarningGate from './WarningGate';
import { fieldClass } from './FirstRun';

const LEVEL_WORD: Record<Level, string> = { INFO: 'info', MODERATE: 'moderate', HIGH: 'high', CRITICAL: 'critical' };
const SHOWN: NutrientKey[] = ['energyKcal', 'proteinG', 'fibreG', 'sodiumMg', 'satFatG', 'addedSugarsG'];
const btn = 'min-h-12 rounded-lg border border-slate-400 dark:border-slate-500 px-4 text-base';

const whenText = (at: string): string => {
  const d = new Date(at);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '';
};

/** What removing this entry takes off the day's totals: only figures that are actually known, never a zero for an unknown. */
function removalText(entry: DiaryEntry, isToday: boolean): string {
  const parts: string[] = [];
  for (const k of SHOWN) {
    const v = entry.nutrients[k];
    if (!isKnownValue(v)) continue;
    const { name, unit } = NUTRIENT_LABEL[k];
    parts.push(unit === 'kcal' ? `${fmtAmount(v)} kcal` : `${fmtAmount(v)} ${unit} ${name}`);
  }
  const day = isToday ? 'today' : 'that day';
  if (parts.length === 0) return `This entry has no nutrient figures, so ${day}’s totals will not change.`;
  const list = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `This will remove ${list} from ${day}’s totals.`;
}

const fieldText = (entry: DiaryEntry, k: NutrientKey): string => figureText(entry.nutrients[k]);

/** Names of the figures the person corrected by hand. A key this build does not know is skipped, never thrown on. */
function correctedNames(keys: NutrientKey[] | undefined): string[] {
  const labels: Partial<Record<string, { name: string }>> = NUTRIENT_LABEL;
  return [...new Set(keys ?? [])].flatMap((k) => {
    const name = labels[k]?.name;
    return name ? [name] : [];
  });
}

function listNames(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export default function EntryDetail({
  entry, deps, onClose, onChanged,
}: {
  entry: DiaryEntry;
  deps: FlowDeps;
  onClose: () => void;
  onChanged: () => void;
}) {
  const flow = useEntryFlow(deps);
  const [mode, setMode] = useState<'view' | 'edit' | 'figures' | 'confirmDelete'>('view');
  const [text, setText] = useState(entry.rawText);
  const [failed, setFailed] = useState<string | null>(null);
  const initialFigures = (): Partial<Record<NutrientKey, string>> => Object.fromEntries(SHOWN.map((k) => [k, fieldText(entry, k)]));
  const [figures, setFigures] = useState(initialFigures);
  const [figureError, setFigureError] = useState<string | null>(null);

  useEffect(() => {
    if (!flow.outcome) return;
    if (flow.outcome.action === 'added') {
      onChanged();
      onClose();
    } else {
      // Abandoning a correction changes nothing; stay on the form.
      flow.dismissOutcome();
    }
  }, [flow.outcome]); // eslint-disable-line react-hooks/exhaustive-deps

  const ruleTitle = (id: string): string => deps.rules.find((r) => r.id === id)?.title ?? id;
  const isToday = localDayKey(entry.at) === localDayKey(deps.now());
  const gateOpen = flow.stage === 'gate' || flow.stage === 'questions';

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    void flow.submit(text, { revises: { id: entry.id, at: entry.at } });
  };

  const onSaveFigures = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Only fields that changed are sent: an untouched field changes nothing, and a figure not shown here is never mentioned.
    const correction: Correction = {};
    for (const k of SHOWN) {
      // Read from the DOM now, never cached: a flag mirrored into state goes stale when the DOM changes without a React event.
      const badInput = (e.currentTarget.elements.namedItem(`fig-${k}`) as HTMLInputElement | null)?.validity.badInput ?? false;
      const read = readFigure(k, figures[k] ?? '', fieldText(entry, k), badInput);
      if (read.kind === 'refused') { setFigureError(read.message); return; }
      if (read.kind === 'clear') correction[k] = null;
      else if (read.kind === 'set') correction[k] = read.value;
    }
    setFigureError(null);
    if (Object.keys(correction).length === 0) { setMode('view'); return; }
    void flow.correctEntry(entry, correction);
  };

  const confirmDelete = async () => {
    try {
      await (deps.store.deleteEntry ?? deleteEntry)(entry.id);
      onChanged();
      onClose();
    } catch (e) {
      setFailed(`This could not be deleted: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <section aria-label="Entry" className="space-y-4">
      <button type="button" onClick={onClose} className="min-h-11 text-sm underline">Back to the diary</button>
      <div>
        <h2 className="text-xl font-semibold">{entry.rawText}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">{whenText(entry.at)}</p>
      </div>

      <ul className="space-y-1">
        {entry.items.map((i, n) => (
          <li key={`${i.foodId}-${n}`} className="text-base">
            {deps.lookup.get(i.source, i.foodId)?.name ?? i.foodId}
            {i.source !== 'batch' && Number.isFinite(i.grams) && ` — ${fmtAmount(i.grams)} g`}
            {i.source === 'batch' && <span className="ml-1 text-sm text-slate-700 dark:text-slate-300">(portion from a batch)</span>}
            {(i.source === 'custom' || i.selfReported) && <SelfReportedBadge />}
            {i.source === 'off' && <OpenFoodFactsBadge {...(offProductMeta(i.foodId)?.lastModified !== undefined ? { lastModified: offProductMeta(i.foodId)!.lastModified! } : {})} />}
          </li>
        ))}
      </ul>

      {correctedNames(entry.correctedKeys).length > 0 && (
        <p className="text-sm text-teal-900 dark:text-teal-200">
          <CorrectedBadge keys={entry.correctedKeys} />
          {` You corrected ${listNames(correctedNames(entry.correctedKeys))} by hand. The entry’s other figures are unchanged.`}
        </p>
      )}

      <dl className="space-y-1 text-sm">
        {SHOWN.map((k) => {
          const v = entry.nutrients[k];
          if (!isKnownValue(v)) return null;
          const { name, unit } = NUTRIENT_LABEL[k];
          return (
            <div key={k} className="flex justify-between gap-2">
              <dt className="capitalize">{name}</dt>
              <dd>{entry.coverage[k] === 'partial' ? <CoverageNote nutrient={k} coverage="partial" value={v} /> : `${fmtAmount(v)} ${unit}`}</dd>
            </div>
          );
        })}
      </dl>

      <section aria-label="Warnings shown" className="space-y-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3">
        <h3 className="text-sm font-semibold">Shown when you logged this</h3>
        {entry.warningsShown.length === 0 ? (
          <p className="text-sm">No warnings were shown for this entry.</p>
        ) : (
          <ul className="text-sm">
            {entry.warningsShown.map((w, n) => (
              <li key={`${w.ruleId}-${n}`}>{`${ruleTitle(w.ruleId)} (${LEVEL_WORD[w.level]})`}</li>
            ))}
          </ul>
        )}
        {entry.userAction === 'addedAfterAlternatives' && <p className="text-sm">You looked at the alternatives before adding it.</p>}
      </section>

      {failed && <p role="alert" className="text-sm text-slate-900 dark:text-slate-100">{failed}</p>}

      {mode === 'view' && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${btn} flex-1`} onClick={() => setMode('edit')}>Edit</button>
          <button type="button" className={`${btn} flex-1`} onClick={() => setMode('figures')}>Correct the figures</button>
          <button type="button" className={`${btn} flex-1`} onClick={() => setMode('confirmDelete')}>Delete</button>
        </div>
      )}

      {mode === 'figures' && (
        <form onSubmit={onSaveFigures} className="space-y-3">
          <p className="text-sm text-slate-700 dark:text-slate-300">{FIGURES_LEAD}</p>
          {SHOWN.map((k) => (
            <div key={k}>
              <label htmlFor={`fig-${k}`} className="block text-sm font-medium capitalize">{`${NUTRIENT_LABEL[k].name} (${NUTRIENT_LABEL[k].unit})`}</label>
              <input
                id={`fig-${k}`}
                type="number"
                inputMode="decimal"
                step="any"
                value={figures[k] ?? ''}
                onChange={(e) => setFigures((f) => ({ ...f, [k]: e.target.value }))}
                className={fieldClass}
                {...(isPartialFigure(entry.coverage, k, entry.nutrients[k]) ? { 'aria-describedby': partialNoteId(`fig-${k}`) } : {})}
              />
              <PartialFigureNote k={k} coverage={entry.coverage} value={entry.nutrients[k]} inputId={`fig-${k}`} />
            </div>
          ))}
          <p className="text-sm text-slate-700 dark:text-slate-300">
            The corrected entry is checked again before it replaces this one. The original is kept in your history.
          </p>
          {figureError && <p role="alert" className="text-sm text-red-800 dark:text-red-300">{figureError}</p>}
          {flow.error && !gateOpen && <p role="alert" className="text-sm text-slate-900 dark:text-slate-100">{flow.error}</p>}
          <div className="flex gap-2">
            <button type="submit" className={`${btn} flex-1 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900`}>Save figures</button>
            <button
              type="button"
              className={`${btn} flex-1`}
              onClick={() => { flow.edit(); setFigures(initialFigures()); setFigureError(null); setMode('view'); }}
            >
              Discard
            </button>
          </div>
        </form>
      )}

      {mode === 'edit' && (
        <form onSubmit={onSave} className="space-y-2">
          <label htmlFor="correct-text" className="text-sm font-semibold">Correct what you ate</label>
          <input
            id="correct-text"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
            className="min-h-14 w-full rounded-xl border-2 border-slate-400 dark:border-slate-500 px-3 text-lg"
          />
          <p className="text-sm text-slate-700 dark:text-slate-300">
            The corrected entry is checked again before it replaces this one. The original is kept in your history.
          </p>
          {flow.stage === 'resolving' && <p className="text-sm text-slate-600 dark:text-slate-400">Checking&hellip;</p>}
          {flow.error && !gateOpen && <p role="alert" className="text-sm text-slate-900 dark:text-slate-100">{flow.error}</p>}
          {flow.stage === 'needsHelp' && (
            <p className="text-sm">
              {flow.unresolved.length > 0
                ? `I don’t know ${flow.unresolved.map((u) => `“${u.foodQuery}”`).join(', ')} yet. Nothing has been changed.`
                : 'I couldn’t find a food in that. Nothing has been changed.'}
            </p>
          )}
          <div className="flex gap-2">
            <button type="submit" className={`${btn} flex-1 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900`}>Save correction</button>
            <button
              type="button"
              className={`${btn} flex-1`}
              onClick={() => { flow.edit(); setText(entry.rawText); setMode('view'); }}
            >
              Discard
            </button>
          </div>
        </form>
      )}

      {mode === 'confirmDelete' && (
        <div role="group" aria-label="Confirm delete" className="space-y-2 rounded-xl border-2 border-slate-400 dark:border-slate-500 p-3">
          <p className="text-base">{removalText(entry, isToday)}</p>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            It stays in your history marked as deleted, but no longer counts toward any total or weekly count.
          </p>
          <div className="flex gap-2">
            <button type="button" className={`${btn} flex-1 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900`} onClick={() => void confirmDelete()}>Yes, delete it</button>
            <button type="button" className={`${btn} flex-1`} onClick={() => setMode('view')}>Keep it</button>
          </div>
        </div>
      )}

      {gateOpen && <WarningGate flow={flow} />}
    </section>
  );
}
