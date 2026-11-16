import { describe, expect, test } from 'vitest';
import { dayTotals, weekContext } from '@/domain/totals';
import type { DiaryEntry } from '@/types/diary';
import type { ClassificationFlags } from '@/types/nutrients';

const none: ClassificationFlags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};

let seq = 0;
/** `day` is a local day; entries are placed at local `hour` and stored as UTC ISO like the store does. */
function make(day: string, over: Partial<DiaryEntry> = {}, hour = 12): DiaryEntry {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return {
    id: `e${++seq}`,
    at: new Date(y, m - 1, d, hour).toISOString(),
    rawText: 'x',
    resolution: 'local',
    items: [{ source: 'dataset', foodId: 'x', grams: 100 }],
    nutrients: { energyKcal: 100 },
    coverage: { energyKcal: 'known' },
    classification: none,
    warningsShown: [],
    userAction: 'added',
    state: 'active',
    ...over,
  };
}

const entryWithAddedSugar = (kcal: number) => make('2026-11-15', { nutrients: { energyKcal: kcal, addedSugarsG: 10 } });
const entryWithoutAddedSugar = (kcal: number) => make('2026-11-15', { nutrients: { energyKcal: kcal } });
const pmEntry = (day: string) => make(day, { classification: { ...none, processedMeat: true } });
const vegEntry = (day: string) =>
  make(day, { classification: { ...none, vegetable: true }, fped: { vegCupEq: 1, fruitCupEq: 0, wholeGrainOzEq: 0 } });
const on = new Date('2026-11-15T12:00:00');

describe('dayTotals', () => {
  test('reports the share of energy with known values for a nutrient', () => {
    const t = dayTotals([entryWithAddedSugar(300), entryWithoutAddedSugar(700)], '2026-11-15');
    expect(t.energyCoveredShare.addedSugarsG).toBeCloseTo(0.3, 2);
    expect(t.energyCoveredShare.energyKcal).toBe(1);
    expect(t.coverage.addedSugarsG).toBe('partial');
    expect(t.nutrients.addedSugarsG).toBe(10);
    expect(t.nutrients.energyKcal).toBe(1000);
  });

  test('a nutrient nobody knew stays absent with zero share, never zero grams', () => {
    const t = dayTotals([entryWithoutAddedSugar(500)], '2026-11-15');
    expect('addedSugarsG' in t.nutrients).toBe(false);
    expect(t.coverage.addedSugarsG).toBe('unknown');
    expect(t.energyCoveredShare.addedSugarsG).toBe(0);
  });

  test('only entries from that local day count, and an evening entry is not pushed into UTC tomorrow', () => {
    const late = make('2026-11-15', {}, 23);
    const early = make('2026-11-16', {}, 0);
    expect(dayTotals([late, early], '2026-11-15').nutrients.energyKcal).toBe(100);
    expect(dayTotals([late, early], '2026-11-16').nutrients.energyKcal).toBe(100);
  });

  test('cancelled, deleted and superseded entries are excluded', () => {
    const t = dayTotals(
      [
        make('2026-11-15'),
        make('2026-11-15', { userAction: 'cancelled' }),
        make('2026-11-15', { state: 'deleted' }),
        make('2026-11-15', { state: 'superseded' }),
      ],
      '2026-11-15',
    );
    expect(t.nutrients.energyKcal).toBe(100);
  });

  test('an empty day has no NaN anywhere', () => {
    const t = dayTotals([], '2026-11-15');
    expect(t.nutrients).toEqual({});
    for (const v of Object.values(t.energyCoveredShare)) expect(Number.isFinite(v)).toBe(true);
  });

  test('an entry with no energy figure contributes nothing to any share', () => {
    const t = dayTotals([make('2026-11-15', { nutrients: { addedSugarsG: 5 } }), entryWithAddedSugar(100)], '2026-11-15');
    expect(t.energyCoveredShare.addedSugarsG).toBe(1);
  });

  test('vegetable total is partial, not zero, when some entries have no fped', () => {
    const t = dayTotals([make('2026-11-15'), make('2026-11-15', { fped: { vegCupEq: 0.5, fruitCupEq: 0, wholeGrainOzEq: 0 } })], '2026-11-15');
    expect(t.vegCupEq).toBe(0.5);
    expect(t.vegCoverage).toBe('partial');
    const u = dayTotals([make('2026-11-15')], '2026-11-15');
    expect(u.vegCoverage).toBe('unknown');
  });
});

describe('weekContext', () => {
  test('counts processed meat occasions, not grams', () => {
    const c = weekContext([pmEntry('2026-11-10'), pmEntry('2026-11-13'), pmEntry('2026-11-15')], on);
    expect(c.processedMeatOccasions).toBe(3);
  });

  test('two processed-meat items in one entry are one occasion', () => {
    const e = make('2026-11-15', {
      items: [
        { source: 'dataset', foodId: 'a', grams: 50 },
        { source: 'dataset', foodId: 'b', grams: 50 },
      ],
      classification: { ...none, processedMeat: true },
    });
    expect(weekContext([e], on).processedMeatOccasions).toBe(1);
  });

  test('counts days with no vegetable serving across the whole window', () => {
    const c = weekContext([vegEntry('2026-11-15')], on);
    expect(c.daysWithoutVegetable).toBe(6);
    expect(c.vegCupEqByDay).toEqual([0, 0, 0, 0, 0, 0, 1]);
  });

  test('a day of entries with no fped and no vegetable flag is unknown, not vegetable-free', () => {
    const c = weekContext([make('2026-11-15')], on);
    expect(c.daysWithoutVegetable).toBe(6);
    expect(c.daysVegetableUnknown).toBe(1);
  });

  test('a vegetable flag counts as a serving even without fped', () => {
    const c = weekContext([make('2026-11-15', { classification: { ...none, vegetable: true } })], on);
    expect(c.daysWithoutVegetable).toBe(6);
    expect(c.daysVegetableUnknown).toBe(0);
  });

  test('redMeatGrams sums grams over the week; alcohol counts drinks logged', () => {
    const red = (day: string, grams: number) =>
      make(day, { items: [{ source: 'dataset', foodId: 'r', grams }], classification: { ...none, redMeat: true } });
    const c = weekContext(
      [
        red('2026-11-09', 120),
        red('2026-11-15', 80),
        red('2026-11-08', 999),
        make('2026-11-14', { classification: { ...none, alcohol: true } }),
      ],
      on,
    );
    expect(c.redMeatGrams).toBe(200);
    expect(c.alcoholOccasions).toBe(1);
  });

  test('an empty diary gives zeroed counts and seven day keys', () => {
    const c = weekContext([], on);
    expect(c.days.map((d) => d.dayKey)).toHaveLength(7);
    expect(c).toMatchObject({ processedMeatOccasions: 0, redMeatGrams: 0, alcoholOccasions: 0, daysWithoutVegetable: 7 });
    expect(c.vegCupEqByDay).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  test('cancelled and tombstoned entries are excluded from every count', () => {
    const bad = (over: Partial<DiaryEntry>) =>
      make('2026-11-15', {
        classification: { ...none, processedMeat: true, redMeat: true, alcohol: true, vegetable: true },
        ...over,
      });
    const c = weekContext([bad({ userAction: 'cancelled' }), bad({ state: 'deleted' }), bad({ state: 'superseded' })], on);
    expect(c).toMatchObject({ processedMeatOccasions: 0, redMeatGrams: 0, alcoholOccasions: 0, daysWithoutVegetable: 7 });
  });
});
