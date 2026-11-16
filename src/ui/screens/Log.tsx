import { useEffect, useState, type FormEvent } from 'react';
import { useHoldUpdates } from '@/state/updates';
import { defaultDeps, useEntryFlow, type FlowDeps } from '@/state/useEntryFlow';
import type { DiaryEntry } from '@/types/diary';
import EntryRow from '@/ui/components/EntryRow';
import WarningGate, { CheckNotes, ResolvedLines } from './WarningGate';
import { FoodEditor } from './MyFoods';

const RECENT_LIMIT = 8;

export default function Log({ deps = defaultDeps, initialDraft = '' }: { deps?: FlowDeps; initialDraft?: string }) {
  const flow = useEntryFlow(deps);
  const [draft, setDraft] = useState(initialDraft);
  const [recent, setRecent] = useState<DiaryEntry[]>([]);
  /** The name to start the editor with, or null when the editor is closed. */
  const [editorName, setEditorName] = useState<string | null>(null);

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

  // Typed text and an open food editor are unsaved work too.
  useHoldUpdates(draft.trim() !== '' || editorName !== null);

  const gateOpen = flow.stage === 'gate' || flow.stage === 'questions';

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
          className="min-h-14 flex-1 rounded-xl border-2 border-slate-400 px-3 text-lg"
        />
        <button type="submit" className="min-h-14 rounded-xl bg-slate-900 px-6 text-lg text-white">Log</button>
      </form>

      {flow.stage === 'resolving' && <p className="text-sm text-slate-600">Checking&hellip;</p>}
      {flow.error && !gateOpen && <p role="alert" className="text-sm text-red-800">{flow.error}</p>}

      {flow.stage === 'needsHelp' && editorName !== null && (
        <section className="rounded-xl border-2 border-slate-400 p-3">
          <FoodEditor
            initialName={editorName.charAt(0).toUpperCase() + editorName.slice(1)}
            onCancel={() => setEditorName(null)}
            onSaved={() => {
              setEditorName(null);
              // The food now exists, so the same text can resolve.
              void flow.submit(flow.lastText);
            }}
          />
        </section>
      )}

      {flow.stage === 'needsHelp' && editorName === null && (
        <section className="space-y-3 rounded-xl border-2 border-slate-400 p-3">
          {flow.dataMissing ? (
            <p>The food database could not be loaded, so nothing could be matched. Nothing has been saved.</p>
          ) : flow.unresolved.length > 0 ? (
            <p>
              I don&rsquo;t know {flow.unresolved.map((u) => `“${u.foodQuery}”`).join(', ')} yet. Nothing has been saved.
            </p>
          ) : (
            <p>I couldn&rsquo;t find a food in that. Nothing has been saved.</p>
          )}
          {flow.lines.length > 0 && <ResolvedLines lines={flow.lines} />}
          <div className="flex flex-col gap-2">
            {flow.unresolved.map((u) => (
              <button
                key={u.rawFragment}
                type="button"
                onClick={() => setEditorName(u.foodQuery)}
                className="min-h-12 rounded-lg border border-slate-400 px-4 text-left"
              >
                Add &ldquo;{u.foodQuery}&rdquo; as my own food
              </button>
            ))}
            <button type="button" onClick={() => setEditorName('')} className="min-h-12 rounded-lg border border-slate-400 px-4 text-left">
              Enter the nutrition manually
            </button>
            {flow.lines.length > 0 && (
              <button type="button" onClick={() => void flow.continueWithout()} className="min-h-12 rounded-lg border border-slate-400 px-4 text-left">
                Log the rest without it
              </button>
            )}
            <button type="button" onClick={flow.edit} className="min-h-11 text-left text-sm underline">Change what I typed</button>
          </div>
        </section>
      )}

      {flow.stage === 'aiReview' && (
        <section data-testid="ai-review" className="space-y-3 rounded-xl border-2 border-slate-400 p-3">
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
          <p className="text-sm text-slate-700">
            The AI only described your words; the food was then found in the database. The amounts below come from the database, not from the AI.
          </p>
          {flow.lines.length > 0 && <ResolvedLines lines={flow.lines} />}
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => void flow.acceptAi()} className="min-h-12 rounded-lg bg-slate-900 px-4 text-left text-white">
              Use this reading
            </button>
            <button type="button" onClick={flow.rejectAi} className="min-h-12 rounded-lg border border-slate-400 px-4 text-left">
              Don&rsquo;t use it
            </button>
            <button type="button" onClick={flow.edit} className="min-h-11 text-left text-sm underline">Change what I typed</button>
          </div>
        </section>
      )}

      {flow.outcome && (
        <section role="status" data-testid="outcome" className="space-y-2 rounded-xl border border-slate-300 bg-slate-50 p-3">
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
          <h2 className="text-sm font-semibold uppercase text-slate-600">Recent</h2>
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
