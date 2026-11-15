// @vitest-environment node
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildFoodDb } from '../../scripts/build-food-db';
import type { DatasetFood } from '@/types/food';

const FIXTURES = 'tests/fixtures/usda';

interface Meta {
  fdcRelease: string;
  fpedRelease: string;
  builtAt: string;
  citation: string;
  count: number;
  file: string;
}

let tmp: string;
let built: { count: number; bytes: number };
let foods: DatasetFood[];
let meta: Meta;

const find = (re: RegExp): DatasetFood => {
  const f = foods.find((x) => re.test(x.name));
  if (!f) throw new Error(`no fixture food matches ${re}`);
  return f;
};

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'food-db-'));
  built = await buildFoodDb(FIXTURES, tmp);
  meta = JSON.parse(readFileSync(join(tmp, 'meta.json'), 'utf8')) as Meta;
  foods = JSON.parse(readFileSync(join(tmp, meta.file), 'utf8')) as DatasetFood[];
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('buildFoodDb', () => {
  test('emits foods with per-100g nutrients and portion rows', () => {
    // FNDDS 2021-2023 has no item named "frankfurter"; the frankfurter category holds "Hot dog, ..." items.
    const hotDog = find(/^Hot dog, beef$/);
    expect(hotDog.per100g.sodiumMg).toBeGreaterThan(0);
    expect(hotDog.portions).toContainEqual({ label: '1 regular', grams: 57 });
    expect(hotDog.portions.every((p) => p.grams > 0)).toBe(true);
    expect(built.count).toBe(foods.length);
    expect(meta.count).toBe(foods.length);
    expect(built.bytes).toBe(readFileSync(join(tmp, meta.file)).length);
  });

  test('processed meat is flagged from the curated classification layer', () => {
    const hotDog = find(/^Hot dog, beef$/);
    expect(hotDog.classification.processedMeat).toBe(true);
    expect(hotDog.classification.novaGroup).toBe(4);
    expect(find(/^Bacon, NS as to type of meat, cooked$/).classification.processedMeat).toBe(true);
    expect(find(/^Ham$/).classification.processedMeat).toBe(true);
    expect(find(/^Salami, NFS$/).classification.processedMeat).toBe(true);
    // fresh cuts / plain foods are not
    expect(find(/^Egg, whole, boiled or poached$/).classification.processedMeat).toBe(false);
    expect(find(/^Apple, raw$/).classification.fruit).toBe(true);
  });

  test('added sugars are omitted, not zeroed, when FPED has no value', () => {
    const f = find(/^Test food, no FPED$/);
    expect('addedSugarsG' in f.per100g).toBe(false);
    expect(f.fped).toBeUndefined();
    // a blank USDA amount is unknown, not 0
    expect('sodiumMg' in f.per100g).toBe(false);
    // trans fat is not reported by FNDDS at all: never invented
    expect(foods.every((x) => !('transFatG' in x.per100g))).toBe(true);
    // values USDA does report are kept
    expect(f.per100g.proteinG).toBeCloseTo(4.2);
  });

  test('added sugars come from FPED teaspoon equivalents when FPED has a value', () => {
    const cola = find(/^Soft drink, cola$/);
    expect(cola.per100g.addedSugarsG).toBeGreaterThan(0);
    expect(cola.classification.sweetDrink).toBe(true);
    expect(cola.fped).toBeDefined();
  });

  test('FPED rows flagged as having no components are treated as unknown, not zero', () => {
    // FPED lists this drink with 0 added sugars and NO_COMPONENTS set; that zero is not a measurement.
    const drink = find(/^Energy drink \(Ocean Spray Cran-Energy Juice Drink\)$/);
    expect('addedSugarsG' in drink.per100g).toBe(false);
    expect(drink.fped).toBeUndefined();
    // USDA's own FNDDS values for the same food are untouched
    expect(drink.per100g.sugarsG).toBeGreaterThan(0);
  });

  test('meta.json records the dataset releases and the CC0 citation', () => {
    expect(meta.citation).toMatch(/FoodData Central/);
    expect(meta.citation).toMatch(/CC0/);
    expect(meta.fdcRelease).toBeTruthy();
    expect(meta.fpedRelease).toBeTruthy();
    expect(Number.isNaN(Date.parse(meta.builtAt))).toBe(false);
    expect(readdirSync(tmp).filter((n) => /^foods\.[0-9a-f]+\.json$/.test(n))).toEqual([meta.file]);
  });

  test('every emitted food carries allergen tags from the curated layer', () => {
    expect(foods.every((f) => Array.isArray(f.allergens))).toBe(true);
    expect(find(/^Egg, whole, boiled or poached$/).allergens).toContain('eggs');
    expect(find(/^Milk, whole$/).allergens).toContain('milk');
    expect(find(/^Bread, white$/).allergens).toContain('gluten');
  });

  test('no emitted nutrient is NaN, null or negative', () => {
    for (const f of foods) {
      for (const v of Object.values(f.per100g)) {
        expect(typeof v === 'number' && Number.isFinite(v) && v >= 0).toBe(true);
      }
    }
  });
});
