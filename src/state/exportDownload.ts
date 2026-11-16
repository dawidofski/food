import { exportAll } from '@/data/exportImport';
import { localDayKey } from '@/domain/dayBoundary';
import { recordExportOffered } from '@/state/backupReminder';

/**
 * The one way a copy leaves the app: build the file, hand it to the browser, and record the moment it was offered.
 *
 * Both the Settings button and the diary's reminder go through here, so there is exactly one place where "a copy
 * was made" is decided and recorded. The timestamp is written only after the download has been handed over without
 * throwing: an export that failed must leave no trace, or the reminder would go quiet about a copy that was never
 * made.
 */
export async function downloadBackup(now: Date = new Date()): Promise<void> {
  const blob = await exportAll();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `food-diary-${localDayKey(now)}.json`;
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    // The anchor never stays in the page, and the blob URL is released even when the click threw. Ten seconds is
    // long enough for the browser to have started reading the blob.
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  recordExportOffered(now);
}
