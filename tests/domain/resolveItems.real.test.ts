import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { datasetState, loadFoods, resetFoodRepository } from '@/data/foodRepository';
import { datasetLookup } from '@/data/datasetLookup';
import { parseEntry } from '@/domain/parseEntry';
import { resolveItems } from '@/domain/resolveItems';

// Slow-ish: loads the real bundled dataset (~4 MB, 5,431 foods). Real FNDDS portion labels are
// what make bare counts hard ("1 cup, cooked", "1 can (12 fl oz)"), so fixtures alone prove little.
const fromDisk = (async (url: string) => {
  const rel = String(url).replace(import.meta.env.BASE_URL, '');
  const body = readFileSync(resolve(__dirname, '../../public', rel), 'utf8');
  return { ok: true, status: 200, text: async () => body } as Response;
}) as typeof fetch;

beforeAll(async () => {
  resetFoodRepository();
  await loadFoods(fromDisk);
}, 60_000);

const resolveText = (text: string) => resolveItems(parseEntry(text).items, datasetLookup);
const gramsOf = (text: string) => resolveText(text).refs.map((r) => r.grams);

test('the real dataset is loaded', () => {
  expect(datasetState()).toBe('ready');
});

describe('everyday entries resolve end to end with no needsHelp', () => {
  // [text, ref count, [min, max] grams per ref]. Ranges, not exact values, where the portion
  // choice may legitimately shift; tight where the design pins a portion.
  const CASES: [string, number, [number, number][]][] = [
    ['I ate two hot dogs and a cola', 2, [[100, 130], [300, 400]]],
    ['two hot dogs and a cola', 2, [[100, 130], [300, 400]]],
    ['rice', 1, [[120, 250]]],
    ['an apple', 1, [[150, 250]]],
    ['2 slices of white bread', 1, [[40, 80]]],
    ['a glass of milk', 1, [[180, 300]]],
    ['2 eggs', 1, [[80, 130]]],
    ['500 g penne', 1, [[500, 500]]],
  ];
  test.each(CASES)('%s', (text, n, ranges) => {
    const r = resolveText(text);
    expect(r.needsHelp, JSON.stringify(r.needsHelp)).toEqual([]);
    expect(r.refs).toHaveLength(n);
    r.refs.forEach((ref, i) => {
      const [lo, hi] = ranges[i]!;
      expect(ref.grams, `${text} #${i} ${ref.foodId} ${ref.portionLabel ?? ''}`).toBeGreaterThanOrEqual(lo);
      expect(ref.grams, `${text} #${i}`).toBeLessThanOrEqual(hi);
    });
    expect(Object.values(r.nutrients).every(Number.isFinite)).toBe(true);
  });
});

describe('pinned bare-count portions', () => {
  test('rice is one cup, cooked (158 g)', () => expect(gramsOf('rice')).toEqual([158]));
  test('milk is one cup (244 g), not a school container', () => {
    const r = resolveText('milk');
    expect(r.refs[0]!.grams).toBe(244);
    expect(r.refs[0]!.portionLabel).toBe('1 cup');
  });
  test('a hot pepper is the 15 g pepper, not a 150 g cup (labels containing "per" are not guideline rows)', () => {
    const r = resolveText('a hot pepper');
    expect(r.needsHelp).toEqual([]);
    expect(r.refs[0]!.portionLabel).toBe('1 pepper');
    expect(r.refs[0]!.grams).toBeCloseTo(15, 0);
  });
  test('milk never takes a 2.5 g guideline row', () => {
    const r = resolveText('a glass of milk');
    expect(r.refs[0]!.grams).toBe(244);
    expect(r.refs[0]!.portionLabel).toBe('1 cup');
  });
  test('a banana is the whole 126 g banana, not a 6 g slice', () => {
    const r = resolveText('a banana');
    expect(r.refs[0]!.portionLabel).toBe('1 banana');
    expect(r.refs[0]!.grams).toBe(126);
  });
  test('an apricot is the whole 35 g fruit, not a slice/chunk', () => {
    expect(resolveText('an apricot').refs[0]!.grams).toBeCloseTo(35, 0);
  });
  test("cereal O's takes the single serving, not a 0.1 g piece", () => {
    const r = resolveText("cereal o's");
    expect(r.needsHelp).toEqual([]);
    expect(r.refs[0]!.grams).toBeGreaterThanOrEqual(25);
  });
  test('apple takes the medium (200 g)', () => expect(gramsOf('an apple')).toEqual([200]));
  test('two hot dogs is 114 g from "1 regular"', () => expect(gramsOf('two hot dogs')).toEqual([114]));
  test('a cola is the can, never a fluid ounce', () => {
    const [g] = gramsOf('a cola');
    expect(g).toBeGreaterThan(300);
  });
  test('white bread takes the regular slice', () => {
    const r = resolveText('2 slices of white bread');
    expect(r.refs[0]!.grams).toBeGreaterThanOrEqual(40);
    expect(r.refs[0]!.portionLabel ?? '').not.toMatch(/crust/i);
  });
  test('barley is a cooked cup (about 170 g), not a dry cup yielding 740 g', () => {
    const r = resolveText('barley');
    expect(r.needsHelp).toEqual([]);
    expect(r.refs[0]!.portionLabel).toBe('1 cup, cooked');
    expect(r.refs[0]!.grams).toBe(170);
  });
  test('cream of wheat is a cooked cup (about 240 g), not a dry cup yielding 965 g', () => {
    const r = resolveText('cream of wheat');
    expect(r.needsHelp).toEqual([]);
    expect(r.refs[0]!.portionLabel).toBe('1 cup, cooked');
    expect(r.refs[0]!.grams).toBe(240);
  });
  // "meat loaf" alone matches "Meat loaf, Puerto Rican style" (one 95 g serving row), so this
  // names the variety to reach a food that carries both slice and meatball rows.
  test('meat loaf is a 108 g slice, not a 28 g meatball', () => {
    const r = resolveText('meat loaf made with ham');
    expect(r.needsHelp).toEqual([]);
    expect(r.refs[0]!.portionLabel).toBe('1 medium slice');
    expect(r.refs[0]!.grams).toBe(108);
  });
  test('a meatball food still resolves to its own meatball, not a cup', () => {
    const r = resolveText('meatballs with sauce');
    expect(r.needsHelp).toEqual([]);
    expect(r.refs[0]!.portionLabel).toMatch(/meatball/i);
  });
  test('a chicken breast is the whole breast, not a 60 g medium slice', () => {
    const r = resolveText('a chicken breast');
    expect(r.needsHelp).toEqual([]);
    expect(r.refs[0]!.portionLabel).toBe('1 breast');
    expect(r.refs[0]!.grams).toBeGreaterThanOrEqual(120);
  });
  test('an explicit unit still wins over the ranking', () => {
    const r = resolveText('2 tbsp olive oil');
    expect(r.needsHelp).toEqual([]);
    expect(r.refs[0]!.portionLabel).toMatch(/tbsp|tablespoon/i);
    expect(r.refs[0]!.grams).toBeGreaterThan(20);
    expect(r.refs[0]!.grams).toBeLessThan(35);
  });
});
