import { describe, expect, test } from 'vitest';
import { weekContext } from '@/domain/totals';
import type { DiaryEntry } from '@/types/diary';
import type { ClassificationFlags } from '@/types/nutrients';

const none: ClassificationFlags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};
let seq = 0;
function make(day: string, over: Partial<DiaryEntry> = {}): DiaryEntry {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return {
    id: `p${++seq}`, at: new Date(y, m - 1, d, 12).toISOString(), rawText: 'x', resolution: 'local',
    items: [{ source: 'dataset', foodId: 'x', grams: 100, classification: none }],
    nutrients: { energyKcal: 100 }, coverage: { energyKcal: 'known' },
    classification: none, warningsShown: [], userAction: 'added', state: 'active', ...over,
  };
}
const sodiumDay = (day: string, mg: number) =>
  make(day, { nutrients: { energyKcal: 500, sodiumMg: mg }, coverage: { energyKcal: 'known', sodiumMg: 'known' } });

const on = new Date(2026, 10, 16, 12);

describe('the pattern window and days nobody logged', () => {
  test('two days with nothing logged are absent, not days under the figure', () => {
    const entries = ['2026-11-15', '2026-11-14', '2026-11-13', '2026-11-12'].map((d) => sodiumDay(d, 3000));
    const w = weekContext(entries, on);
    expect(w.completeDayTotalsBeforeToday.sodiumMg).toEqual([3000, 3000, 3000, 3000]);
  });

  test('a day whose only entry was cancelled is absent, not a known zero', () => {
    const entries = [
      ...['2026-11-15', '2026-11-14', '2026-11-13', '2026-11-12'].map((d) => sodiumDay(d, 3000)),
      sodiumDay('2026-11-11', 0),
    ];
    const cancelled = [
      ...entries.slice(0, 4),
      { ...entries[4]!, userAction: 'cancelled' as const },
    ];
    expect(weekContext(entries, on).completeDayTotalsBeforeToday.sodiumMg).toHaveLength(5);
    expect(weekContext(cancelled, on).completeDayTotalsBeforeToday.sodiumMg).toHaveLength(4);
  });
});
