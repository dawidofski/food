import { useState } from 'react';
import { eraseEverything } from '@/data/db';
import { exportAll, importAll } from '@/data/exportImport';
import { localDayKey } from '@/domain/dayBoundary';

/** Backup (export and import) and erase everything. The export is the person's only backup. */

const btn = 'min-h-11 rounded-lg border border-slate-400 px-4';
const section = 'space-y-3 rounded-xl border-2 border-slate-400 p-3';

export function BackupSettings({ onImported }: { onImported: () => void }) {
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [file, setFile] = useState<File | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const doExport = async () => {
    try {
      const blob = await exportAll();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `food-diary-${localDayKey(new Date())}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setMessage({ kind: 'ok', text: 'Backup file created. Keep it somewhere outside this browser.' });
    } catch (err) {
      setMessage({ kind: 'error', text: `The backup could not be created: ${err instanceof Error ? err.message : 'unknown error'}.` });
    }
  };

  const run = async () => {
    if (!file) return;
    if (mode === 'replace' && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }
    setBusy(true);
    setConfirmReplace(false);
    try {
      const { added, skipped } = await importAll(file, mode);
      setMessage({ kind: 'ok', text: `Imported. ${added} added, ${skipped} already here and left as they were.` });
      setFile(null);
      onImported();
    } catch (err) {
      setMessage({ kind: 'error', text: `${err instanceof Error ? err.message : 'The import failed.'} Nothing was changed.` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="backup-h" className={section}>
      <h2 id="backup-h" className="text-lg font-semibold">Backup</h2>
      <p className="text-sm">
        Everything is stored in this browser only, and a browser can clear its own storage. Export a file now and then and keep it
        elsewhere. The file holds your diary (including deleted and corrected entries), your own foods, batches, profile and settings.
        It does not include your DeepSeek key.
      </p>
      <button type="button" onClick={() => void doExport()} className={btn}>Export everything</button>

      <div className="space-y-2 border-t border-slate-300 pt-3">
        <label htmlFor="import-file" className="block text-sm font-medium">Import file</label>
        <input
          id="import-file"
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setConfirmReplace(false);
            setMessage(null);
          }}
          className="block w-full text-sm"
        />
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">How to import</legend>
          <label className="flex min-h-11 items-center gap-2 text-base">
            <input type="radio" name="import-mode" checked={mode === 'merge'} onChange={() => { setMode('merge'); setConfirmReplace(false); }} className="size-5" />
            Merge
          </label>
          <label className="flex min-h-11 items-center gap-2 text-base">
            <input type="radio" name="import-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} className="size-5" />
            Replace
          </label>
          <p className="text-sm">
            {mode === 'merge'
              ? 'Merge adds what is missing here and leaves everything already on this device exactly as it is.'
              : 'Replace replaces everything on this device with the contents of the file.'}
          </p>
        </fieldset>
        {confirmReplace && (
          <p className="text-sm font-medium">This will replace your whole diary on this device with the file. Press the button again to confirm.</p>
        )}
        <button type="button" disabled={!file || busy} onClick={() => void run()} className={`${btn} disabled:opacity-50`}>
          Import
        </button>
      </div>
      {message && (message.kind === 'error'
        ? <p role="alert" className="text-sm text-red-800">{message.text}</p>
        : <p role="status" className="text-sm">{message.text}</p>)}
    </section>
  );
}

export function EraseSettings({ onErased }: { onErased?: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const erase = async () => {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await eraseEverything();
      setDone(true);
      setConfirming(false);
      onErased?.();
    } catch (err) {
      // Never reported as success: part of the data may still be here.
      setConfirming(false);
      setError(
        `Erasing did not complete: ${err instanceof Error ? err.message : 'storage refused'}. Some of your data, such as your profile, may still be stored in this browser. Do not treat this device as clean.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="erase-h" className={`${section} border-red-300`}>
      <h2 id="erase-h" className="text-lg font-semibold">Erase everything</h2>
      {!confirming ? (
        <>
          <p className="text-sm">Deletes your diary, your own foods, batches, profile, weight log and settings from this device.</p>
          <button type="button" onClick={() => { setConfirming(true); setDone(false); setError(null); }} className={btn}>Erase everything</button>
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-base font-medium">
            This permanently deletes your diary, your own foods, batches, profile, weight log, settings and your DeepSeek key from this
            device. It cannot be undone. Export a backup first if you want to keep anything.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void erase()} className="min-h-12 rounded-lg bg-red-700 px-4 text-white disabled:opacity-50">
              Yes, erase everything
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="min-h-12 rounded-lg border border-slate-400 px-4">
              Cancel
            </button>
          </div>
        </div>
      )}
      {done && <p role="status" className="text-sm">Everything has been erased from this device.</p>}
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    </section>
  );
}
