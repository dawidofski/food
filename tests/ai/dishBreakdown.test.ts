import { describe, expect, test, vi } from 'vitest';
import { applyDish, type AiDeps } from '@/ai/aiFallback';
import { dishOperation, type AiComponent } from '@/ai/schemas';
import { FLAGS, lookupOf } from '../fixtures/batchFoods';
import type { DatasetFood } from '@/types/food';

const food = (id: string, name: string): DatasetFood => ({
  id,
  name,
  synonyms: [],
  per100g: { energyKcal: 150, proteinG: 10 },
  portions: [{ label: '100 g', grams: 100 }],
  classification: FLAGS,
  allergens: [],
});

const rice = food('rice', 'boiled white rice');
const chicken = food('chicken', 'chicken breast');

const deps = (components: AiComponent[]): AiDeps => ({
  isEnabled: () => true,
  getKey: () => 'k',
  isOnline: () => true,
  interpret: vi.fn(async () => []),
  breakDownDish: vi.fn(async () => components),
});

describe('dishOperation', () => {
  test('a dish comes back as components the dataset can be searched with', () => {
    const raw = {
      items: [
        { description: 'chicken in spiced tomato and cream sauce', quantity: 250, unit: 'g' },
        { description: 'boiled white rice', quantity: 180, unit: 'g' },
      ],
    };
    expect(dishOperation.validate(raw)).toHaveLength(2);
  });

  test('a component carries no nutrient, whatever the model sends', () => {
    const raw = { items: [{ description: 'rice', quantity: 180, unit: 'g', energyKcal: 240 }] };
    expect(dishOperation.validate(raw)).toEqual([{ description: 'rice', quantity: 180, unit: 'g' }]);
  });

  test('its prompt asks for one serving and forbids nutrition', () => {
    expect(dishOperation.systemPrompt).toMatch(/ONE serving/);
    expect(dishOperation.systemPrompt).toMatch(/never provide nutrition values/i);
  });
});

describe('applyDish', () => {
  const lookup = lookupOf([rice, chicken]);

  test('resolves the components the dataset knows', async () => {
    const applied = await applyDish(
      'chicken and rice',
      lookup,
      deps([
        { description: 'boiled white rice', quantity: 180, unit: 'g' },
        { description: 'chicken breast', quantity: 150, unit: 'g' },
      ]),
    );
    expect(applied?.items).toHaveLength(2);
    expect(applied?.resolution.needsHelp).toHaveLength(0);
    expect(applied?.readings[0]?.reads.join(' ')).toMatch(/boiled white rice/);
  });

  test('a component the dataset cannot match leaves the rest resolved and itself unresolved', async () => {
    // Review Focus 2: a partial answer is a partial answer. Dropping the unmatched quarter of a meal would
    // understate the day while looking complete.
    const applied = await applyDish(
      'chicken tikka masala with rice',
      lookup,
      deps([
        { description: 'boiled white rice', quantity: 180, unit: 'g' },
        { description: 'spiced tomato and cream sauce', quantity: 250, unit: 'g' },
      ]),
    );
    expect(applied?.items).toHaveLength(2);
    expect(applied?.resolution.needsHelp).toHaveLength(1);
    expect(applied?.resolution.needsHelp[0]?.foodQuery).toMatch(/spiced tomato/);
    // And the part that did resolve still carries its figures.
    expect(applied?.resolution.refs).toHaveLength(1);
  });

  test('a component is matched on its whole description, and what it matched is reported back', async () => {
    // findFoodByDescription falls back to whichever food covers the most words, so a detailed component can
    // land on a plainer food — "chicken in spiced tomato and cream sauce" on plain chicken breast, losing the
    // sauce's fat. That is why every reading is shown to the person before anything is saved: the reading is
    // the thing they can check.
    const applied = await applyDish(
      'x',
      lookup,
      deps([{ description: 'chicken in spiced tomato and cream sauce', quantity: 250, unit: 'g' }]),
    );
    expect(applied?.readings[0]?.reads).toEqual(['250 g chicken breast']);
  });

  test('never reads a nutrient from the model: every figure comes from the dataset', async () => {
    const applied = await applyDish(
      'rice',
      lookup,
      deps([{ description: 'boiled white rice', quantity: 100, unit: 'g' }]),
    );
    // 100 g of the fixture food is 150 kcal; anything else would mean a figure came from somewhere else.
    expect(applied?.resolution.nutrients.energyKcal).toBe(150);
  });

  test('stays silent when the fallback is off, offline, keyless, or cannot break dishes down', async () => {
    const base = deps([{ description: 'boiled white rice', quantity: 100, unit: 'g' }]);
    expect(await applyDish('rice', lookup, { ...base, isEnabled: () => false })).toBeNull();
    expect(await applyDish('rice', lookup, { ...base, isOnline: () => false })).toBeNull();
    expect(await applyDish('rice', lookup, { ...base, getKey: () => null })).toBeNull();
    const { breakDownDish: _omitted, ...withoutDish } = base;
    expect(await applyDish('rice', lookup, withoutDish)).toBeNull();
    expect(await applyDish('rice', lookup, undefined)).toBeNull();
    expect(await applyDish('   ', lookup, base)).toBeNull();
  });

  test('stays silent when the model returns nothing usable', async () => {
    expect(await applyDish('rice', lookup, deps([]))).toBeNull();
  });
});
