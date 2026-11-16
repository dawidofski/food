import { useEffect, useMemo, useState } from 'react';
import { allEntriesIncludingTombstones } from '@/data/db';
import { localDayKey } from '@/domain/dayBoundary';
import { behaviourHistory, type ActionCounts } from '@/domain/behaviour';
import { catalogue } from '@/rules/catalogue';
import type { Rule } from '@/rules/types';
import type { DiaryEntry } from '@/types/diary';

/**
 * What was recorded when a warning was shown. Counts of saved entries, stated plainly. It is not a scoreboard: there is
 * no rate, percentage, grade, streak or comparison to a target, and no wording that says a choice was right or wrong.
 *
 * A cancelled entry means the entry was not added to the diary. The app does not know whether the food was then eaten
 * or the entry simply not logged, so nothing here says the food was avoided.
 */

export type BehaviourDeps = {
  now: () => Date;
  store: { allEntries: () => Promise<DiaryEntry[]> };
  rules: Rule[];
};

export const defaultBehaviourDeps: BehaviourDeps = {
  now: () => new Date(),
  store: { allEntries: allEntriesIncludingTombstones },
  rules: catalogue,
};

const PERIODS: { label: string; days: number | null }[] = [
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '12 months', days: 365 },
  { label: 'All time', days: null },
];

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function dayText(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function monthText(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

/** "5 entries had this warning shown. 2 were added, 1 was added after looking at the alternatives, and 2 were recorded as cancelled." */
function ruleSentence(c: ActionCounts): string {
  const was = (n: number) => (n === 1 ? 'was' : 'were');
  const parts: string[] = [];
  if (c.added > 0) parts.push(`${c.added} ${was(c.added)} added`);
  if (c.addedAfterAlternatives > 0) parts.push(`${c.addedAfterAlternatives} ${was(c.addedAfterAlternatives)} added after looking at the alternatives`);
  if (c.cancelled > 0) parts.push(`${c.cancelled} ${was(c.cancelled)} recorded as cancelled`);
  const joined = parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
  return `${plural(c.shown, 'entry had', 'entries had')} this warning shown. ${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
}

function monthLine(m: { month: string } & ActionCounts): string {
  const bits = [`shown ${m.shown}`];
  if (m.added > 0) bits.push(`added ${m.added}`);
  if (m.addedAfterAlternatives > 0) bits.push(`added after alternatives ${m.addedAfterAlternatives}`);
  if (m.cancelled > 0) bits.push(`cancelled ${m.cancelled}`);
  return bits.join(' · ');
}

export default function BehaviourHistory({ deps = defaultBehaviourDeps }: { deps?: BehaviourDeps }) {
  const [state, setState] = useState<DiaryEntry[] | 'loading' | 'error'>('loading');
  const [days, setDays] = useState<number | null>(90);
  const todayKey = localDayKey(deps.now());

  useEffect(() => {
    let live = true;
    deps.store
      .allEntries()
      .then((rows) => live && setState(rows))
      .catch(() => live && setState('error'));
    return () => {
      live = false;
    };
  }, [deps]);

  // Re-aggregated only when the rows, the period or the day change, never on an unrelated render.
  const history = useMemo(
    () => (Array.isArray(state) ? behaviourHistory(state, deps.now(), { days }) : null),
    [state, days, todayKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (state === 'loading') return <main className="mx-auto w-full max-w-xl p-4"><p className="text-sm">Loading&hellip;</p></main>;
  if (state === 'error' || history === null) {
    return (
      <main className="mx-auto w-full max-w-xl p-4">
        <p role="alert" className="text-sm">The diary could not be read, so nothing is shown here. Nothing has been lost.</p>
      </main>
    );
  }

  const title = (id: string): string => deps.rules.find((r) => r.id === id)?.title ?? id;

  return (
    <main className="mx-auto min-h-screen w-full max-w-xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Warning history</h1>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        Each time a warning was shown, the app stored what happened next. This page counts what was stored, nothing more.
        A cancelled entry was not added to your diary. The app cannot tell whether the food was then eaten or you chose not to log it,
        so a cancelled entry says nothing about what you ate.
      </p>

      <div role="group" aria-label="Period" className="grid grid-cols-4 gap-1">
        {PERIODS.map((p) => (
          <button
            key={p.label}
            type="button"
            aria-pressed={p.days === days}
            onClick={() => setDays(p.days)}
            className={`min-h-12 rounded-lg border px-1 text-sm ${p.days === days ? 'border-slate-900 dark:border-slate-100 bg-slate-100 dark:bg-slate-800 font-semibold' : 'border-slate-300 dark:border-slate-700'}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {history.sinceKey === null ? (
        <p className="text-base">Nothing is recorded in this period.</p>
      ) : (
        <p className="text-base">
          {`Since ${dayText(history.sinceKey)}: ${plural(history.entriesInPeriod, 'entry', 'entries')} recorded, and a warning was shown for ${history.entriesWithWarnings}.`}
        </p>
      )}

      {history.sinceKey !== null && history.rules.length === 0 && <p className="text-base">No warnings were shown in this period.</p>}

      {history.rules.map((r) => (
        <section
          key={r.ruleId}
          aria-labelledby={`rule-${r.ruleId}`}
          className="space-y-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3"
        >
          <h2 id={`rule-${r.ruleId}`} className="text-lg font-semibold">{title(r.ruleId)}</h2>
          <p className="text-base">{ruleSentence(r)}</p>
          {r.months.length > 1 && (
            <ul aria-label="By month" className="text-sm">
              {r.months.map((m) => (
                <li key={m.month} className="flex justify-between gap-2 border-b border-slate-200 dark:border-slate-800 py-1">
                  <span>{monthText(m.month)}</span>
                  <span className="text-right">{monthLine(m)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </main>
  );
}
