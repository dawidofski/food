import { afterEach, describe, expect, test, vi } from 'vitest';
import { lsKey } from '@/data/db';
import {
  DISMISS_SILENCE_DAYS,
  EXPORT_SILENCE_DAYS,
  LAST_EXPORT_KEY,
  MIN_ENTRIES_FOR_NUDGE,
  NUDGE_DISMISSED_KEY,
  dismissNudge,
  getLastExportAt,
  isBackupNudgeDue,
  recordExportOffered,
} from '@/state/backupReminder';

/** The nudge's decision, as a function of what is stored. The screen is tested in tests/ui/backupNudge.test.tsx. */

const DAY = 86_400_000;
const now = new Date('2026-11-16T10:00:00Z');
const ago = (days: number) => new Date(now.getTime() - days * DAY);

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('where the keys live', () => {
  test('both keys carry the app prefix, so the erase sweep finds them', () => {
    expect(LAST_EXPORT_KEY).toBe(lsKey('lastExportAt'));
    expect(NUDGE_DISMISSED_KEY).toBe(lsKey('backupNudgeDismissedAt'));
  });
});

describe('recording that a copy was offered', () => {
  test('stores an ISO timestamp and reads it back', () => {
    recordExportOffered(now);
    expect(localStorage.getItem(LAST_EXPORT_KEY)).toBe(now.toISOString());
    expect(getLastExportAt()?.getTime()).toBe(now.getTime());
  });

  test('a missing or unreadable stamp reads as "no copy ever"', () => {
    expect(getLastExportAt()).toBeNull();
    localStorage.setItem(LAST_EXPORT_KEY, 'not a date');
    expect(getLastExportAt()).toBeNull();
  });
});

describe('when the nudge is due', () => {
  // The threshold is written out rather than read from the constant, so moving the constant fails a test.
  test('a young diary is never nudged', () => {
    expect(MIN_ENTRIES_FOR_NUDGE).toBe(20);
    expect(isBackupNudgeDue(19, now)).toBe(false);
    expect(isBackupNudgeDue(0, now)).toBe(false);
  });

  test('enough entries and no export ever: due', () => {
    expect(isBackupNudgeDue(20, now)).toBe(true);
  });

  test('a recent export silences it, an old one does not', () => {
    // Relative to the constant, not to the span it happened to have: the owner changed it from a month to a
    // week and the behaviour under test is unchanged.
    recordExportOffered(ago(1));
    expect(isBackupNudgeDue(40, now)).toBe(false);
    recordExportOffered(ago(EXPORT_SILENCE_DAYS - 1));
    expect(isBackupNudgeDue(40, now)).toBe(false);
    recordExportOffered(ago(EXPORT_SILENCE_DAYS + 1));
    expect(isBackupNudgeDue(40, now)).toBe(true);
  });

  test('a dismissal silences it for seven days', () => {
    dismissNudge(now);
    expect(isBackupNudgeDue(40, now)).toBe(false);
    expect(isBackupNudgeDue(40, new Date(now.getTime() + (DISMISS_SILENCE_DAYS - 1) * DAY))).toBe(false);
    expect(isBackupNudgeDue(40, new Date(now.getTime() + DISMISS_SILENCE_DAYS * DAY))).toBe(true);
  });

  test('a stamp a few hours ahead silences it: a clock that drifted is not a reason to nag', () => {
    recordExportOffered(new Date(now.getTime() + 3 * 3600_000));
    expect(isBackupNudgeDue(40, now)).toBe(false);
  });

  test('a stamp days ahead is discarded, not clamped: a wrong date must not silence it for years', () => {
    recordExportOffered(new Date(now.getTime() + 5 * DAY));
    expect(isBackupNudgeDue(40, now)).toBe(true);
  });

  test('an unreadable stamp does not silence it', () => {
    localStorage.setItem(LAST_EXPORT_KEY, 'whenever');
    localStorage.setItem(NUDGE_DISMISSED_KEY, '');
    expect(isBackupNudgeDue(40, now)).toBe(true);
  });
});

describe('blocked storage', () => {
  test('reads that throw leave the nudge due rather than crashing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => isBackupNudgeDue(40, now)).not.toThrow();
    expect(isBackupNudgeDue(40, now)).toBe(true);
    expect(getLastExportAt()).toBeNull();
  });

  test('writes that throw are swallowed', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => recordExportOffered(now)).not.toThrow();
    expect(() => dismissNudge(now)).not.toThrow();
  });
});

describe('the copy is offered weekly, as the owner asked', () => {
  test('stays quiet for six days after a copy and asks again on the seventh', () => {
    recordExportOffered(ago(6));
    expect(isBackupNudgeDue(MIN_ENTRIES_FOR_NUDGE, now)).toBe(false);
    recordExportOffered(ago(7));
    expect(isBackupNudgeDue(MIN_ENTRIES_FOR_NUDGE, now)).toBe(true);
  });

  test('a copy is no longer good for a month', () => {
    // The owner asked for each week; 30 days was the old span and must not quietly return.
    expect(EXPORT_SILENCE_DAYS).toBe(7);
  });
});
