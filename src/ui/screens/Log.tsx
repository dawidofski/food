import { useEffect, useState, type FormEvent } from 'react';
import { isAiEnabled } from '@/state/aiSettings';
import { useHoldUpdates } from '@/state/updates';
import { defaultDeps, useEntryFlow, type FlowDeps } from '@/state/useEntryFlow';
import type { DiaryEntry } from '@/types/diary';
import EntryRow from '@/ui/components/EntryRow';
import WarningGate, { CheckNotes, ResolvedLines } from './WarningGate';
import { FoodEditor } from './MyFoods';
import ScanBarcode, { type ScanDeps } from './ScanBarcode';

const RECENT_LIMIT = 8;

export default function Log({
  deps = defaultDeps,
  initialDraft = '',
  scan,
  onUnsavedWork,
}: {
  deps?: FlowDeps;
  initialDraft?: string;
  /**
   * Reports whether there is work here that closing would destroy: typed text, an open food editor, a part-
   * finished scan, or a warning gate the person is reading. The same predicate `useHoldUpdates` uses, because
   * the same things are worth protecting from a service-worker reload and from a stray back swipe.
   */
  onUnsavedWork?: (unsaved: boolean) => void;
  /** The barcode scanner's seam, injected by tests so nothing touches a camera or the network. */
  scan?: ScanDeps;
}) {
  const flow = useEntryFlow(deps);
  const [draft, setDraft] = useState(initialDraft);
  const [recent, setRecent] = useState<DiaryEntry[]>([]);
  /** The name to start the editor with, or null when the editor is closed. */
  const [editorName, setEditorName] = useState<string | null>(null);
  /** True while the barcode panel is open. A scan proposes a food; it never adds one. */
  const [scanning, setScanning] = useState(false);
  /** One attempt per entry: asking twice spends the person's money for the same answer. */
  const [dishTried, setDishTried] = useState(false);
  const [dishFailed, setDishFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const now = deps.now();
    const from = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
    deps.store
      .entriesBetween(from, now.toISOString())
      .then((rows) => {
        if (live) setRecent([...rows].reverse().slice(0, RECENT_LIMIT));
      })
      .catch(() => {
        if (live) setRecent([]);
      });
    return () => {
      live = false;
    };
  }, [deps, flow.storedCount]);

  // Once an entry is stored (added or cancelled) the field is cleared; editing a pending entry keeps the text.
  useEffect(() => {
    if (flow.outcome) setDraft('');
  }, [flow.outcome]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setEditorName(null);
    void flow.submit(draft);
  };

  // Typed text, an open food editor and a part-finished scan are unsaved work too.
  const typing = draft.trim() !== '' || editorName !== null || scanning;
  useHoldUpdates(typing);

  const gateOpen = flow.stage === 'gate' || flow.stage === 'questions';

  // A gate the person is part-way through reading counts as work: it cost them a submission and a wait.
  const unsaved = typing || gateOpen || flow.stage === 'resolving' || flow.stage === 'needsHelp' || flow.stage === 'aiReview';
  useEffect(() => {
    onUnsavedWork?.(unsaved);
  }, [onUnsavedWork, unsaved]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">What did you eat?</h1>

      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="entry-text" className="sr-only">What you ate</label>
        <input
          id="entry-text"
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. two hot dogs and a cola"
          autoComplete="off"
          className="min-h-14 flex-1 rounded-xl border-2 border-slate-400 dark:border-slate-500 px-3 text-lg"
        />
        <button type="submit" className="min-h-14 rounded-xl bg-slate-900 dark:bg-slate-100 px-6 text-lg text-white dark:text-slate-900">Log</button>
      </form>

      {!scanning && (
        <button
          type="button"
          onClick={() => { setEditorName(null); setScanning(true); }}
          className="min-h-12 w-full rounded-xl border border-slate-400 dark:border-slate-500 px-4 text-base"
        >
          Scan a barcode
        </button>
      )}

      {scanning && (
        <ScanBarcode
          {...(scan ? { deps: scan } : {})}
          onClose={() => setScanning(false)}
          onEnterManually={() => { setScanning(false); setEditorName(''); }}
          onLog={(food, grams, text) => {
            setScanning(false);
            setDraft('');
            void flow.submitKnownFood(food, grams, text);
          }}
        />
      )}

      {flow.stage === 'resolving' && <p className="text-sm text-slate-600 dark:text-slate-400">Checking&hellip;</p>}
      {flow.error && !gateOpen && <p role="alert" className="text-sm text-red-800 dark:text-red-300">{flow.error}</p>}

      {editorName !== null && (
        <section className="rounded-xl border-2 border-slate-400 dark:border-slate-500 p-3">
          <FoodEditor
            initialName={editorName.charAt(0).toUpperCase() + editorName.slice(1)}
            onCancel={() => setEditorName(null)}
            onSaved={(saved) => {
              setEditorName(null);
              // The food now exists, so the same text can resolve. Opened from a scan that found nothing there is
              // no earlier text, so the new food's own name is put in the box ready to log.
              if (flow.lastText.trim() !== '') void flow.submit(flow.lastText);
              else setDraft(saved.name);
            }}
          />
        </section>
      )}

      {flow.stage === 'needsHelp' && editorName === null && (
        <section className="space-y-3 rounded-xl border-2 border-slate-400 dark:border-slate-500 p-3">
          {flow.dataMissing ? (
            <p>The food database could not be loaded, so nothing could be matched. Nothing has been saved.</p>
          ) : flow.unresolved.length > 0 ? (
            <p>
              I don&rsquo;t know {flow.unresolved.map((u) => `“${u.foodQuery}”`).join(', ')} yet. Nothing has been saved.
            </p>
          ) : (
            <p>I couldn&rsquo;t find a food in that. Nothing has been saved.</p>
          )}
          {flow.aiRefused && (
            <p data-testid="ai-refused" className="text-sm text-slate-700 dark:text-slate-300">
              The AI helper was asked but the service refused the request, so it could not read this; adding it yourself still works.
            </p>
          )}
          {flow.lines.length > 0 && <ResolvedLines lines={flow.lines} />}
          <div className="flex flex-col gap-2">
            {flow.unresolved.map((u) => (
              <button
                key={u.rawFragment}
                type="button"
                onClick={() => setEditorName(u.foodQuery)}
                className="min-h-12 rounded-lg border border-slate-400 dark:border-slate-500 px-4 text-left"
              >
                Add &ldquo;{u.foodQuery}&rdquo; as my own food
              </button>
            ))}
            {isAiEnabled() && (
              <button
                type="button"
                onClick={() => { setDishTried(true); void flow.tryDish().then((ok) => { if (!ok) setDishFailed(true); }); }}
                disabled={dishTried}
                className="min-h-12 rounded-lg border border-slate-400 dark:border-slate-500 px-4 text-left disabled:opacity-50"
              >
                It&rsquo;s a dish &mdash; work out what&rsquo;s in it
              </button>
            )}
            {dishFailed && (
              <p role="alert" className="text-sm">
                That could not be broken down either. Adding it yourself still works.
              </p>
            )}
            <button type="button" onClick={() => setEditorName('')} className="min-h-12 rounded-lg border border-slate-400 dark:border-slate-500 px-4 text-left">
              Enter the nutrition manually
            </button>
            {flow.lines.length > 0 && (
              <button type="button" onClick={() => void flow.continueWithout()} className="min-h-12 rounded-lg border border-slate-400 dark:border-slate-500 px-4 text-left">
                Log the rest without it
              </button>
            )}
            <button type="button" onClick={flow.edit} className="min-h-11 text-left text-sm underline">Change what I typed</button>
          </div>
        </section>
      )}

      {flow.stage === 'aiReview' && (
        <section data-testid="ai-review" className="space-y-3 rounded-xl border-2 border-slate-400 dark:border-slate-500 p-3">
          <p className="font-medium">
            I didn&rsquo;t recognise part of that, so DeepSeek (an AI) was asked to read it. Please check its reading before anything is checked or saved.
          </p>
          <ul className="space-y-1">
            {flow.aiReadings.map((r) => (
              <li key={r.phrase} className="text-sm">
                You typed &ldquo;{r.phrase}&rdquo;. The AI described it as &ldquo;{r.description}&rdquo;, which matches {r.reads.join(' and ')} in the database.
              </li>
            ))}
          </ul>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            The AI only described your words; the food was then found in the database. The amounts below come from the database, not from the AI.
          </p>
          {flow.lines.length > 0 && <ResolvedLines lines={flow.lines} />}
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => void flow.acceptAi()} className="min-h-12 rounded-lg bg-slate-900 dark:bg-slate-100 px-4 text-left text-white dark:text-slate-900">
              Use this reading
            </button>
            <button type="button" onClick={flow.rejectAi} className="min-h-12 rounded-lg border border-slate-400 dark:border-slate-500 px-4 text-left">
              Don&rsquo;t use it
            </button>
            <button type="button" onClick={flow.edit} className="min-h-11 text-left text-sm underline">Change what I typed</button>
          </div>
        </section>
      )}

      {flow.outcome && (
        <section role="status" data-testid="outcome" className="space-y-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3">
          {flow.outcome.action === 'added' ? (
            <>
              <p className="font-medium">Added.</p>
              <ResolvedLines lines={flow.outcome.lines} />
              <CheckNotes failures={flow.outcome.failures} />
            </>
          ) : (
            <p>Cancelled. It is kept in your history as cancelled and is not counted in any total.</p>
          )}
          <button type="button" onClick={flow.dismissOutcome} className="min-h-11 text-sm underline">Dismiss</button>
        </section>
      )}

      {recent.length > 0 && (
        <section aria-label="Recent entries">
          <h2 className="text-sm font-semibold uppercase text-slate-600 dark:text-slate-400">Recent</h2>
          <ul>
            {recent.map((e) => (
              <EntryRow
                key={e.id}
                entry={e}
                onRelog={(t) => {
                  setDraft(t);
                  setEditorName(null);
                  void flow.submit(t);
                }}
              />
            ))}
          </ul>
        </section>
      )}

      {gateOpen && <WarningGate flow={flow} />}
    </main>
  );
}
