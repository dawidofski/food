import { useState } from 'react';
import type { Citation, Evidence, Level, WarningCard as Card } from '@/rules/types';

/** §9.2. INFO is neutral grey and collapsed; MODERATE amber with one line; HIGH orange expanded; CRITICAL red, cannot collapse. */
const TREATMENT: Record<Level, { box: string; badge: string; label: string }> = {
  INFO: {
    box: 'border-slate-300 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
    badge: 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100', label: 'Info' },
  MODERATE: {
    box: 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
    badge: 'bg-amber-200 text-amber-950 dark:bg-amber-900 dark:text-amber-100', label: 'Moderate' },
  HIGH: {
    box: 'border-orange-400 bg-orange-50 text-orange-950 dark:border-orange-700 dark:bg-orange-950/60 dark:text-orange-100',
    badge: 'bg-orange-200 text-orange-950 dark:bg-orange-800 dark:text-orange-50', label: 'High' },
  CRITICAL: {
    box: 'border-red-600 bg-red-50 text-red-950 dark:border-red-500 dark:bg-red-950/80 dark:text-red-100',
    badge: 'bg-red-600 text-white', label: 'Critical' },
};

const startsOpen = (l: Level): boolean => l === 'HIGH' || l === 'CRITICAL';

function firstSentence(s: string): string {
  const m = /^.*?[.!?](?=\s|$)/s.exec(s.trim());
  return m ? m[0] : s;
}

function CitationBlock({ c }: { c: Citation }) {
  return (
    <p className="mt-1 text-xs">
      <a href={c.url} target="_blank" rel="noreferrer" className="underline">
        {c.publisher}, {c.title} ({c.year})
      </a>
      <span className="block italic">&ldquo;{c.conclusion}&rdquo;</span>
    </p>
  );
}

function EvidenceLine({ e }: { e: Evidence }) {
  return (
    <p className="mt-2 text-xs font-medium">
      Evidence strength: {e.strength}
      <span aria-hidden> · </span>
      <span>{e.body}</span>
    </p>
  );
}

export default function WarningCard({ card }: { card: Card }) {
  const t = TREATMENT[card.level];
  const collapsible = card.level !== 'CRITICAL';
  const [open, setOpen] = useState(startsOpen(card.level));
  const expanded = !collapsible || open;

  return (
    <section
      data-testid="warning-card"
      data-level={card.level}
      aria-label={`${t.label}: ${card.title}`}
      className={`rounded-xl border-2 p-3 ${t.box}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold uppercase ${t.badge}`}>{t.label}</span>
          <h3 className="mt-1 text-base font-semibold">{card.title}</h3>
        </div>
        {collapsible && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setOpen(!open)}
            className="min-h-11 shrink-0 rounded px-3 text-sm underline"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>

      {!expanded && card.level === 'MODERATE' && <p className="mt-1 truncate text-sm">{firstSentence(card.concern)}</p>}

      {expanded && (
        <div className="mt-2 text-sm">
          <p>{card.concern}</p>
          {card.cause && <p className="mt-2">{card.cause}</p>}
          <p className="mt-2">{card.evidence.summary}</p>
          {card.portionNote && <p className="mt-2 font-medium">{card.portionNote}</p>}
          {card.dataNote && <p className="mt-2 text-xs italic">{card.dataNote}</p>}
          <EvidenceLine e={card.evidence} />
          <CitationBlock c={card.evidence.citation} />
          {(card.evidence.supportingCitations ?? []).map((c) => (
            <CitationBlock key={c.url + c.title} c={c} />
          ))}

          {card.merged.map((m) => (
            <div key={m.ruleId} data-testid="merged-claim" className="mt-3 border-t border-current/20 pt-2">
              <p>{m.concern}</p>
              {m.portionNote && <p className="mt-1 font-medium">{m.portionNote}</p>}
              <p className="mt-1">{m.evidence.summary}</p>
              <EvidenceLine e={m.evidence} />
              <CitationBlock c={m.citation} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
