/**
 * Day boundaries are the device's LOCAL days. Everything here uses local getters
 * (getFullYear/getMonth/getDate) and never `toISOString().slice(0, 10)`, which is the UTC date and
 * would put an evening entry on the wrong day for a user east or west of Greenwich.
 */

const pad = (n: number): string => String(n).padStart(2, '0');

function keyOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `YYYY-MM-DD` in the device's local zone. A string with an offset or Z is converted to local time first. */
export function localDayKey(at: Date | string): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  if (!Number.isFinite(d.getTime())) throw new RangeError(`Invalid datetime: ${String(at)}`);
  return keyOf(d);
}

function parseDayKey(dayKey: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) throw new RangeError(`Invalid day key: ${dayKey}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const check = new Date(y, m - 1, d);
  // Rejects overflow such as 2026-02-30, which Date would silently roll into March.
  if (check.getFullYear() !== y || check.getMonth() !== m - 1 || check.getDate() !== d) {
    throw new RangeError(`Invalid day key: ${dayKey}`);
  }
  return { y, m, d };
}

/**
 * Inclusive UTC ISO bounds of one local day: local midnight to one millisecond before the next local
 * midnight. Built from `toISOString()`, so the store reads them as the instants they are (a bare
 * local string would be re-parsed by the store). A DST day is 23 or 25 hours long, never 24 by assumption.
 */
export function localDayRange(dayKey: string): { fromISO: string; toISO: string } {
  const { y, m, d } = parseDayKey(dayKey);
  const from = new Date(y, m - 1, d);
  const nextMidnight = new Date(y, m - 1, d + 1);
  return {
    fromISO: from.toISOString(),
    toISO: new Date(nextMidnight.getTime() - 1).toISOString(),
  };
}

/** Seven consecutive local day keys, oldest first, ending on the local day of `on`. */
export function last7DayKeys(on: Date): string[] {
  if (!Number.isFinite(on.getTime())) throw new RangeError('Invalid date');
  const keys: string[] = [];
  for (let back = 6; back >= 0; back--) {
    // Noon, so a DST shift at midnight cannot move the date.
    keys.push(keyOf(new Date(on.getFullYear(), on.getMonth(), on.getDate() - back, 12)));
  }
  return keys;
}
