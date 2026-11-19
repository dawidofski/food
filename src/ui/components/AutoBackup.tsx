import { useCallback, useEffect, useState } from 'react';
import {
  backupNow,
  backupStatus,
  chooseBackupFile,
  defaultBackupDeps,
  stopFileBackup,
  type BackupDeps,
  type BackupState,
  type BackupStatus,
} from '@/state/fileBackup';

/**
 * The automatic backup, as the owner sees it: pick one file, and the app overwrites it with the latest diary
 * each time the app is opened, at most once a day.
 *
 * Every sentence here is about something that happened, not something arranged. The date shown is the moment a
 * write FINISHED, read from the file's own row — so it cannot be printed beside a different file's name.
 *
 * It also says when the backup is NOT running. Chrome takes its write permission back after the app has been in
 * the background a while, and the app cannot ask for it again without a tap. A screen that kept showing an old
 * date beside "it happens when you open the app" would leave the owner to work out for himself that the date
 * had stopped moving, which is the same as lying to him slowly.
 */

const btn = 'min-h-11 rounded-lg border border-slate-400 dark:border-slate-500 px-4';

const fmt = (d: Date): string =>
  `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} at ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;

/** "today", "yesterday", "11 days ago" — so a backup that quietly stopped is obvious at a glance. */
const ago = (d: Date, now: Date): string => {
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
};

export default function AutoBackup({ deps = defaultBackupDeps }: { deps?: BackupDeps } = {}) {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  const refresh = useCallback(() => {
    void backupStatus(deps)
      .then(setStatus)
      .catch(() => setStatus({ kind: 'off' }));
  }, [deps]);
  useEffect(refresh, [refresh]);

  /** One place turns an outcome into a sentence, so no two paths can describe the same result differently. */
  const report = (r: BackupState | undefined) => {
    if (r === undefined) return; // The picker was closed without choosing. Not an error, so nothing is said.
    if (r.state === 'written') setNote({ kind: 'ok', text: `Saved to ${r.name}.` });
    else if (r.state === 'needs-permission') {
      setNote({ kind: 'error', text: `This browser would not let the app write to ${r.name}. Nothing was saved.` });
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
      .catch(() => setNote({ kind: 'error', text: 'Nothing was saved: the write did not finish.' }))
      .finally(() => setBusy(false));
  };

  if (status === null) return null;

  const heading = <h3 className="text-base font-semibold">Automatic backup</h3>;

  if (status.kind === 'unsupported') {
    return (
      <div className="space-y-2 border-t border-slate-300 dark:border-slate-700 pt-3">
        {heading}
        <p className="text-sm">
          This browser cannot write to a file you choose, so there is nothing to switch on here. Chrome on
          Android and on a computer can; Firefox cannot. Use <strong>Export everything</strong> above instead.
        </p>
      </div>
    );
  }

  const alert = note && (
    <p role="alert" className={`text-sm ${note.kind === 'error' ? 'text-red-800 dark:text-red-300' : ''}`}>
      {note.text}
    </p>
  );

  if (status.kind === 'off') {
    return (
      <div className="space-y-2 border-t border-slate-300 dark:border-slate-700 pt-3">
        {heading}
        <p className="text-sm">
          Choose one file and the app will overwrite it with your whole diary when you open the app, at most once
          a day. One file, always the latest — nothing piles up.
        </p>
        <button type="button" disabled={busy} onClick={() => run(() => chooseBackupFile(new Date(), deps))} className={`${btn} disabled:opacity-50`}>
          {busy ? 'Saving…' : 'Choose where to save it'}
        </button>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Put it somewhere outside this browser — your Downloads folder, or a folder that syncs to Drive. A copy
          kept inside the browser is gone with everything else if the browser clears its storage. Remember that
          the file holds your profile too: your height, date of birth, sex and weight log.
        </p>
        {/* Also here: stopping lands on this view, and the sentence saying the file was left alone belongs with it. */}
        {alert}
      </div>
    );
  }

  const now = new Date();
  const last = status.lastWrittenAt;

  return (
    <div className="space-y-2 border-t border-slate-300 dark:border-slate-700 pt-3">
      {heading}

      <p data-testid="auto-backup-status" className="text-sm">
        {last === null
          ? `${status.name} is set up, but nothing has been written to it yet.`
          : `Last written to ${status.name} on ${fmt(last)} — ${ago(last, now)}.`}
      </p>

      {status.kind === 'blocked' ? (
        <p data-testid="auto-backup-blocked" className="text-sm text-red-800 dark:text-red-300">
          It is not running now. This browser is asking to be allowed again before the app may write to that
          file, and it cannot ask you while it is only being opened. Tap <strong>Back up now</strong> to allow it
          and save straight away.
        </p>
      ) : (
        <p className="text-xs text-slate-600 dark:text-slate-400">
          This is a completed write, not a file handed to the browser: the app waited for it to finish. It
          happens when you open the app and a day has passed — nothing can run while the app is closed, so if
          you do not open it for a week, the file stays a week old. Chrome may also ask to be allowed again
          after a while, and this will say so when it does.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => run(() => backupNow(deps))} className={`${btn} disabled:opacity-50`}>
          {busy ? 'Saving…' : 'Back up now'}
        </button>
        <button type="button" disabled={busy} onClick={() => run(() => chooseBackupFile(new Date(), deps))} className={`${btn} disabled:opacity-50`}>
          Use a different file
        </button>
        {!confirmStop ? (
          <button type="button" disabled={busy} onClick={() => setConfirmStop(true)} className={`${btn} disabled:opacity-50`}>
            Stop
          </button>
        ) : (
          <>
            <button
              type="button"
              autoFocus
              disabled={busy}
              onClick={() => {
                void stopFileBackup(deps)
                  .then(() => {
                    setConfirmStop(false);
                    setNote({ kind: 'ok', text: `Stopped. ${status.name} is left where it is, holding the last backup written to it.` });
                    refresh();
                  })
                  .catch(() => setNote({ kind: 'error', text: 'That could not be stopped.' }));
              }}
              className={`${btn} disabled:opacity-50`}
            >
              Stop backing up
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirmStop(false)} className={`${btn} disabled:opacity-50`}>
              Keep it on
            </button>
          </>
        )}
      </div>

      {alert}
    </div>
  );
}
