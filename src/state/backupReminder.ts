import { lsKey } from '@/data/db';

/**
 * When a copy of the diary was last OFFERED, and when the owner last waved the reminder away.
 *
 * The app cannot know that a backup exists. It knows only that it built the file and handed it to the browser:
 * the download may have been cancelled, saved to a folder that is itself in this browser's sandbox, or deleted
 * five minutes later. So nothing here is called "backed up" and nothing claims the data is safe. The stored
 * moment is the moment a copy was MADE AND OFFERED, and every sentence built on it says only that.
 *
 * Both keys go through `lsKey`, so `eraseEverything`'s prefix sweep removes them without being told about them.
 * Every read and write is wrapped: in a private window or with site data blocked, localStorage throws on access,
 * and a reminder about losing data must never be the thing that breaks the diary.
 */

export const LAST_EXPORT_KEY = lsKey('lastExportAt');
export const NUDGE_DISMISSED_KEY = lsKey('backupNudgeDismissedAt');

/** Below this, there is not enough diary to be worth nagging anybody about. */
export const MIN_ENTRIES_FOR_NUDGE = 20;
/** A copy made inside this window silences the reminder. */
export const EXPORT_SILENCE_DAYS = 30;
/** "Not now" means not now, for this long. */
export const DISMISS_SILENCE_DAYS = 7;

const DAY_MS = 86_400_000;

function readStamp(key: string): Date | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    // Storage is blocked. We know nothing, which is the same position as never having exported.
    return null;
  }
  if (raw === null || raw === '') return null;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? new Date(t) : null;
}

function writeStamp(key: string, at: Date): void {
  try {
    localStorage.setItem(key, at.toISOString());
  } catch {
    /* Not remembered. The reminder comes back, which is the harmless direction to fail in. */
  }
}

/** When a copy was last built and handed to the browser, or null: never, unreadable, or storage blocked. */
export function getLastExportAt(): Date | null {
  return readStamp(LAST_EXPORT_KEY);
}

/** Call only once the file has actually been handed over; a failed export must leave no trace. */
export function recordExportOffered(at: Date = new Date()): void {
  writeStamp(LAST_EXPORT_KEY, at);
}

export function getNudgeDismissedAt(): Date | null {
  return readStamp(NUDGE_DISMISSED_KEY);
}

export function dismissNudge(at: Date = new Date()): void {
  writeStamp(NUDGE_DISMISSED_KEY, at);
}

/**
 * A stamp this far ahead of `now` is not clock skew, it is a wrong value. Hours of drift are ordinary; a day is not.
 */
const FUTURE_TOLERANCE_MS = DAY_MS;

/**
 * Days from `then` to `now`, with a stamp slightly in the future counting as "just now" rather than as a negative
 * age. A clock that moved backwards is not a reason to start nagging someone who exported this morning.
 */
function daysSince(then: Date, now: Date): number {
  return Math.max(0, (now.getTime() - then.getTime()) / DAY_MS);
}

/**
 * A stamp more than a day in the future is unusable, and is treated as if there were none.
 * Clamping it to "just now" instead would silence the reminder for as long as that date stays ahead — a corrupted
 * or hand-edited value could switch it off for years, in silence. Discarding it fails the other way: the reminder
 * reappears, which costs a tap. Settings prints the stored date, so a nonsense value is visible there.
 */
function olderThan(stamp: Date | null, days: number, now: Date): boolean {
  if (stamp === null) return true;
  if (stamp.getTime() - now.getTime() > FUTURE_TOLERANCE_MS) return true;
  return daysSince(stamp, now) >= days;
}

/**
 * True when the diary is big enough to be worth a copy, no copy has been offered in the last 30 days, and the
 * reminder was not dismissed in the last 7. An unreadable or absent stamp counts as "never", so blocked storage
 * shows the reminder rather than hiding it: being told twice costs a tap, being told never costs the diary.
 */
export function isBackupNudgeDue(entryCount: number, now: Date = new Date()): boolean {
  if (entryCount < MIN_ENTRIES_FOR_NUDGE) return false;
  return (
    olderThan(getLastExportAt(), EXPORT_SILENCE_DAYS, now) &&
    olderThan(getNudgeDismissedAt(), DISMISS_SILENCE_DAYS, now)
  );
}
