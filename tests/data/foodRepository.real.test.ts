import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import { datasetState, loadFoods, resetFoodRepository, searchFoods } from '@/data/foodRepository';

// Slow-ish: loads the real bundled dataset (~4 MB, 5,431 foods) and indexes it.
const fromDisk = (async (url: string) => {
  const rel = String(url).replace(import.meta.env.BASE_URL, '');
  const body = readFileSync(resolve(__dirname, '../../public', rel), 'utf8');
  return { ok: true, status: 200, text: async () => body } as Response;
}) as typeof fetch;

const ACCEPT = 0.25;
const UNRESOLVABLE = ['frikandel', 'bitterballen'];
const QUERIES = [
  'hot dogs', 'hot dog', 'cola', 'penne', 'passata', 'white bread', 'cheddar cheese', 'yoghurt',
  'apple', 'eggs', 'salmon', 'bitterballen', 'frikandel', 'coke', 'crisps', 'aubergine',
  'courgette', 'banana', 'milk', 'rice',
];

const top = (q: string) => searchFoods(q, 1)[0];

beforeAll(async () => {
  resetFoodRepository();
  await loadFoods(fromDisk);
}, 60_000);

test('the real dataset loads', () => {
  expect(datasetState()).toBe('ready');
});

test.each(QUERIES.filter((q) => !UNRESOLVABLE.includes(q)))('"%s" resolves within the accept threshold', (q) => {
  const hit = top(q);
  expect(hit, `no hit for ${q}`).toBeDefined();
  expect(hit!.score).toBeLessThanOrEqual(ACCEPT);
});

test.each(UNRESOLVABLE)('"%s" is correctly unresolvable', (q) => {
  const hit = top(q);
  expect(hit === undefined || hit.score > ACCEPT).toBe(true);
});

test('cola resolves to a cola drink, not a confectionery; coke is the same', () => {
  expect(top('cola')!.food.name).toMatch(/^Soft drink, cola/);
  expect(top('coke')!.food.id).toBe(top('cola')!.food.id);
});

test('apple, eggs and salmon resolve to plain variants', () => {
  expect(top('apple')!.food.name).toBe('Apple, raw');
  expect(top('eggs')!.food.name).toMatch(/^Egg, whole/);
  expect(top('salmon')!.food.name).toMatch(/^Fish, salmon, (raw|NFS)/);
});

test('hot dogs and hot dog resolve to the same food', () => {
  expect(top('hot dogs')!.food.id).toBe(top('hot dog')!.food.id);
  expect(top('hot dog')!.food.name).toMatch(/^Hot dog, /);
});

test('every hit contains every query word, so no confident wrong matches', () => {
  for (const q of ['cola', 'white bread', 'cheddar cheese', 'salmon']) {
    for (const { food } of searchFoods(q, 10)) {
      const hay = `${food.name} ${food.synonyms.join(' ')}`.toLowerCase();
      for (const w of q.split(' ')) expect(hay).toContain(w);
    }
  }
});
