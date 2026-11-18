import { useState } from 'react';
import BehaviourHistory from './BehaviourHistory';
import Missing from './Missing';
import WeekTrends from './WeekTrends';
import WeightView from './WeightView';

type View = 'weight' | 'gaps' | 'week' | 'history';

/**
 * The tab is called Trends, so no view inside it may also be called Trends: a person cannot say where something
 * is when two things share a name. The weekly nutrient view is "This week"; what used to be the Missing screen
 * keeps the job it has left and is named for it.
 */
const VIEWS: { id: View; label: string }[] = [
  { id: 'weight', label: 'Weight' },
  { id: 'gaps', label: 'Worth a look' },
  { id: 'week', label: 'This week' },
  { id: 'history', label: 'Warning history' },
];

/**
 * One bottom-nav tab for the views that look back over the diary. It opens on "Worth a look", which is where the
 * old Missing screen's remaining job lives, so nothing a person already knows has moved.
 */
export default function TrendsTab() {
  const [view, setView] = useState<View>('weight');
  return (
    <>
      <div role="group" aria-label="Trends views" className="mx-auto grid w-full max-w-xl grid-cols-2 gap-1 px-4 pt-4">
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
      {view === 'weight' && <WeightView />}
      {view === 'gaps' && <Missing />}
      {view === 'week' && <WeekTrends />}
      {view === 'history' && <BehaviourHistory />}
    </>
  );
}
