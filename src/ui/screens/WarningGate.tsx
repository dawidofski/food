import type { EntryFlow, ResolvedLine } from '@/state/useEntryFlow';
import type { RuleFailure } from '@/rules/types';
import SelfReportedBadge from '@/ui/components/SelfReportedBadge';
import WarningCard from '@/ui/components/WarningCard';
import { fmtGrams } from '@/ui/format';
import Alternatives from './Alternatives';

function fmtCount(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '?';
}

/** What each item resolved to. This is the person's only check against a near-miss match, so it is never hidden. */
export function ResolvedLines({ lines }: { lines: ResolvedLine[] }) {
  return (
    <ul className="space-y-2">
      {lines.map((l, i) => (
        <li key={`${l.name}-${i}`} data-testid="resolved-line" className="text-sm">
          <p className="text-base font-semibold">
            {l.count !== undefined && `${fmtCount(l.count)} × `}
            {l.name}
            {l.portionLabel !== undefined &&
              ` (${l.portionLabel}${l.perPortionGrams !== undefined ? `, ${fmtGrams(l.perPortionGrams)} each` : ''})`}
            {` — ${fmtGrams(l.grams)}`}
            {l.source === 'custom' && <SelfReportedBadge />}
          </p>
          {l.unusual && (
            <p data-testid="unusual-serving" className="mt-1 rounded-lg border border-amber-400 bg-amber-50 p-2 text-amber-950">
              {l.count !== undefined && l.portionLabel !== undefined ? `${fmtCount(l.count)} × ${l.portionLabel} ` : ''}
              {l.name}, {fmtGrams(l.grams)} — is that right?{' '}
              {l.unusual.kind === 'huge' && 'That is over 1 kg for one item.'}
              {l.unusual.kind === 'tiny' && 'That is under 5 g.'}
              {l.unusual.kind === 'small-share' &&
                `That is under a fifth of the largest portion listed for this food (${fmtGrams(l.unusual.largestPortionGrams ?? 0)}).`}{' '}
              The serving was picked for you from a bare count. Use &ldquo;Change what I typed&rdquo; and give a weight, for
              example &ldquo;300 g&rdquo;, to correct it.
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A check that could not run. Informational and never blocking; a safety check is named plainly. */
export function CheckNotes({ failures }: { failures: RuleFailure[] }) {
  if (failures.length === 0) return null;
  return (
    <div data-testid="check-note" role="note" className="rounded-lg border border-slate-400 bg-slate-50 p-2 text-sm text-slate-900">
      {failures.map((f) => (
        <p key={f.ruleId + f.message}>
          {f.category === 'safety'
            ? f.ruleId === 'allergen'
              ? `We could not check this entry for your flagged allergens: ${f.message}.`
              : `We could not run a safety check on this entry (${f.ruleId}): ${f.message}.`
            : `One check did not run (${f.ruleId}): ${f.message}.`}
        </p>
      ))}
    </div>
  );
}

const btn = 'min-h-12 rounded-lg border border-slate-400 px-4 text-base';

export default function WarningGate({ flow }: { flow: EntryFlow }) {
  const asking = flow.stage === 'questions';
  return (
    <div className="fixed inset-0 z-10 flex items-end justify-center bg-black/40" data-testid="warning-gate">
      <div
        role="dialog"
        aria-label="Before this is saved"
        className="max-h-[92vh] w-full max-w-xl space-y-3 overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl"
      >
        {flow.viewingAlternatives ? (
          <Alternatives cards={flow.cards} onBack={flow.backToGate} onAddAnyway={() => void flow.addAnyway()} onCancel={() => void flow.cancel()} />
        ) : (
          <>
            <ResolvedLines lines={flow.lines} />
            <CheckNotes failures={flow.failures} />

            {asking &&
              flow.questions.map((q) => (
                <div key={q.answerKey} role="group" aria-label={q.question} className="rounded-xl border-2 border-slate-400 p-3">
                  <p className="text-base font-medium">{q.question}</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" className={`${btn} flex-1`} onClick={() => flow.answer(q.answerKey, true)}>Yes</button>
                    <button type="button" className={`${btn} flex-1`} onClick={() => flow.answer(q.answerKey, false)}>No</button>
                  </div>
                </div>
              ))}

            {flow.cards.map((c) => (
              <WarningCard key={c.ruleId} card={c} />
            ))}

            {flow.error && <p role="alert" className="text-sm text-red-800">{flow.error}</p>}

            <div className="flex flex-col gap-2">
              {!asking && (
                <button type="button" onClick={() => void flow.addAnyway()} className={`${btn} bg-slate-900 text-white`}>
                  Add anyway
                </button>
              )}
              {!asking && flow.cards.length > 0 && (
                <button type="button" onClick={flow.showAlternatives} className={btn}>
                  Show healthier alternatives
                </button>
              )}
              <button type="button" onClick={() => void flow.cancel()} className={btn}>
                Cancel
              </button>
              <button type="button" onClick={flow.edit} className="min-h-11 text-sm underline">
                Change what I typed
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
