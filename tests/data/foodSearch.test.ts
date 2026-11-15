import { expect, test } from 'vitest';
import {
  QUERY_SYNONYMS,
  buildSearchIndex,
  normalizeTokens,
  search,
  singularForms,
  singularize,
} from '@/data/foodSearch';
import type { DatasetFood } from '@/types/food';

// The search layer is pure: no fetch fake, no module reset, no shared state between tests.
function food(id: string, name: string, synonyms: string[] = []): DatasetFood {
  return {
    id,
    name,
    synonyms,
    per100g: {},
    portions: [],
    classification: {
      processedMeat: false,
      redMeat: false,
      sweetDrink: false,
      alcohol: false,
      novaGroup: 1,
      refinedGrain: false,
      vegetable: false,
      fruit: false,
      legume: false,
      oilyFish: false,
    },
    allergens: [],
  };
}

const FOODS = [
  food('squash', 'Summer squash, green, raw'),
  food('squash-ingredient', 'Summer squash, cooked, as ingredient'),
  food('bread-zucchini', 'Bread, zucchini'),
  food('zucchini-pickled', 'Zucchini, pickled'),
  food('cookie-almond', 'Cookie, almond'),
  food('cookie-oatmeal', 'Cookie, oatmeal'),
  food('candy', 'Candy, caramel'),
  food('apple-candied', 'Apple, candied'),
  food('chocolate', 'Chocolate candy', ['sweets']),
];

const index = buildSearchIndex(FOODS);
const ids = (query: string, limit?: number) => search(index, query, limit).map((h) => h.food.id);

test('every query word must be present in one candidate', () => {
  expect(ids('summer squash')).toContain('squash');
  expect(ids('summer sausage')).toEqual([]);
});

test('a mapped word is replaced, and base-form ranking picks the plain variant', () => {
  // zucchini -> "summer squash": the pickled entry must not win, and nor must the one with the
  // wordier qualifier.
  expect(ids('zucchini')[0]).toBe('squash');
  expect(ids('courgette')[0]).toBe('squash');
});

test('a compound using a mapped word falls back to the words as typed', () => {
  // "summer squash bread" matches nothing, so the literal "zucchini bread" gets its turn.
  expect(ids('zucchini bread')).toEqual(['bread-zucchini']);
});

test('the fallback is a second pass, not a widening of the first', () => {
  // "summer squash" hits, so "zucchini" never falls back to the pickled entry.
  expect(ids('zucchini')).not.toContain('zucchini-pickled');
});

test('an unmapped query is searched once, not twice', () => {
  expect(ids('cookie')).toEqual(['cookie-almond', 'cookie-oatmeal']);
});

test('both "-ies" singulars are tried, and neither gets the typo tolerance', () => {
  expect(ids('cookies')).toEqual(['cookie-almond', 'cookie-oatmeal']);
  expect(ids('candies')).toEqual(['candy', 'chocolate']); // not "Apple, candied"
});

test('a name match outranks a dataset-synonym match', () => {
  expect(ids('candy')).toEqual(['candy', 'chocolate']);
  expect(ids('sweets')).toEqual(['chocolate']);
});

test('limit truncates and a limit of zero or less returns nothing', () => {
  expect(ids('cookie', 1)).toEqual(['cookie-almond']);
  expect(ids('cookie', 0)).toEqual([]);
  expect(ids('cookie', -1)).toEqual([]);
});

test('an empty or punctuation-only query returns nothing', () => {
  expect(ids('')).toEqual([]);
  expect(ids('   ')).toEqual([]);
  expect(ids('...')).toEqual([]);
});

test('equal-ranked hits keep one total order whatever order the dataset is in', () => {
  const reversed = buildSearchIndex([...FOODS].reverse());
  expect(search(reversed, 'cookie').map((h) => h.food.id)).toEqual(ids('cookie'));
});

test('two indexes are independent', () => {
  const small = buildSearchIndex([food('only', 'Cookie, NFS')]);
  expect(search(small, 'cookies').map((h) => h.food.id)).toEqual(['only']);
  expect(ids('cookies')).toEqual(['cookie-almond', 'cookie-oatmeal']);
});

test('a query word is always offered in the form the dataset stores', () => {
  for (const w of ['cookies', 'candies', 'pies', 'strawberries', 'eggs', 'boxes', 'basis', 'rice']) {
    expect(singularForms(w), w).toContain(singularize(w));
  }
  expect(singularForms('cookies')).toEqual(['cookie', 'cooky']);
  expect(normalizeTokens('Cookies, Puerto Rican style')).toEqual([
    'cooky',
    'puerto',
    'rican',
    'style',
  ]);
});

test('the synonym map stays frozen and free of the rejected entries', () => {
  expect(Object.isFrozen(QUERY_SYNONYMS)).toBe(true);
  for (const k of ['passata', 'chips', 'mince', 'sweets', 'ice lolly']) {
    expect(QUERY_SYNONYMS).not.toHaveProperty(k);
  }
});
