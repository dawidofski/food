import { describe, expect, test } from 'vitest';
import { mealFromEntry, replaySavedMeal } from '@/domain/savedMeals';
import { FLAGS, lookupOf } from '../fixtures/batchFoods';
import type { DiaryEntry } from '@/types/diary';
import type { DatasetFood } from '@/types/food';

const food = (id: string, name: string, kcal: number, allergens: string[] = []): DatasetFood => ({
  id, name, synonyms: [], per100g: { energyKcal: kcal, satFatG: 0.022 },
  portions: [{ label: '100 g', grams: 100 }], classification: FLAGS, allergens,
});

const oats = food('f-oats', 'Oats', 380, ['gluten']);
const milk = food('f-milk', 'Milk', 60, ['milk']);
const lookup = lookupOf([oats, milk]);

const entry = (over: Partial<DiaryEntry> = {}): DiaryEntry => ({
  id: 'e1', at: new Date().toISOString(), rawText: '50 g oats with 200 ml milk', resolution: 'local',
  items: [
    { source: 'dataset', foodId: 'f-oats', grams: 50, classification: FLAGS },
    { source: 'dataset', foodId: 'f-milk', grams: 200, classification: FLAGS },
  ],
  nutrients: { energyKcal: 310 }, coverage: { energyKcal: 'known' }, classification: FLAGS,
  warningsShown: [], userAction: 'added', state: 'active', ...over,
});

const make = (e = entry(), name = 'my usual porridge') => mealFromEntry(e, name, 'm1', '2026-11-19T08:00:00.000Z');

describe('saving a meal', () => {
  test('remembers the foods and their weights, not their figures', () => {
    const m = make();
    expect(m?.refs.map((r) => [r.foodId, r.grams])).toEqual([['f-oats', 50], ['f-milk', 200]]);
    // No nutrition is stored: that is the whole point.
    expect(JSON.stringify(m)).not.toMatch(/energyKcal|satFat/);
  });

  test('refuses a meal with no name, or with nothing loggable behind it', () => {
    expect(make(entry(), '   ')).toBeUndefined();
    expect(make(entry({ items: [] }))).toBeUndefined();
    expect(make(entry({ items: [{ source: 'dataset', foodId: 'f-oats', grams: Number.NaN, classification: FLAGS }] }))).toBeUndefined();
    // Part of it unusable is still unusable: logging a smaller meal than they asked for is the failure to avoid.
    expect(make(entry({ items: [
      { source: 'dataset', foodId: 'f-oats', grams: 50, classification: FLAGS },
      { source: 'dataset', foodId: 'f-milk', grams: 0, classification: FLAGS },
    ] }))).toBeUndefined();
  });
});

describe('logging a saved meal again', () => {
  test('works the figures out from the foods as they are now', () => {
    const m = make();
    const { resolution, missing } = replaySavedMeal(m!, lookup);
    // 50 g of 380 per 100 g, plus 200 g of 60.
    expect(resolution.nutrients.energyKcal).toBeCloseTo(190 + 120, 6);
    expect(missing).toHaveLength(0);
    expect(resolution.refs).toHaveLength(2);
  });

  test('keeps a figure too small to round, instead of storing a zero', () => {
    // 0.022 g of saturated fat per 100 g is a real figure in 411 foods in the bundled dataset. Copying and
    // rounding it would have written 0, which says "this meal contained none".
    const { resolution } = replaySavedMeal(make()!, lookup);
    expect(resolution.nutrients.satFatG).toBeGreaterThan(0);
    expect(resolution.nutrients.satFatG).toBeCloseTo(0.022 * 0.5 + 0.022 * 2, 6);
  });

  test('logs nothing at all when one of its foods is gone', () => {
    const { resolution, missing } = replaySavedMeal(make()!, lookupOf([oats]));
    expect(missing.map((r) => r.foodId)).toEqual(['f-milk']);
    // Not the oats on their own. An entry holding half the meal would carry coverage 'known' and read as a
    // complete total, which understates the day while looking finished.
    expect(resolution.refs).toHaveLength(0);
    expect(resolution.nutrients).toEqual({});
    expect(resolution.coverage).toEqual({});
    expect(resolution.confidence).toBe(0);
  });

  test('refuses a weight the app would no longer accept, rather than logging it', () => {
    const absurd = mealFromEntry(
      entry({ items: [{ source: 'dataset', foodId: 'f-oats', grams: 500_000, classification: FLAGS }] }),
      'wrong', 'm2', '2026-11-19T08:00:00.000Z',
    );
    const { resolution, missing } = replaySavedMeal(absurd!, lookup);
    expect(missing).toHaveLength(1);
    expect(resolution.refs).toHaveLength(0);
  });

  test("a food's figures are picked up as they are now, because nothing was frozen", () => {
    const changed = lookupOf([{ ...oats, per100g: { energyKcal: 400, satFatG: 0.022 } }, milk]);
    const { resolution } = replaySavedMeal(make()!, changed);
    expect(resolution.nutrients.energyKcal).toBeCloseTo(200 + 120, 6);
  });

  test("a food's flags are picked up as they are now, so the safety rules see the truth", () => {
    // Saved while the oats carried no flags; the person has since marked that food as processed meat and
    // ultra-processed. Replaying must read the food, not the refs the entry was written with, or the rules run
    // against flags from the day the meal was named and the warning never fires again.
    const m = make()!;
    expect(m.refs[0]?.classification.processedMeat).toBe(false);
    const flagged = { ...oats, classification: { ...FLAGS, processedMeat: true, novaGroup: 4 as const } };
    const { resolution } = replaySavedMeal(m, lookupOf([flagged, milk]));
    expect(resolution.classification.processedMeat).toBe(true);
    expect(resolution.classification.novaGroup).toBe(4);
    expect(resolution.refs[0]?.classification.processedMeat).toBe(true);
  });

  test("a food's cup-equivalents are rescaled from the food, not carried over", () => {
    // Same reason as the flags: FPED drives the veg, fruit and whole-grain progress, and a dataset deploy can
    // replace the table under a meal saved months ago.
    const withFped = { ...oats, fped: { vegCupEq: 1, fruitCupEq: 0, wholeGrainOzEq: 2 } };
    const { resolution } = replaySavedMeal(make()!, lookupOf([withFped, milk]));
    // 50 g of it, so half of each per-100 g figure.
    expect(resolution.refs[0]?.fped).toEqual({ vegCupEq: 0.5, fruitCupEq: 0, wholeGrainOzEq: 1 });
  });
});
