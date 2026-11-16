import { describe, expect, test } from 'vitest';
import { last7DayKeys, localDayKey, localDayRange } from '@/domain/dayBoundary';

describe('local day boundaries', () => {
  test('an entry at 00:30 local belongs to the new local day', () => {
    expect(localDayKey('2026-11-15T00:30:00+01:00')).toBe('2026-11-15');
  });

  test('the local day key is not the UTC date', () => {
    expect(localDayKey(new Date('2026-11-14T23:30:00Z'))).toBe('2026-11-15');
  });

  test('an entry at exactly local midnight belongs to the new day', () => {
    expect(localDayKey('2026-11-15T00:00:00+01:00')).toBe('2026-11-15');
    expect(localDayKey('2026-11-14T23:59:59.999+01:00')).toBe('2026-11-14');
  });

  test('last7DayKeys returns seven consecutive local days ending today', () => {
    const keys = last7DayKeys(new Date('2026-11-15T12:00:00'));
    expect(keys).toHaveLength(7);
    expect(keys.at(-1)).toBe('2026-11-15');
    expect(keys[0]).toBe('2026-11-09');
  });

  test('last7DayKeys crosses a month and a DST change without skipping or repeating a day', () => {
    expect(last7DayKeys(new Date('2026-10-28T12:00:00'))).toEqual([
      '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28',
    ]);
    expect(last7DayKeys(new Date('2026-03-03T12:00:00'))[0]).toBe('2026-02-25');
  });

  test('a 25-hour DST day still yields one day key', () => {
    // tests/setup sets TZ=Europe/Amsterdam; 2026-10-25 is the DST change
    const before = localDayKey('2026-10-25T02:30:00+02:00');
    const after = localDayKey('2026-10-25T02:30:00+01:00');
    expect(before).toBe('2026-10-25');
    expect(after).toBe('2026-10-25');
  });

  test('localDayRange spans exactly the local day, including a 25-hour one', () => {
    expect(localDayRange('2026-11-15')).toEqual({
      fromISO: '2026-11-14T23:00:00.000Z',
      toISO: '2026-11-15T22:59:59.999Z',
    });
    expect(localDayRange('2026-10-25')).toEqual({
      fromISO: '2026-10-24T22:00:00.000Z',
      toISO: '2026-10-25T22:59:59.999Z',
    });
  });

  test('a malformed day key or datetime is rejected, not turned into NaN', () => {
    expect(() => localDayRange('15-11-2026')).toThrow(RangeError);
    expect(() => localDayRange('2026-02-30')).toThrow(RangeError);
    expect(() => localDayKey('not a date')).toThrow(RangeError);
  });
});
