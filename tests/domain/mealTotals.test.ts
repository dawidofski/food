import { describe, expect, test } from 'vitest';
import { dayTotals, mealTotals, MEAL_GROUPS } from '@/domain/totals';
import type { DiaryEntry, MealSlot } from '@/types/diary';
import { NUTRIENT_KEYS } from '@/types/nutrients';
import type { ClassificationFlags } from '@/types/nutrients';

const none: ClassificationFlags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};

const DAY = '2026-11-15';

let seq = 0;
/** `day` is a local day; entries are placed at local `hour` and stored as UTC ISO like the store does. */
function make(day: string, over: Partial<DiaryEntry> = {}, hour = 12): DiaryEntry {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return {
    id: `e${++seq}`,
    at: new Date(y, m - 1, d, hour).toISOString(),
    rawText: 'x',
    resolution: 'local',
    items: [{ source: 'dataset', foodId: 'x', grams: 100, classification: none }],
    nutrients: { energyKcal: 100 },
    coverage: { energyKcal: 'known' },
    classification: none,
    warningsShown: [],
    userAction: 'added',
    state: 'active',
    ...over,
  };
}

describe('mealTotals', () => {
  test('puts an entry with no meal under earlier', () => {
    const g = mealTotals([make(DAY)], DAY);
    expect(g.earlier.entryCount).toBe(1);
    expect(g.breakfast.entryCount).toBe(0);
    expect(g.lunch.entryCount).toBe(0);
    expect(g.dinner.entryCount).toBe(0);
    expect(g.snack.entryCount).toBe(0);
  });

  test('puts an entry whose meal is not a slot this build knows under earlier', () => {
    // A value can reach the store without passing the importer: a hand-edited database, or a row written by a
    // later build. An entry in no group would be invisible on the day view, which reads as lost food.
    const g = mealTotals([make(DAY, { meal: 'brunch' as MealSlot })], DAY);
    expect(g.earlier.entryCount).toBe(1);
    expect(MEAL_GROUPS.filter((k) => k !== 'earlier').every((k) => g[k].entryCount === 0)).toBe(true);
  });

  test('gives an empty slot no figures rather than zeros', () => {
    const g = mealTotals([make(DAY, { meal: 'breakfast' })], DAY);
    expect(g.snack.entryCount).toBe(0);
    // Absent, not 0: an empty slot does not know its energy, it has none to know.
    expect(g.snack.nutrients.energyKcal).toBeUndefined();
    expect(g.snack.nutrients.satFatG).toBeUndefined();
    expect(g.snack.coverage.energyKcal).toBe('unknown');
  });

  test('counts neither a cancelled entry nor a tombstone in any group', () => {
    const rows = [
      make(DAY, { meal: 'lunch', userAction: 'cancelled' }),
      make(DAY, { meal: 'lunch', state: 'deleted' }),
      make(DAY, { meal: 'lunch', state: 'superseded' }),
    ];
    const g = mealTotals(rows, DAY);
    expect(MEAL_GROUPS.every((k) => g[k].entryCount === 0)).toBe(true);
    expect(g.lunch.nutrients.energyKcal).toBeUndefined();
  });

  test('sums to the day across every group', () => {
    const rows = [
      make(DAY, { meal: 'breakfast', nutrients: { energyKcal: 320, proteinG: 12 }, coverage: { energyKcal: 'known', proteinG: 'known' } }),
      make(DAY, { meal: 'lunch', nutrients: { energyKcal: 640, proteinG: 48 }, coverage: { energyKcal: 'known', proteinG: 'known' } }),
      make(DAY, { meal: 'dinner', nutrients: { energyKcal: 880, proteinG: 52, satFatG: 19 }, coverage: { energyKcal: 'known', proteinG: 'known', satFatG: 'known' } }),
      make(DAY, { nutrients: { energyKcal: 210 }, coverage: { energyKcal: 'known' } }),
    ];
    const g = mealTotals(rows, DAY);
    const day = dayTotals(rows, DAY);
    for (const key of NUTRIENT_KEYS) {
      const parts = MEAL_GROUPS.map((k) => g[k].nutrients[key]).filter((v): v is number => v !== undefined);
      const summed = parts.length === 0 ? undefined : parts.reduce((a, b) => a + b, 0);
      expect([key, summed]).toEqual([key, day.nutrients[key]]);
    }
    expect(MEAL_GROUPS.reduce((n, k) => n + g[k].entryCount, 0)).toBe(day.entryCount);
  });

  test('marks a slot partial when one of its entries knew a key and another did not', () => {
    const rows = [
      make(DAY, { meal: 'dinner', nutrients: { energyKcal: 500, satFatG: 19 }, coverage: { energyKcal: 'known', satFatG: 'known' } }),
      make(DAY, { meal: 'dinner', nutrients: { energyKcal: 300 }, coverage: { energyKcal: 'known' } }),
    ];
    const g = mealTotals(rows, DAY);
    // A floor, so the slot header must read "at least 19 g" rather than stating a total.
    expect(g.dinner.coverage.satFatG).toBe('partial');
    expect(g.dinner.nutrients.satFatG).toBe(19);
    expect(g.dinner.energyCoveredShare.satFatG).toBeCloseTo(500 / 800, 3);
  });
});
