import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import { QUERY_SYNONYMS, datasetState, loadFoods, resetFoodRepository, searchFoods } from '@/data/foodRepository';

// Slow-ish: loads the real bundled dataset (~4 MB, 5,431 foods) and indexes it.
const fromDisk = (async (url: string) => {
  const rel = String(url).replace(import.meta.env.BASE_URL, '');
  const body = readFileSync(resolve(__dirname, '../../public', rel), 'utf8');
  return { ok: true, status: 200, text: async () => body } as Response;
}) as typeof fetch;

const ACCEPT = 0.25;
// Unresolvable by design: Dutch foods absent from USDA, and foods whose only dataset
// equivalent is a different food (passata -> salted cooking sauce).
const UNRESOLVABLE = ['frikandel', 'bitterballen', 'passata'];
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
  expect(searchFoods(q)).toEqual([]);
});

test('passata is not re-added to the query synonym map', () => {
  expect(QUERY_SYNONYMS).not.toHaveProperty('passata');
});

test.each(['zucchini', 'courgette', 'zucchinis', 'courgettes'])('"%s" resolves to fresh summer squash, never the pickled entry', (q) => {
  const hit = top(q)!;
  expect(hit.food.name).toBe('Summer squash, green, raw');
  expect(hit.food.per100g.sodiumMg).toBeLessThan(10);
});

test('a compound query falls back to the unmapped words when the mapped ones match nothing', () => {
  // zucchini -> "summer squash" turns "zucchini bread" into "summer squash bread", which no
  // food carries; the real zucchini baked goods are only reachable through the fallback.
  expect(top('zucchini bread')!.food.name).toBe('Bread, zucchini');
  expect(top('zucchini muffin')!.food.name).toBe('Muffin, zucchini');
  expect(top('zucchini cake')!.food.name).toBe('Cake or cupcake, zucchini');
});

// "-ies" is spelled the same for cookie/cookies and candy/candies, so the singulariser has to
// try both forms; mapping it to "y" alone made 93 cookie, 22 pie and 5 brownie foods unreachable.
test.each([
  ['cookies', 'cookie'],
  ['pies', 'pie'],
  ['brownies', 'brownie'],
])('the plural "%s" finds exactly what the singular "%s" finds', (plural, singular) => {
  const forPlural = top(plural);
  const forSingular = top(singular);
  expect(forSingular, `no hit for ${singular}`).toBeDefined();
  expect(forPlural, `no hit for ${plural}`).toBeDefined();
  expect(forPlural!.food.id).toBe(forSingular!.food.id);
  expect(forPlural!.food.name).toMatch(new RegExp(singular, 'i'));
});

test('"cookies" lands on the plain cookie, not on the one food named in the plural', () => {
  expect(top('cookies')!.food.name).toBe('Cookie, NFS');
});

test('an "-ies" query also reaches the "y" spelling, without reaching a near word', () => {
  // "candie" is one edit from "candied", so the typo tolerance has to stay off for a word
  // whose singular was guessed: a candy apple is not a sweet.
  expect(top('candies')!.food.name).toMatch(/^Candy/);
  expect(top('candies')!.food.id).toBe(top('candy')!.food.id);
});

test('a singular query reaches a food the dataset names in the plural', () => {
  expect(top('strawberry')!.food.name).toBe('Strawberries, raw');
  expect(top('strawberries')!.food.id).toBe(top('strawberry')!.food.id);
  expect(top('cherries')!.food.name).toBe('Cherries, raw');
});

test('penne and bare pasta resolve to plain refined "Pasta, cooked", outranking every qualified variant', () => {
  // The dataset contains no name with spaghetti, macaroni, tagliatelle, linguine, farfalle or orzo in it, so without
  // the synonym map every ordinary word for pasta resolves to nothing at all.
  for (const q of ['penne', 'pasta', 'fusilli', 'spaghetti', 'macaroni', 'tagliatelle', 'linguine', 'farfalle', 'orzo']) {
    const hit = top(q)!;
    expect(hit.food.name).toBe('Pasta, cooked');
    expect(hit.food.classification.refinedGrain).toBe(true);
  }
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

/** The measurement harness: prints the top hit per query so a regression is visible in CI output. */
test('the measured top-hit table', () => {
  const measured = [...QUERIES, 'zucchini', 'zucchini bread', 'cookies', 'pies', 'brownies'];
  const rows = measured.map((q) => {
    const hit = top(q);
    if (!hit) return `${q.padEnd(14)} NO HIT`;
    const na = hit.food.per100g.sodiumMg;
    return `${q.padEnd(14)} ${hit.score.toFixed(4)} ${hit.food.name} (Na ${na ?? 'unknown'})`;
  });
  console.log(`\n${rows.join('\n')}\n`);
  expect(rows.filter((r) => r.endsWith('NO HIT'))).toHaveLength(UNRESOLVABLE.length);
});

test('every hit contains every query word, so no confident wrong matches', () => {
  for (const q of ['cola', 'white bread', 'cheddar cheese', 'salmon']) {
    for (const { food } of searchFoods(q, 10)) {
      const hay = `${food.name} ${food.synonyms.join(' ')}`.toLowerCase();
      for (const w of q.split(' ')) expect(hay).toContain(w);
    }
  }
});
