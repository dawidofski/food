import { useState } from 'react';
import BatchBuilder from './BatchBuilder';
import MyFoods from './MyFoods';

type View = 'batches' | 'mine';

const VIEWS: { id: View; label: string }[] = [
  { id: 'batches', label: 'Batches' },
  { id: 'mine', label: 'My foods' },
];

/**
 * The foods the person keeps, rather than the ones they ate: what they cooked in batches, and the foods they
 * entered themselves.
 *
 * Two screens on one destination, in the same shape `TrendsTab` uses, so the two tabs behave the same way. It
 * exists because the nav is four icons wide (§A2.5): merging these two is what pays for that. Neither screen's
 * behaviour changes.
 */
export default function Food({ onLogPortion }: { onLogPortion: (text: string) => void }) {
  const [view, setView] = useState<View>('batches');
  return (
    <>
      <div role="group" aria-label="Food views" className="mx-auto grid w-full max-w-xl grid-cols-2 gap-1 px-4 pt-4">
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
      {view === 'batches' && <BatchBuilder onLogPortion={onLogPortion} />}
      {view === 'mine' && <MyFoods />}
    </>
  );
}
