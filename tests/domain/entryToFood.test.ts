import { describe, expect, test } from 'vitest';
import { entryGrams, entryToFoodDraft } from '@/domain/entryToFood';
import { FLAGS, lookupOf } from '../fixtures/batchFoods';
import type { DiaryEntry } from '@/types/diary';
import type { DatasetFood } from '@/types/food';

const food = (id: string, name: string, allergens: string[] = []): DatasetFood => ({
  id, name, synonyms: [], per100g: { energyKcal: 100 },
  portions: [{ label: '100 g', grams: 100 }], classification: FLAGS, allergens,
});

const lookup = lookupOf([food('f-oats', 'Oats', ['gluten']), food('f-milk', 'Milk', ['milk'])]);

function entry(over: Partial<DiaryEntry> = {}): DiaryEntry {
  return {
    id: 'e1',
    at: new Date().toISOString(),
    rawText: '50 g oats with 200 ml milk',
    resolution: 'local',
    items: [
      { source: 'dataset', foodId: 'f-oats', grams: 50, classification: FLAGS },
      { source: 'dataset', foodId: 'f-milk', grams: 200, classification: FLAGS },
    ],
    nutrients: { energyKcal: 325, proteinG: 12.5, satFatG: 3 },
    coverage: { energyKcal: 'known', proteinG: 'known', satFatG: 'known' },
    classification: FLAGS,
    warningsShown: [],
    userAction: 'added',
    state: 'active',
    ...over,
  };
}

describe('turning an entry into one of my foods', () => {
  test('scales the figures to 100 g of what was logged', () => {
    const d = entryToFoodDraft(entry(), lookup);
    // 325 kcal across 250 g is 130 per 100 g.
    expect(d?.nutrientsPer100g.energyKcal).toBe(130);
    expect(d?.nutrientsPer100g.proteinG).toBe(5);
    expect(d?.referencePortion).toEqual({ label: 'as you logged it', grams: 250 });
  });

  test('leaves out a figure the entry could only vouch for as a floor', () => {
    // satFat is 'partial': part of the meal had no value for it, so 3 g is "at least 3 g". Scaling that into
    // a per-100 g table would restate a floor as a fact for every future portion.
    const d = entryToFoodDraft(entry({ coverage: { energyKcal: 'known', proteinG: 'known', satFatG: 'partial' } }), lookup);
    expect('satFatG' in (d?.nutrientsPer100g ?? {})).toBe(false);
    expect(d?.nutrientsPer100g.energyKcal).toBe(130);
  });

  test('leaves out a figure nobody knew, rather than writing zero', () => {
    const d = entryToFoodDraft(entry({ nutrients: { energyKcal: 325 }, coverage: { energyKcal: 'known' } }), lookup);
    expect('proteinG' in (d?.nutrientsPer100g ?? {})).toBe(false);
    expect(d?.nutrientsPer100g.proteinG).toBeUndefined();
  });

  test('carries the allergens of everything it was made from', () => {
    // An empty list is never "allergen-free", so losing these would silence a warning that always fired.
    expect(entryToFoodDraft(entry(), lookup)?.allergens).toEqual(['gluten', 'milk']);
  });

  test('refuses an entry whose weight is not known, rather than inventing a denominator', () => {
    expect(entryToFoodDraft(entry({ items: [{ source: 'dataset', foodId: 'f-oats', grams: Number.NaN, classification: FLAGS }] }), lookup)).toBeUndefined();
    expect(entryToFoodDraft(entry({ items: [] }), lookup)).toBeUndefined();
    expect(entryGrams(entry({ items: [{ source: 'dataset', foodId: 'f-oats', grams: 0, classification: FLAGS }] }))).toBeUndefined();
  });

  test('names it after what the person typed, so they recognise it', () => {
    expect(entryToFoodDraft(entry(), lookup)?.name).toBe('50 g oats with 200 ml milk');
  });

  test('rounds the way the app prints figures, rather than claiming three decimals', () => {
    // 521 kcal across 350 g is 148.857..., which must not appear as "148.857" in a box: it is arithmetic on
    // a portion someone estimated, not a measurement.
    const d = entryToFoodDraft(entry({ nutrients: { energyKcal: 521, proteinG: 44.9, satFatG: 3.09 }, coverage: { energyKcal: 'known', proteinG: 'known', satFatG: 'known' }, items: [{ source: 'dataset', foodId: 'f-oats', grams: 350, classification: FLAGS }] }), lookup);
    expect(d?.nutrientsPer100g.energyKcal).toBe(149);
    expect(d?.nutrientsPer100g.proteinG).toBe(13);
    expect(d?.nutrientsPer100g.satFatG).toBe(0.9);
  });

  test('never divides by zero or writes a figure that is not finite', () => {
    const d = entryToFoodDraft(entry(), lookup);
    for (const v of Object.values(d?.nutrientsPer100g ?? {})) expect(Number.isFinite(v)).toBe(true);
  });
});
