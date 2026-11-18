import { describe, expect, test, vi } from 'vitest';
import { readIngredients, type AiDeps } from '@/ai/aiFallback';
import { ingredientsOperation, type AiIngredient } from '@/ai/schemas';

const deps = (lines: AiIngredient[]): AiDeps => ({
  isEnabled: () => true,
  getKey: () => 'k',
  isOnline: () => true,
  interpret: vi.fn(async () => []),
  readIngredientList: vi.fn(async () => lines),
});

describe('reading a written recipe', () => {
  test('free text becomes the lines a batch is made of', async () => {
    const lines = await readIngredients(
      'lasagna with 500g beef, 400g pasta, 2 jars of tomato sauce',
      deps([
        { description: 'minced beef', quantity: 500, unit: 'g' },
        { description: 'pasta sheets', quantity: 400, unit: 'g' },
        { description: 'tomato sauce', quantity: 2, unit: 'jar' },
      ]),
    );
    expect(lines).toEqual(['500 g minced beef', '400 g pasta sheets', '2 jar tomato sauce']);
  });

  test('a stated amount is never replaced by an estimate', async () => {
    // The person cooking knows what went in the pan. 500 g in, 500 g out.
    const lines = await readIngredients('500 g beef', deps([{ description: 'minced beef', quantity: 500, unit: 'g' }]));
    expect(lines?.[0]).toBe('500 g minced beef');
    // And the prompt says so, rather than the behaviour resting on luck.
    expect(ingredientsOperation.systemPrompt).toMatch(/exactly as the text states them/i);
    expect(ingredientsOperation.systemPrompt).toMatch(/do not guess an amount the text does not give/i);
    expect(ingredientsOperation.systemPrompt).toMatch(/do not add an ingredient the text does not mention/i);
  });

  test('handles a decimal comma, which a Spanish recipe will have', () => {
    expect(ingredientsOperation.systemPrompt).toMatch(/decimal comma as a decimal point/i);
    expect(
      ingredientsOperation.validate({ items: [{ description: 'arroz', quantity: 1.5, unit: 'kg' }] }),
    ).toEqual([{ description: 'arroz', quantity: 1.5, unit: 'kg' }]);
  });

  test('carries no nutrition, whatever the model sends back', () => {
    const out = ingredientsOperation.validate({
      items: [{ description: 'minced beef', quantity: 500, unit: 'g', energyKcal: 1250, satFatG: 40 }],
    });
    expect(out).toEqual([{ description: 'minced beef', quantity: 500, unit: 'g' }]);
  });

  test('stays silent when the fallback is off, keyless, offline or cannot read lists', async () => {
    const base = deps([{ description: 'beef', quantity: 1, unit: 'g' }]);
    expect(await readIngredients('x', { ...base, isEnabled: () => false })).toBeNull();
    expect(await readIngredients('x', { ...base, isOnline: () => false })).toBeNull();
    expect(await readIngredients('x', { ...base, getKey: () => null })).toBeNull();
    const { readIngredientList: _omitted, ...without } = base;
    expect(await readIngredients('x', without)).toBeNull();
    expect(await readIngredients('x', undefined)).toBeNull();
    expect(await readIngredients('   ', base)).toBeNull();
  });

  test('stays silent when nothing usable came back, so the manual box is untouched', async () => {
    expect(await readIngredients('a recipe', deps([]))).toBeNull();
  });
});
