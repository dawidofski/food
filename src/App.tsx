import { useState } from 'react';
import Diary from '@/ui/screens/Diary';
import Missing from '@/ui/screens/Missing';
import BatchBuilder from '@/ui/screens/BatchBuilder';
import Log from '@/ui/screens/Log';
import MyFoods from '@/ui/screens/MyFoods';

type Tab = 'log' | 'diary' | 'missing' | 'batches' | 'foods';

export default function App() {
  const [tab, setTab] = useState<Tab>('log');
  /** Set when a portion is picked from the fridge list, so the log opens with it typed in. The gate still runs. */
  const [draft, setDraft] = useState('');
  const tabBtn = (id: Tab, label: string) => (
    <button
      type="button"
      aria-current={tab === id ? 'page' : undefined}
      onClick={() => { setDraft(''); setTab(id); }}
      className={`min-h-12 flex-1 text-sm ${tab === id ? 'font-semibold underline' : ''}`}
    >
      {label}
    </button>
  );
  return (
    <>
      {tab === 'log' && <Log key={draft} initialDraft={draft} />}
      {tab === 'diary' && <Diary />}
      {tab === 'missing' && <Missing />}
      {tab === 'batches' && <BatchBuilder onLogPortion={(text) => { setDraft(text); setTab('log'); }} />}
      {tab === 'foods' && <MyFoods />}
      <nav aria-label="Main" className="sticky bottom-0 flex border-t border-slate-300 bg-white">
        {tabBtn('log', 'Log')}
        {tabBtn('diary', 'Diary')}
        {tabBtn('missing', 'Missing')}
        {tabBtn('batches', 'Batches')}
        {tabBtn('foods', 'My foods')}
      </nav>
    </>
  );
}
