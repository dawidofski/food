import { describe, expect, test } from 'vitest';
import { parseEntry } from '@/domain/parseEntry';

describe('parseEntry', () => {
  test('parseEntry splits a multi-food sentence', () => {
    const { items } = parseEntry('two hot dogs and a cola');
    expect(items.map((i) => i.foodQuery)).toEqual(['hot dogs', 'cola']);
  });

  test('no quantity defaults to one', () => {
    expect(parseEntry('an apple').items[0]!.quantity).toEqual({ count: 1 });
    expect(parseEntry('pizza').items[0]!.quantity).toEqual({ count: 1 });
  });

  // Review Focus 1 — empty or unparseable text
  test.each(['', '   ', 'asdf', '🍕🍕', 'x'.repeat(2000)])('unparseable input yields no items: %s', (t) => {
    const { items, unparseable } = parseEntry(t);
    expect(items).toEqual([]);
    expect(unparseable.length === 0 || unparseable.length === 1).toBe(true);
  });

  test('strips leading filler', () => {
    expect(parseEntry('I ate two eggs').items[0]).toMatchObject({ foodQuery: 'eggs', quantity: { count: 2 } });
    expect(parseEntry('I drank a cola').items[0]).toMatchObject({ foodQuery: 'cola' });
  });

  test('mixed entry with commas, and, quantities and units', () => {
    const { items, unparseable } = parseEntry('I had 2 eggs, 500 g penne and a cola');
    expect(unparseable).toEqual([]);
    expect(items.map((i) => [i.foodQuery, i.quantity])).toEqual([
      ['eggs', { count: 2 }],
      ['penne', { grams: 500 }],
      ['cola', { count: 1 }],
    ]);
  });

  test('splits on plus and newlines; keeps kitchen units', () => {
    const { items } = parseEntry('2 slices of white bread + 1 tbsp butter\n1/2 cup rice');
    expect(items.map((i) => [i.foodQuery, i.quantity])).toEqual([
      ['white bread', { count: 2, unitLabel: 'slice' }],
      ['butter', { count: 1, unitLabel: 'tbsp' }],
      ['rice', { count: 0.5, unitLabel: 'cup' }],
    ]);
  });

  test('half a banana', () => {
    expect(parseEntry('half a banana').items[0]).toMatchObject({ foodQuery: 'banana', quantity: { count: 0.5 } });
  });

  test('ambiguity pinned: "a cola and a half" yields the cola; "a half" has no food so is unparseable', () => {
    const { items, unparseable } = parseEntry('a cola and a half');
    expect(items.map((i) => i.foodQuery)).toEqual(['cola']);
    expect(unparseable).toEqual(['a half']);
  });

  test('quantity with no food is unparseable, not an item', () => {
    const { items, unparseable } = parseEntry('2 cups');
    expect(items).toEqual([]);
    expect(unparseable).toEqual(['2 cups']);
  });

  test('negative quantities are parsed faithfully for Task 7 to reject', () => {
    expect(parseEntry('-2 apples').items[0]!.quantity).toEqual({ count: -2 });
  });

  test('input is capped at 1000 characters', () => {
    const t = 'apple, '.repeat(300);
    expect(parseEntry(t).items.length).toBeLessThanOrEqual(143);
  });
});
