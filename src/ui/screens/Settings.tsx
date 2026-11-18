import { useEffect, useState, type FormEvent } from 'react';
import { loadDatasetMeta, type DatasetMeta } from '@/data/foodRepository';
import { clearApiKey, getApiKey, isAiSwitchedOn, isLabelPhotoSwitchedOn, maskKey, setAiSwitch, setApiKey, setLabelPhotoSwitch } from '@/state/aiSettings';
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
      <BarcodeSettings />
      <EraseSettings onErased={() => { refresh(); onErased?.(); }} />
    </main>
  );
}

function AiSettings() {
  const [key, setKey] = useState<string | null>(() => getApiKey());
  const [on, setOn] = useState<boolean>(() => isAiSwitchedOn());
  const [labelOn, setLabelOn] = useState<boolean>(() => isLabelPhotoSwitchedOn());
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
            Two other things can be sent, each only when you ask for it by tapping a button. Asking what a dish is
            made of sends the whole line you typed, up to 200 characters, even the part that was already matched.
            Reading a recipe on the batches screen sends the text you pasted there, up to 2,000 characters. Nothing
            is sent in either case unless you tap the button.
          </li>
          <li>
            The AI never supplies nutrition and never picks a food. It only describes what your word means; the app then searches its own database, every number comes from that database, and you check the reading before anything is saved.
          </li>
          <li>Your key stays in this browser only. It is not part of the app&rsquo;s code and is removed if you erase everything.</li>
        </ul>

        {/*
          The disclosure comes BEFORE the control, and the control is its own, because agreeing to send a word
          is not agreeing to send a photograph. A picture can carry a kitchen, a face, a hand, an address on a
          letter behind the packet — things a food word cannot.
        */}
        {key !== null && on && (
        <div data-testid="label-photo-setting" className="space-y-2 rounded-lg border border-slate-300 dark:border-slate-700 p-3">
          <h3 className="text-base font-semibold">Reading a nutrition label from a photo</h3>
          <p className="text-sm">
            With this on, you can photograph the nutrition table on a packet and the app will fill in a food
            from it. <strong>The photograph itself is sent to DeepSeek</strong>, a third party outside your
            device, and is handled under their data policy. A photograph can show more than you intend: what
            is behind the packet, your hand, your kitchen. Point it at the label and nothing else.
          </p>
          <p className="text-sm">
            It reads only the per 100 g or per 100 ml column, never a per-serving one, because mixing the two
            would be wrong by the serving ratio. A figure the label does not print is left blank, never zero.
            Every figure is shown to you to check, and the food is saved as one of your own, marked
            self-reported, exactly as if you had typed it in.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={labelOn}
              onChange={(e) => {
                setLabelOn(e.target.checked);
                setLabelPhotoSwitch(e.target.checked);
              }}
              className="h-5 w-5"
            />
            Let me photograph a nutrition label
          </label>
        </div>
        )}

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

/**
 * Open Food Facts: what it is, what a lookup sends, and the two standing rulings about what this app will not
 * take from it. Sits beside "Where the food numbers come from", because it is the second place the numbers in
 * this diary can come from. The privacy paragraph is written to the same standard as the DeepSeek disclosure
 * above: it says exactly what leaves the device.
 */
function BarcodeSettings() {
  return (
    <section aria-labelledby="off-heading" data-testid="off-source" className="space-y-2 rounded-xl border-2 border-slate-400 dark:border-slate-500 p-3">
      <h2 id="off-heading" className="text-lg font-semibold">Barcodes and Open Food Facts</h2>
      <p className="text-sm">
        Scanning a barcode when you log something looks the product up in Open Food Facts, a public database of food
        products. It is crowdsourced: anyone can add or change any product, the figures were copied off a packet by
        a member of the public rather than measured in a laboratory, and they may be wrong, stale or incomplete.
        Anything logged from a scan is marked &ldquo;Open Food Facts&rdquo; wherever it appears, with the date the
        product was last edited there.
      </p>
      <p className="text-sm">
        <strong>What a lookup sends:</strong> only the barcode, and nothing else. Your diary, your profile, your
        targets and your totals are not sent, and nothing that identifies you goes with the request &mdash; no
        account, no key, no cookie and no name. Each scan is one request. Products you have scanned are kept on this device so the
        same barcode is never asked for twice, and they are removed when you erase everything.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li>
          <strong>Added sugars are never taken from it.</strong> Open Food Facts records 0 g of added sugar for
          products that plainly contain it &mdash; a cola, a chocolate biscuit &mdash; and a zero here would be read
          as a known figure and would silence the added-sugar warning. Added sugar is left unknown for every scanned
          product. Total sugars are read.
        </li>
        <li>
          <strong>Vitamins, minerals and trans fat are not read from it</strong>, so they are unknown for a scanned
          product rather than zero.
        </li>
        <li>
          <strong>An empty allergen list is not an all-clear.</strong> The allergen lists there are contributed by
          the public and are often empty for products that do contain the allergen. If you have flagged an allergen,
          a scanned product always comes with a note saying it could not be fully checked. Read the packet.
        </li>
        <li>
          The app cannot tell from Open Food Facts whether a product is red or processed meat, so those two warnings
          do not appear for anything scanned.
        </li>
      </ul>
      <p className="text-sm">
        Product data from Open Food Facts is made available under the{' '}
        <a className="underline" href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer noopener">
          Open Database License (ODbL) 1.0
        </a>
        , and individual contents under the{' '}
        <a className="underline" href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noreferrer noopener">
          Database Contents License 1.0
        </a>
        . Open Food Facts is at{' '}
        <a className="underline" href="https://world.openfoodfacts.org/" target="_blank" rel="noreferrer noopener">
          openfoodfacts.org
        </a>
        .
      </p>
    </section>
  );
}
