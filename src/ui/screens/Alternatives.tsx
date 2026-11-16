import type { WarningCard } from '@/rules/types';

/**
 * Swaps with the comparison that matters for the rule that fired. Every swap is a rule-declared alternative that
 * carries its own citation; the rules hold no dataset food ids, so none is looked up here and no figure is invented.
 */
export default function Alternatives({
  cards, onBack, onAddAnyway, onCancel,
}: { cards: WarningCard[]; onBack: () => void; onAddAnyway: () => void; onCancel: () => void }) {
  const groups = cards.filter((c) => c.alternatives.length > 0);
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Healthier alternatives</h2>
      {groups.length === 0 && (
        <p className="text-sm">There are no sourced alternatives for this entry. Nothing is suggested without a source.</p>
      )}
      {groups.map((c) => (
        <section key={c.ruleId} data-testid="alternatives-group" className="rounded-xl border border-slate-300 p-3">
          <h3 className="font-medium">{c.title}</h3>
          <ul className="mt-2 space-y-3">
            {c.alternatives.map((a) => (
              <li key={a.label} className="text-sm">
                <p className="font-medium">{a.label}</p>
                <p>{a.reason}</p>
                <p className="mt-1 text-xs">
                  <a href={a.citation.url} target="_blank" rel="noreferrer" className="underline">
                    {a.citation.publisher}, {a.citation.title} ({a.citation.year})
                  </a>
                  <span className="block italic">&ldquo;{a.citation.conclusion}&rdquo;</span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={onBack} className="min-h-12 rounded-lg border border-slate-400 px-4">Back to warnings</button>
        <button type="button" onClick={onAddAnyway} className="min-h-12 rounded-lg bg-slate-900 px-4 text-white">Add anyway</button>
        <button type="button" onClick={onCancel} className="min-h-12 rounded-lg border border-slate-400 px-4">Cancel</button>
      </div>
    </div>
  );
}
