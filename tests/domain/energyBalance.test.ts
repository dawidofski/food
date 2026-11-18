import { describe, expect, test } from 'vitest';
import { BALANCE_WINDOW_DAYS, KCAL_PER_KG, MIN_COMPLETE_DAYS, energyBalance } from '@/domain/energyBalance';
import { PROJECTION_WEEKS, weightProjection, DAILY_FLUCTUATION_KG } from '@/domain/weightProjection';
import { dayTotals } from '@/domain/totals';
import { weightTrend } from '@/domain/weightTrend';
import type { DiaryEntry } from '@/types/diary';
import type { ClassificationFlags } from '@/types/nutrients';

const none: ClassificationFlags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};

let seq = 0;
const key = (d: number) => new Date(2026, 10, 18 - d).toISOString().slice(0, 10);

/** A day whose energy the app can fully vouch for. */
function loggedDay(daysAgo: number, kcal: number) {
  const k = key(daysAgo);
  const [y, m, d] = k.split('-').map(Number) as [number, number, number];
  const e: DiaryEntry = {
    id: `e${++seq}`,
    at: new Date(y, m - 1, d, 12).toISOString(),
    rawText: 'x',
    resolution: 'local',
    items: [{ source: 'dataset', foodId: 'x', grams: 100, classification: none }],
    nutrients: { energyKcal: kcal },
    coverage: { energyKcal: 'known' },
    classification: none,
    warningsShown: [],
    userAction: 'added',
    state: 'active',
  };
  return dayTotals([e], k);
}

/** A day with nothing logged at all. */
const emptyDay = (daysAgo: number) => dayTotals([], key(daysAgo));

describe('energyBalance', () => {
  test('says logging is patchy below eight complete days, and gives no average', () => {
    const days = [0, 1, 2, 3, 4, 5, 6].map((d) => loggedDay(d, 2000));
    const b = energyBalance(days, 2500, 'formula');
    expect(b.kind).toBe('patchy');
    expect(b.completeDays).toBe(7);
    expect(MIN_COMPLETE_DAYS).toBe(8);
  });

  test('leaves an unlogged day out of the average rather than counting it as zero', () => {
    // Ten days at 2,000 and four with nothing logged. Counting the empty days would give 1,429 and invent a
    // deficit of 1,071 kcal a day out of a quiet long weekend.
    const days = [
      ...Array.from({ length: 10 }, (_, i) => loggedDay(i, 2000)),
      ...[10, 11, 12, 13].map(emptyDay),
    ];
    const b = energyBalance(days, 2500, 'formula');
    if (b.kind !== 'known') throw new Error('expected a balance');
    expect(b.completeDays).toBe(10);
    expect(b.intakeKcal).toBe(2000);
    expect(b.balanceKcal).toBe(-500);
  });

  test('matches the figures the design states', () => {
    const at = (deficit: number) => {
      const days = Array.from({ length: 14 }, (_, i) => loggedDay(i, 2500 - deficit));
      const b = energyBalance(days, 2500, 'formula');
      if (b.kind !== 'known') throw new Error('expected a balance');
      return b.impliedKgPerWeek;
    };
    expect(Math.abs(at(300))).toBeCloseTo(0.27, 2);
    expect(Math.abs(at(700))).toBeCloseTo(0.64, 2);
    expect(Math.abs(at(1100))).toBeCloseTo(1.0, 1);
    expect(KCAL_PER_KG).toBe(7700);
  });

  test('reports a surplus as gaining', () => {
    const days = Array.from({ length: 14 }, (_, i) => loggedDay(i, 3000));
    const b = energyBalance(days, 2500, 'formula');
    if (b.kind !== 'known') throw new Error('expected a balance');
    expect(b.balanceKcal).toBe(500);
    expect(b.impliedKgPerWeek).toBeGreaterThan(0);
  });

  test('never divides by zero, and refuses an expenditure figure of zero', () => {
    expect(energyBalance([], 2500, 'formula')).toMatchObject({ kind: 'patchy', completeDays: 0 });
    const days = Array.from({ length: 14 }, (_, i) => loggedDay(i, 2000));
    expect(energyBalance(days, 0, 'formula').kind).toBe('patchy');
    const b = energyBalance(days, 2500, 'reported');
    if (b.kind !== 'known') throw new Error('expected a balance');
    for (const v of [b.intakeKcal, b.balanceKcal, b.impliedKgPerWeek]) expect(Number.isFinite(v)).toBe(true);
    expect(b.basis).toBe('reported');
  });

  test('the window is the figure the plan pinned', () => {
    expect(BALANCE_WINDOW_DAYS).toBe(14);
  });
});

const ON = new Date('2026-11-18T12:00:00');
const wlog = (...rows: [number, number][]) => rows.map(([d, kg]) => ({ date: key(d), kg }));

describe('weightProjection', () => {
  test('projects nothing from an unknown trend', () => {
    expect(weightProjection(weightTrend([], ON), 80)).toEqual([]);
    expect(weightProjection(weightTrend(wlog([28, 80], [14, 79.5], [0, 79]), ON), Number.NaN)).toEqual([]);
  });

  test('runs twelve weeks and no further', () => {
    const p = weightProjection(weightTrend(wlog([28, 80], [14, 79.5], [0, 79]), ON), 79);
    expect(p).toHaveLength(PROJECTION_WEEKS);
    expect(p[p.length - 1]?.week).toBe(12);
  });

  test('widens with distance', () => {
    const p = weightProjection(weightTrend(wlog([28, 80], [21, 79.7], [14, 79.5], [7, 79.2], [0, 79]), ON), 79);
    const width = p.map((w) => w.highKg - w.lowKg);
    for (let i = 1; i < width.length; i++) expect(width[i]!).toBeGreaterThan(width[i - 1]!);
  });

  test('widens more for a scattered log than a tidy one', () => {
    const tidy = weightTrend(wlog([28, 80], [21, 79.75], [14, 79.5], [7, 79.25], [0, 79]), ON);
    const noisy = weightTrend(wlog([28, 80.8], [21, 79.1], [14, 80.2], [7, 78.6], [0, 79.3]), ON);
    const w = (t: typeof tidy) => {
      const p = weightProjection(t, 79);
      const last = p[p.length - 1];
      return last === undefined ? 0 : last.highKg - last.lowKg;
    };
    expect(w(noisy)).toBeGreaterThan(w(tidy));
  });

  test('follows the measured rate, not any other figure', () => {
    const t = weightTrend(wlog([28, 80], [14, 79.5], [0, 79]), ON);
    if (t.kind === 'unknown') throw new Error('expected a trend');
    const p = weightProjection(t, 79);
    expect(p[3]?.kg).toBeCloseTo(79 + t.kgPerWeek * 4, 6);
  });

  test('never returns NaN, and the band has a floor', () => {
    const t = weightTrend(wlog([28, 80], [14, 79.5], [0, 79]), ON);
    const p = weightProjection(t, 79);
    for (const w of p) for (const v of [w.kg, w.lowKg, w.highKg]) expect(Number.isFinite(v)).toBe(true);
    expect((p[0]?.highKg ?? 0) - (p[0]?.lowKg ?? 0)).toBeGreaterThanOrEqual(DAILY_FLUCTUATION_KG * 2);
  });
});
