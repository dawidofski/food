import { useEffect, useRef, useState } from 'react';
import { getProfile } from '@/data/db';
import { backupOnOpen } from '@/state/fileBackup';
import { isSetupSkipped, skipSetup } from '@/state/setup';
import FirstRun from '@/ui/screens/FirstRun';
import Diary from '@/ui/screens/Diary';
import TrendsTab from '@/ui/screens/TrendsTab';
import Food from '@/ui/screens/Food';
import Settings from '@/ui/screens/Settings';
import LogOverlay from '@/ui/components/LogOverlay';
import NavIcon, { type NavIconName } from '@/ui/components/NavIcon';

type Tab = 'diary' | 'trends' | 'food' | 'settings';

/** The four destinations, in order. Each name is the control's accessible name; the icon carries none. */
const TABS: { id: Tab; label: string; icon: NavIconName }[] = [
  { id: 'diary', label: 'Diary', icon: 'diary' },
  { id: 'trends', label: 'Trends', icon: 'trends' },
  { id: 'food', label: 'Food', icon: 'food' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('diary');
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
  /**
   * The automatic backup, once per opening of the app.
   *
   * Here rather than in Settings because it must happen whether or not that screen is ever visited, and it runs
   * once per mount: a tab left open for a week backs up when it is opened, not every time the clock passes
   * midnight. It never asks for anything — there is no tap behind an app opening — so a lapsed permission is
   * left for Settings to report and offer a button for. It cannot block the diary, so nothing waits on it and a
   * failure is swallowed here; `backupOnOpen` already records nothing unless the write finished, and Settings
   * reads that stamp to say what really happened.
   */
  useEffect(() => {
    void backupOnOpen().catch(() => undefined);
  }, []);

  /** Set when a portion is picked from the fridge list, so the log opens with it typed in. The gate still runs. */
  const [draft, setDraft] = useState('');
  const [logOpen, setLogOpen] = useState(false);
  /** Bumped when the log sheet closes, so the diary behind it re-reads rather than showing a stale day. */
  const [loggedAt, setLoggedAt] = useState(0);
  const logButton = useRef<HTMLButtonElement | null>(null);

  const openLog = (text = '') => {
    setDraft(text);
    setLogOpen(true);
  };

  if (setup === 'loading') return null;
  if (setup === 'needed') {
    return <FirstRun onDone={() => setSetup('done')} onSkip={() => { skipSetup(); setSetup('done'); }} />;
  }

  // Not over Settings: that screen holds erase, export and the profile, and a button offering to add food has no
  // business floating over any of them.
  const showLogButton = tab !== 'settings';

  return (
    <>
      {tab === 'diary' && <Diary reloadToken={loggedAt} />}
      {tab === 'trends' && <TrendsTab />}
      {tab === 'food' && <Food onLogPortion={(text) => openLog(text)} />}
      {tab === 'settings' && (
        <Settings
          onErased={() => {
            setDraft('');
            setLogOpen(false);
            setTab('diary');
            setSetup(isSetupSkipped() ? 'done' : 'needed');
          }}
        />
      )}

      {/*
        Room beneath the last thing on the page, so the floating button never sits over a control the person is
        reaching for. A smaller z-index would not do it: the button has to stay above the page to be reachable,
        so the page has to end above the button.
      */}
      {showLogButton && <div aria-hidden="true" className="h-24" />}

      {showLogButton && (
        <button
          ref={logButton}
          type="button"
          aria-label="Log what you ate"
          onClick={() => openLog('')}
          className="fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full border border-slate-900 dark:border-slate-100 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-lg"
        >
          <NavIcon name="log" className="h-7 w-7" />
        </button>
      )}

      <LogOverlay open={logOpen} initialDraft={draft} onClose={() => { setLogOpen(false); setLoggedAt((n) => n + 1); }} returnFocusTo={logButton} />

      <nav aria-label="Main" className="sticky bottom-0 z-20 flex border-t border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-label={t.label}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => { setDraft(''); setTab(t.id); }}
            className={`min-h-14 flex-1 flex items-center justify-center ${tab === t.id ? 'text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}
          >
            <NavIcon name={t.icon} />
          </button>
        ))}
      </nav>
    </>
  );
}
