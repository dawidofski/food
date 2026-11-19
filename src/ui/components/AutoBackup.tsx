import { useCallback, useEffect, useState } from 'react';
import {
  backupNow,
  canWriteToAFile,
  chooseBackupFile,
  currentBackupFile,
  getLastFileBackupAt,
  stopFileBackup,
  type BackupState,
} from '@/state/fileBackup';

/**
 * The automatic backup, as the owner sees it: pick one file, and the app overwrites it with the latest diary
 * each time the app is opened, at most once a day.
 *
 * Every sentence here is about something that happened, not something arranged. The date shown is the moment a
 * write FINISHED — the app learns that from `close()` returning, which is more than a download can ever tell it.
 * When the browser has stopped letting the app write without asking, this says so and offers the tap, because a
 * screen that quietly said "on" while nothing was being written would be worse than no feature at all.
 */

const btn = 'min-h-11 rounded-lg border border-slate-400 dark:border-slate-500 px-4';

const fmt = (d: Date): string =>
  `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} at ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;

export default function AutoBackup() {
  const supported = canWriteToAFile();
  const [file, setFile] = useState<{ name: string; chosenAt: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [last, setLast] = useState<Date | null>(null);
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  const refresh = useCallback(() => {
    void currentBackupFile()
      .then((f) => setFile(f ?? null))
      .catch(() => setFile(null))
      .finally(() => {
        setLast(getLastFileBackupAt());
        setLoaded(true);
      });
  }, []);
  useEffect(refresh, [refresh]);

  /** One place turns an outcome into a sentence, so no two paths can describe the same result differently. */
  const report = (r: BackupState | undefined) => {
    if (r === undefined) return; // The picker was closed without choosing. Not an error, so nothing is said.
    if (r.state === 'written') setNote({ kind: 'ok', text: `Saved to ${r.name}.` });
    else if (r.state === 'needs-permission') {
      setNote({ kind: 'error', text: `This browser is not letting the app write to ${r.name} without being asked. Nothing was saved.` });
    } else if (r.state === 'failed') setNote({ kind: 'error', text: `Nothing was saved: ${r.reason}.` });
    else if (r.state === 'off') setNote({ kind: 'error', text: 'No file is set up, so nothing was saved.' });
    else if (r.state === 'unsupported') setNote({ kind: 'error', text: 'This browser cannot write to a file you choose.' });
    refresh();
  };

  const run = (fn: () => Promise<BackupState | undefined>) => {
    setBusy(true);
    setNote(null);
    void fn()
      .then(report)
      .catch((err: unknown) => setNote({ kind: 'error', text: `Nothing was saved: ${err instanceof Error ? err.message : String(err)}.` }))
      .finally(() => setBusy(false));
  };

  if (!loaded) return null;

  return (
    <div className="space-y-2 border-t border-slate-300 dark:border-slate-700 pt-3">
      <h3 className="text-base font-semibold">Automatic backup</h3>

      {!supported ? (
        <p className="text-sm">
          This browser cannot write to a file you choose, so there is nothing to switch on here. Chrome on Android
          and on a computer can; Firefox cannot. Use <strong>Export everything</strong> above instead.
        </p>
      ) : file === null ? (
        <>
          <p className="text-sm">
            Choose one file and the app will overwrite it with your whole diary when you open the app, at most once
            a day. One file, always the latest — nothing piles up.
          </p>
          <button type="button" disabled={busy} onClick={() => run(chooseBackupFile)} className={`${btn} disabled:opacity-50`}>
            {busy ? 'Saving…' : 'Choose where to save it'}
          </button>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Put it somewhere outside this browser — your Downloads folder, or a folder that syncs to Drive. A copy
            kept inside the browser is gone with everything else if the browser clears its storage.
          </p>
        </>
      ) : (
        <>
          <p data-testid="auto-backup-status" className="text-sm">
            {last === null
              ? `${file.name} is set up, but nothing has been written to it yet.`
              : `Last written to ${file.name} on ${fmt(last)}.`}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            This is a completed write, not a file handed to the browser: the app waited for it to finish. It happens
            when you open the app and a day has passed — nothing can run while the app is closed, so if you do not
            open it for a week, the file stays a week old.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => run(backupNow)} className={`${btn} disabled:opacity-50`}>
              {busy ? 'Saving…' : 'Back up now'}
            </button>
            <button type="button" disabled={busy} onClick={() => run(chooseBackupFile)} className={`${btn} disabled:opacity-50`}>
              Use a different file
            </button>
            {!confirmStop ? (
              <button type="button" disabled={busy} onClick={() => setConfirmStop(true)} className={`${btn} disabled:opacity-50`}>
                Stop
              </button>
            ) : (
              <button
                type="button"
                autoFocus
                disabled={busy}
                onClick={() => {
                  void stopFileBackup()
                    .then(() => { setConfirmStop(false); setNote({ kind: 'ok', text: `Stopped. ${file.name} is left where it is, holding the last backup written to it.` }); refresh(); })
                    .catch(() => setNote({ kind: 'error', text: 'That could not be stopped.' }));
                }}
                className={`${btn} disabled:opacity-50`}
              >
                Stop backing up
              </button>
            )}
          </div>
        </>
      )}

      {note && (
        <p role="alert" className={`text-sm ${note.kind === 'error' ? 'text-red-800 dark:text-red-300' : ''}`}>
          {note.text}
        </p>
      )}
    </div>
  );
}
