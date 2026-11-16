import { useEffect, useState } from 'react';
import { getProfile } from '@/data/db';
import { isSetupSkipped, skipSetup } from '@/state/setup';
import FirstRun from '@/ui/screens/FirstRun';
import Diary from '@/ui/screens/Diary';
import Progress from '@/ui/screens/Progress';
import BatchBuilder from '@/ui/screens/BatchBuilder';
import Log from '@/ui/screens/Log';
import MyFoods from '@/ui/screens/MyFoods';
import Settings from '@/ui/screens/Settings';

type Tab = 'log' | 'diary' | 'progress' | 'batches' | 'foods' | 'settings';

export default function App() {
  const [tab, setTab] = useState<Tab>('log');
  /**
   * First run asks for a profile, but only once: it is skippable because the app works on general adult targets
   * without one, and a skip is remembered.
   */
  const [setup, setSetup] = useState<'loading' | 'needed' | 'done'>('loading');
  useEffect(() => {
    let live = true;
    void getProfile().then((p) => {
      if (live) setSetup(p !== null || isSetupSkipped() ? 'done' : 'needed');
    });
    return () => {
      live = false;
    };
  }, []);
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
  if (setup === 'loading') return null;
  if (setup === 'needed') {
    return <FirstRun onDone={() => setSetup('done')} onSkip={() => { skipSetup(); setSetup('done'); }} />;
  }
  return (
    <>
      {tab === 'log' && <Log key={draft} initialDraft={draft} />}
      {tab === 'diary' && <Diary />}
      {tab === 'progress' && <Progress />}
      {tab === 'batches' && <BatchBuilder onLogPortion={(text) => { setDraft(text); setTab('log'); }} />}
      {tab === 'foods' && <MyFoods />}
      {tab === 'settings' && <Settings onErased={() => { setDraft(''); setTab('log'); setSetup(isSetupSkipped() ? 'done' : 'needed'); }} />}
      <nav aria-label="Main" className="sticky bottom-0 flex border-t border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950">
        {tabBtn('log', 'Log')}
        {tabBtn('diary', 'Diary')}
        {tabBtn('progress', 'Progress')}
        {tabBtn('batches', 'Batches')}
        {tabBtn('foods', 'My foods')}
        {tabBtn('settings', 'Settings')}
      </nav>
    </>
  );
}
