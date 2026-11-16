import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { datasetLookup } from '@/data/datasetLookup';
import { loadFoods, resetFoodRepository } from '@/data/foodRepository';
import { buildBatch, isCookedGrain } from '@/domain/batches';
import type { DatasetFood } from '@/types/food';

const dir = resolve(__dirname, '../../public/data');
const file = readdirSync(dir).find((f) => /^foods\..*\.json$/.test(f))!;
const foods = JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as DatasetFood[];

const fromDisk = (async (url: string) => {
  const rel = String(url).replace(import.meta.env.BASE_URL, '');
  const body = readFileSync(resolve(__dirname, '../../public', rel), 'utf8');
  return { ok: true, status: 200, text: async () => body } as Response;
}) as typeof fetch;

beforeAll(async () => {
  resetFoodRepository();
  await loadFoods(fromDisk);
}, 60_000);

describe('isCookedGrain over the real dataset', () => {
  const matched = foods.filter((f) => isCookedGrain(f.name));

  test('every match is a plain grain, pasta, noodle or rice row, never a dish, cereal, milk or snack', () => {
    expect(matched.length).toBeGreaterThan(20);
    const heads = new Set(matched.map((f) => f.name.split(',')[0]!.trim().toLowerCase()));
    expect([...heads].sort()).toEqual(
      ['barley', 'bulgur', 'couscous', 'millet', 'noodles', 'pasta', 'quinoa', 'rice', 'rice noodles'],
    );
    for (const f of matched) expect(f.name).not.toMatch(/\b(with|fried|sauce|creamed|sweet|restaurant|ready-to-heat|home recipe|chow mein)\b/i);
  });

  test('none of the previously over-matched names fire', () => {
    for (const bad of ['Oat milk', 'Rice milk', 'Cookie, oatmeal', 'Cereal, rice squares', 'Infant formula, store brand', 'Beef, rice', 'Pasta with sauce, NFS']) {
      expect(foods.some((f) => f.name === bad && isCookedGrain(f.name))).toBe(false);
    }
  });

  test('"500 g penne" resolves to a cooked-pasta row that is flagged', () => {
    const { batch, cookedWeightNotes } = buildBatch(
      { name: 'Penne', portionCount: 2, ingredientLines: ['500 g penne'] }, datasetLookup,
    );
    expect(batch.ingredients[0]!.refs).toHaveLength(1);
    expect(cookedWeightNotes).toHaveLength(1);
    expect(cookedWeightNotes[0]!.foodName).toMatch(/^Pasta/);
  });

  test('"300 g white rice" and "200 g rice" resolve and are flagged', () => {
    for (const line of ['300 g white rice', '200 g rice']) {
      const { cookedWeightNotes, needsHelp } = buildBatch({ name: 'R', portionCount: 2, ingredientLines: [line] }, datasetLookup);
      expect(needsHelp, line).toEqual([]);
      expect(cookedWeightNotes, line).toHaveLength(1);
    }
  });
});
