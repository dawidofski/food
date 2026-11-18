import { describe, expect, test } from 'vitest';
import { HOLDING_KG_PER_WEEK, MIN_SPAN_DAYS, MIN_WEIGH_INS, weightTrend } from '@/domain/weightTrend';

const ON = new Date('2026-11-18T12:00:00');

/** `d` days before the 18th, as the log's ISO day key. */
const day = (d: number): string => new Date(2026, 10, 18 - d).toISOString().slice(0, 10);

const log = (...rows: [number, number][]) => rows.map(([daysAgo, kg]) => ({ date: day(daysAgo), kg }));

describe('weightTrend', () => {
  test('says nothing from an empty log, one weigh-in, or two a day apart', () => {
    expect(weightTrend([], ON)).toMatchObject({ kind: 'unknown', reason: 'none' });
    expect(weightTrend(log([0, 80]), ON)).toMatchObject({ kind: 'unknown', reason: 'too-few' });
    // Two a day apart would imply a rate of tens of kg a week. That is water, not fat.
    expect(weightTrend(log([1, 80], [0, 79.5]), ON)).toMatchObject({ kind: 'unknown', reason: 'too-few' });
    // Enough points, but crammed into three days.
    expect(weightTrend(log([2, 80], [1, 79.8], [0, 79.5]), ON)).toMatchObject({ kind: 'unknown', reason: 'too-short' });
  });

  test('calls a steady fall losing, with the rate in kg per week', () => {
    const t = weightTrend(log([28, 80], [21, 79.75], [14, 79.5], [7, 79.25], [0, 79]), ON);
    expect(t.kind).toBe('losing');
    if (t.kind === 'unknown') throw new Error('expected a trend');
    expect(t.kgPerWeek).toBeCloseTo(-0.25, 2);
    expect(t.spanDays).toBe(28);
    expect(t.points).toBe(5);
  });

  test('calls a rise gaining', () => {
    const t = weightTrend(log([28, 79], [14, 79.5], [0, 80]), ON);
    expect(t.kind).toBe('gaining');
  });

  test('calls a flat log holding even when the figures wobble', () => {
    const t = weightTrend(log([28, 80.0], [21, 80.4], [14, 79.7], [7, 80.1], [0, 80.0]), ON);
    expect(t.kind).toBe('holding');
    if (t.kind === 'unknown') throw new Error('expected a trend');
    expect(Math.abs(t.kgPerWeek)).toBeLessThan(HOLDING_KG_PER_WEEK);
  });

  test('keeps the last figure when a day was weighed twice', () => {
    const rows = [...log([28, 80], [14, 79.5], [0, 90]), { date: day(0), kg: 79 }];
    const t = weightTrend(rows, ON);
    if (t.kind === 'unknown') throw new Error('expected a trend');
    expect(t.points).toBe(3);
    expect(t.kgPerWeek).toBeCloseTo(-0.25, 2);
  });

  test('does not care what order the log arrives in', () => {
    const rows = log([28, 80], [21, 79.75], [14, 79.5], [7, 79.25], [0, 79]);
    const shuffled = [rows[2]!, rows[0]!, rows[4]!, rows[1]!, rows[3]!];
    expect(weightTrend(shuffled, ON)).toEqual(weightTrend(rows, ON));
  });

  test('ignores a row whose weight is not a number', () => {
    const rows = [...log([28, 80], [14, 79.5], [0, 79]), { date: day(7), kg: Number.NaN }];
    const t = weightTrend(rows, ON);
    if (t.kind === 'unknown') throw new Error('expected a trend');
    expect(t.points).toBe(3);
  });

  test('never returns NaN or Infinity, including when every weigh-in is on one day', () => {
    const same = [
      { date: day(0), kg: 80 },
      { date: day(0), kg: 81 },
      { date: day(0), kg: 82 },
    ];
    const t = weightTrend(same, ON);
    expect(t.kind).toBe('unknown');
    const real = weightTrend(log([28, 80], [14, 79.5], [0, 79]), ON);
    if (real.kind === 'unknown') throw new Error('expected a trend');
    for (const v of [real.kgPerWeek, real.seKgPerDay, real.spanDays, real.points]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  test('the gates are the figures the plan pinned', () => {
    expect(MIN_WEIGH_INS).toBe(3);
    expect(MIN_SPAN_DAYS).toBe(14);
  });
});
