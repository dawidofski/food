import { useEffect, useState, type FormEvent } from 'react';
import { loadDatasetMeta, type DatasetMeta } from '@/data/foodRepository';
import { clearApiKey, getApiKey, isAiSwitchedOn, maskKey, setAiSwitch, setApiKey } from '@/state/aiSettings';
import { BackupSettings, EraseSettings, StorageSettings } from './DataSettings';
import ProfileSettings from './ProfileSettings';
import ThemeSettings from './ThemeSettings';

/**
 * Settings: body data and targets, the optional DeepSeek fallback, backup and erase. The fallback is off until a key
 * is entered and the person turns it on, and what it sends is stated here, above the control that enables it.
 */
export default function Settings({ onErased }: { onErased?: () => void }) {
  /** Bumped after an import or an erase, so every section re-reads what is now stored. */
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  return (
    <main className="mx-auto min-h-screen w-full max-w-xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <ThemeSettings key={`theme-${version}`} />
      <ProfileSettings key={`profile-${version}`} />
      <AiSettings key={`ai-${version}`} />
      <BackupSettings onImported={refresh} />
      <StorageSettings />
      <DataSourceSettings />
      <EraseSettings onErased={() => { refresh(); onErased?.(); }} />
    </main>
  );
}

function AiSettings() {
  const [key, setKey] = useState<string | null>(() => getApiKey());
  const [on, setOn] = useState<boolean>(() => isAiSwitchedOn());
  const [draft, setDraft] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = (e: FormEvent) => {
    e.preventDefault();
    try {
      setApiKey(draft);
      if (getApiKey() === null) return;
      // Saving is the consent: the disclosure above this button says exactly what will be sent.
      setAiSwitch(true);
      setKey(getApiKey());
      setOn(true);
      setDraft('');
      setReplacing(false);
      setError(null);
    } catch {
      setError('The key could not be saved: this browser is not allowing local storage.');
    }
  };

  const toggle = (next: boolean) => {
    try {
      setAiSwitch(next);
      setOn(next);
      setError(null);
    } catch {
      setError('That could not be saved: this browser is not allowing local storage.');
    }
  };

  const remove = () => {
    clearApiKey();
    setKey(null);
    setOn(false);
    setDraft('');
    setReplacing(false);
  };

  const showForm = key === null || replacing;

  return (
    <>
      <section aria-labelledby="ai-heading" className="space-y-3 rounded-xl border-2 border-slate-400 dark:border-slate-500 p-3">
        <h2 id="ai-heading" className="text-lg font-semibold">AI help for foods I can&rsquo;t match</h2>
        <p className="text-sm">
          Optional, and off by default. When a food you type is not in the database, the app can ask DeepSeek, an AI service, what it means.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            The text of the one phrase it could not match is sent to DeepSeek, a third party outside your device, and is handled under
            DeepSeek&rsquo;s own data policy.
          </li>
          <li>
            Only the phrase it could not match is sent, and nothing else. If nothing you typed could be matched at all,
            the whole line you typed is sent instead, cut to its first 200 characters. Your diary, your profile, your
            targets and your totals are never sent.
          </li>
          <li>
            The AI never supplies nutrition and never picks a food. It only describes what your word means; the app then searches its own database, every number comes from that database, and you check the reading before anything is saved.
          </li>
          <li>Your key stays in this browser only. It is not part of the app&rsquo;s code and is removed if you erase everything.</li>
        </ul>

        {key !== null && (
          <div className="space-y-2">
            <p className="text-sm">
              Key saved: <code data-testid="masked-key" className="rounded bg-slate-100 dark:bg-slate-800 px-1">{maskKey(key)}</code>
            </p>
            <label className="flex min-h-11 items-center gap-2 text-base">
              <input
                type="checkbox"
                checked={on}
                onChange={(e) => toggle(e.target.checked)}
                className="size-6"
              />
              Use DeepSeek for foods I can&rsquo;t match
            </label>
            <div className="flex flex-wrap gap-2">
              {!replacing && (
                <button type="button" onClick={() => setReplacing(true)} className="min-h-11 rounded-lg border border-slate-400 dark:border-slate-500 px-4">
                  Replace key
                </button>
              )}
              <button type="button" onClick={remove} className="min-h-11 rounded-lg border border-slate-400 dark:border-slate-500 px-4">
                Clear key
              </button>
            </div>
          </div>
        )}

        {showForm && (
          <form onSubmit={save} className="space-y-2">
            <label htmlFor="deepseek-key" className="block text-sm font-medium">DeepSeek API key</label>
            <input
              id="deepseek-key"
              type="password"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="min-h-12 w-full rounded-lg border-2 border-slate-400 dark:border-slate-500 px-3"
            />
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={draft.trim() === ''} className="min-h-12 rounded-lg bg-slate-900 dark:bg-slate-100 px-4 text-white dark:text-slate-900 disabled:opacity-50">
                Save key and turn on DeepSeek
              </button>
              {replacing && (
                <button type="button" onClick={() => { setReplacing(false); setDraft(''); }} className="min-h-12 rounded-lg border border-slate-400 dark:border-slate-500 px-4">
                  Keep the current key
                </button>
              )}
            </div>
          </form>
        )}

        {error && <p role="alert" className="text-sm text-red-800 dark:text-red-300">{error}</p>}
      </section>
    </>
  );
}

/** Where the numbers come from, and what the app cannot check. Read from the bundled data's own meta.json. */
function DataSourceSettings() {
  const [meta, setMeta] = useState<DatasetMeta | null>(null);
  useEffect(() => {
    let live = true;
    void loadDatasetMeta().then((m) => { if (live) setMeta(m); });
    return () => { live = false; };
  }, []);
  return (
    <section aria-labelledby="data-heading" data-testid="data-source" className="space-y-2 rounded-xl border-2 border-slate-400 dark:border-slate-500 p-3">
      <h2 id="data-heading" className="text-lg font-semibold">Where the food numbers come from</h2>
      {meta ? (
        <>
          <p className="text-sm">{meta.citation}</p>
          {meta.release && <p className="text-sm">Release: {meta.release}.</p>}
        </>
      ) : (
        <p className="text-sm">The data source details could not be loaded.</p>
      )}
      <p className="text-sm">These are US survey foods, so a food from another country may match a different product or none.</p>
      <p data-testid="trans-fat-limit" className="text-sm">
        This food data records no trans fat for any of its foods, so the app cannot check trans fat in anything you log
        from it. The trans fat warning can still appear for a food you add yourself, if you enter a trans fat figure.
      </p>
    </section>
  );
}
