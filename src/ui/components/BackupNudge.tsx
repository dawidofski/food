import { useEffect, useState } from 'react';
import { countActiveEntries } from '@/data/db';
import { dismissNudge, isBackupNudgeDue } from '@/state/backupReminder';
import { downloadBackup } from '@/state/exportDownload';

/**
 * A reminder, on the diary, that this is the only copy.
 *
 * Deliberately NOT on the log screen: interrupting someone mid-entry to talk about housekeeping is the pattern
 * this app refuses everywhere else. The diary is where someone is already looking back rather than typing.
 *
 * The wording states the mechanism (one browser, site data, an unused phone browser clearing it) and stops. No
 * streak, no count of days, no blame, and no claim that exporting makes anything safe — see
 * `src/state/backupReminder.ts` for why the app cannot say that.
 *
 * It appears only when the diary is worth copying and nothing has been copied lately; dismissing silences it for
 * a week and exporting for a week too. Every storage read behind that decision is wrapped, and the count comes from
 * IndexedDB: if either is unavailable the reminder simply does not appear and the diary is unaffected.
 */
export default function BackupNudge({
  now = () => new Date(),
  countEntries = countActiveEntries,
}: {
  now?: () => Date;
  countEntries?: () => Promise<number>;
}) {
  const [due, setDue] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    countEntries()
      .then((n) => {
        if (live) setDue(isBackupNudgeDue(n, now()));
      })
      .catch(() => {
        // The diary could not be counted. Saying nothing is better than reminding someone about data we
        // cannot even see.
        if (live) setDue(false);
      });
    return () => {
      live = false;
    };
  }, [countEntries, now]);

  if (!due) return null;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await downloadBackup(now());
      setDue(false);
    } catch (err) {
      setError(`The copy could not be created: ${err instanceof Error ? err.message : 'unknown error'}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="backup-nudge-h"
      data-testid="backup-nudge"
      className="space-y-3 rounded-xl border-2 border-slate-400 dark:border-slate-500 bg-slate-50 dark:bg-slate-900 p-3"
    >
      <h2 id="backup-nudge-h" className="text-base font-semibold text-slate-900 dark:text-slate-100">
        Make a copy of this diary
      </h2>
      <p className="text-sm text-slate-900 dark:text-slate-100">
        This diary is stored only in this browser. Clearing the browser&rsquo;s site data deletes it, and a phone
        browser may remove it on its own when the app goes unused for a while. A copy is the only way back.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="nudge-export"
          disabled={busy}
          onClick={() => void run()}
          className="min-h-12 rounded-lg bg-slate-900 dark:bg-slate-100 px-4 text-white dark:text-slate-900 disabled:opacity-50"
        >
          {busy ? 'Making a copy…' : 'Export a copy now'}
        </button>
        <button
          type="button"
          data-testid="nudge-dismiss"
          onClick={() => {
            dismissNudge(now());
            setDue(false);
          }}
          className="min-h-12 rounded-lg border border-slate-400 dark:border-slate-500 px-4 text-slate-900 dark:text-slate-100"
        >
          Not now
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-800 dark:text-red-300">{error}</p>}
    </section>
  );
}
