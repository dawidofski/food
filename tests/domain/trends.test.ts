import { describe, expect, test } from 'vitest';
import { localDayKey } from '@/domain/dayBoundary';
import { MIN_LOGGED_DAYS, weeklyTrends } from '@/domain/trends';
import type { DiaryEntry } from '@/types/diary';
import type { ClassificationFlags } from '@/types/nutrients';

const flags: ClassificationFlags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};
const NOW = new Date(2026, 10, 16, 12);
const at = (back: number, hour = 12): string => new Date(2026, 10, 16 - back, hour).toISOString();
let n = 0;
function entry(back: number, over: Partial<DiaryEntry> = {}): DiaryEntry {
  return {
    id: `e${++n}`, at: at(back), rawText: 'meal', resolution: 'local',
    items: [{ source: 'dataset', foodId: 'x', grams: 100, classification: flags }],
    nutrients: { energyKcal: 500, proteinG: 20, fibreG: 5 },
    coverage: { energyKcal: 'known', proteinG: 'known', fibreG: 'known' },
    classification: flags,
    fped: { vegCupEq: 0, fruitCupEq: 0, wholeGrainOzEq: 0 },
    warningsShown: [], userAction: 'added', state: 'active', ...over,
  };
}
function last<T>(a: T[]): T {
  return a[a.length - 1]!;
}
/** Entries on the given number of most recent days (today = 0). */
const days = (k: number, over: Partial<DiaryEntry> = {}) => Array.from({ length: k }, (_, i) => entry(i, over));

describe('weeklyTrends', () => {
  test('returns the requested number of weeks, oldest first, ending today', () => {
    const w = weeklyTrends([], NOW, 12);
    expect(w).toHaveLength(12);
    expect(last(w).endKey).toBe(localDayKey(NOW));
    expect(w[0]!.startKey < last(w).startKey).toBe(true);
  });

  test('an empty diary has no NaN anywhere and every point is thin, never a number', () => {
    const w = weeklyTrends([], NOW, 8);
    expect(JSON.stringify(w)).not.toMatch(/NaN|null/);
    for (const wk of w) {
      expect(wk.loggedDays).toBe(0);
      expect(wk.processedMeat.status).toBe('thin');
      expect(wk.vegDays.status).toBe('thin');
      for (const p of Object.values(wk.metrics)) expect(p.status).toBe('thin');
    }
  });

  test('a week with too few logged days is not plotted as a real value', () => {
    const w = weeklyTrends(days(MIN_LOGGED_DAYS - 1), NOW, 4);
    const wk = last(w);
    expect(wk.loggedDays).toBe(MIN_LOGGED_DAYS - 1);
    expect(wk.enough).toBe(false);
    expect(wk.metrics.fibreG).toEqual({ status: 'thin' });
    expect(wk.processedMeat).toEqual({ status: 'thin' });
    expect(wk.vegDays).toEqual({ status: 'thin' });
  });

  test('a week with enough logged days gives the median of the days', () => {
    const fibre = [10, 20, 30, 40, 50];
    const es = fibre.map((f, b) => entry(b, { nutrients: { energyKcal: 500, fibreG: f }, coverage: { energyKcal: 'known', fibreG: 'known' } }));
    const wk = last(weeklyTrends(es, NOW, 4));
    expect(wk.enough).toBe(true);
    expect(wk.metrics.fibreG).toEqual({ status: 'value', value: 30, days: 5 });
  });

  test('an unknown nutrient is unknown, not zero', () => {
    const es = days(5, { nutrients: { energyKcal: 500, proteinG: 20 }, coverage: { energyKcal: 'known', proteinG: 'known' } });
    const wk = last(weeklyTrends(es, NOW, 4));
    expect(wk.metrics.fibreG).toEqual({ status: 'unknown' });
    expect(wk.metrics.proteinG.status).toBe('value');
  });

  test('a partly known day is left out of the median, so a floor never reads as a typical day', () => {
    const complete = [0, 1, 2, 3].map((b) => entry(b, { nutrients: { energyKcal: 500, sodiumMg: 2000 }, coverage: { energyKcal: 'known', sodiumMg: 'known' } }));
    const partial = entry(4, { nutrients: { energyKcal: 500, sodiumMg: 100 }, coverage: { energyKcal: 'known', sodiumMg: 'partial' } });
    const wk = last(weeklyTrends([...complete, partial], NOW, 4));
    expect(wk.metrics.sodiumMg).toEqual({ status: 'value', value: 2000, days: 4 });
  });

  test('too few days with complete data for a nutrient is unknown, not a value from one or two days', () => {
    const es = [
      ...[0, 1].map((b) => entry(b)),
      ...[2, 3, 4].map((b) => entry(b, { nutrients: { energyKcal: 500 }, coverage: { energyKcal: 'known' } })),
    ];
    const wk = last(weeklyTrends(es, NOW, 4));
    expect(wk.enough).toBe(true);
    expect(wk.metrics.fibreG).toEqual({ status: 'unknown' });
  });

  test('cancelled entries are excluded from every nutritional trend', () => {
    const real = days(2);
    const cancelled = [2, 3, 4, 5].map((b) => entry(b, { userAction: 'cancelled', classification: { ...flags, processedMeat: true } }));
    const wk = last(weeklyTrends([...real, ...cancelled], NOW, 4));
    expect(wk.loggedDays).toBe(2);
    expect(wk.enough).toBe(false);
    expect(wk.processedMeat.status).toBe('thin');
  });

  test('superseded and deleted entries are not counted, and a revision is counted once', () => {
    const original = entry(0, { state: 'superseded', supersededBy: 'r', classification: { ...flags, processedMeat: true } });
    const revision = entry(0, { id: 'r', revisionOf: original.id, classification: { ...flags, processedMeat: true } });
    const deleted = entry(1, { state: 'deleted', classification: { ...flags, processedMeat: true } });
    const rest = [1, 2, 3].map((b) => entry(b));
    const wk = last(weeklyTrends([original, revision, deleted, ...rest], NOW, 4));
    expect(wk.loggedDays).toBe(4);
    expect(wk.processedMeat).toEqual({ status: 'value', value: 1 });
  });

  test('processed-meat meals are counted per entry, per week', () => {
    const es = [...days(5), entry(0, { classification: { ...flags, processedMeat: true } }), entry(1, { classification: { ...flags, processedMeat: true } })];
    expect(last(weeklyTrends(es, NOW, 4)).processedMeat).toEqual({ status: 'value', value: 2 });
  });

  test('vegetable days: known days counted, unknown days make it a floor, empty days ignored', () => {
    const veg = [0, 1].map((b) => entry(b, { fped: { vegCupEq: 1, fruitCupEq: 0, wholeGrainOzEq: 0 } }));
    const none = [2, 3].map((b) => entry(b));
    const unknown = entry(4, { fped: undefined });
    const wk = last(weeklyTrends([...veg, ...none, unknown], NOW, 4));
    expect(wk.vegDays).toEqual({ status: 'value', value: 2, atLeast: true });
  });

  test('earlier weeks are bucketed apart from the latest', () => {
    const old = [7, 8, 9, 10, 11].map((b) => entry(b));
    const w = weeklyTrends(old, NOW, 4);
    expect(last(w).loggedDays).toBe(0);
    expect(w[2]!.loggedDays).toBe(5);
    expect(w[2]!.enough).toBe(true);
  });

  test('a sparse diary does not produce a falling line: thin weeks carry no number at all', () => {
    const es = [...days(7), entry(8), entry(15), entry(22)];
    const w = weeklyTrends(es, NOW, 4);
    expect(w.filter((x) => x.metrics.energyKcal.status === 'value')).toHaveLength(1);
  });
});
