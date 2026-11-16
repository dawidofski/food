import { useState } from 'react';
import BehaviourHistory from './BehaviourHistory';
import Missing from './Missing';
import Trends from './Trends';

type View = 'missing' | 'trends' | 'history';

const VIEWS: { id: View; label: string }[] = [
  { id: 'missing', label: 'Missing' },
  { id: 'trends', label: 'Trends' },
  { id: 'history', label: 'Warning history' },
];

/**
 * One bottom-nav tab for the three views that look back over the diary. It opens on "Missing", the screen this tab
 * replaced, so nothing a person already knows has moved.
 */
export default function Progress() {
  const [view, setView] = useState<View>('missing');
  return (
    <>
      <div role="group" aria-label="Progress views" className="mx-auto grid w-full max-w-xl grid-cols-3 gap-1 px-4 pt-4">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={view === v.id}
            onClick={() => setView(v.id)}
            className={`min-h-12 rounded-lg border px-1 text-sm ${view === v.id ? 'border-slate-900 dark:border-slate-100 bg-slate-100 dark:bg-slate-800 font-semibold' : 'border-slate-300 dark:border-slate-700'}`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === 'missing' && <Missing />}
      {view === 'trends' && <Trends />}
      {view === 'history' && <BehaviourHistory />}
    </>
  );
}
