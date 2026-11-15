import { describe, expect, test } from 'vitest';
import { parseQuantity } from '@/domain/quantity';

describe('parseQuantity', () => {
  test('parseQuantity reads number words and leaves the food name', () => {
    expect(parseQuantity('two hot dogs')).toEqual({ quantity: { count: 2 }, rest: 'hot dogs' });
  });

  test('parseQuantity reads metric weights', () => {
    expect(parseQuantity('500 g penne')!.quantity).toEqual({ grams: 500 });
    expect(parseQuantity('1.5 kg potatoes')!.quantity).toEqual({ grams: 1500 });
  });

  test('parseQuantity reads kitchen units without inventing a gram weight', () => {
    const q = parseQuantity('2 tbsp olive oil')!.quantity;
    expect(q).toEqual({ count: 2, unitLabel: 'tbsp' }); // grams come from portion data later
  });

  test('fractions and half', () => {
    expect(parseQuantity('1/2 cup rice')).toEqual({ quantity: { count: 0.5, unitLabel: 'cup' }, rest: 'rice' });
    expect(parseQuantity('half a banana')).toEqual({ quantity: { count: 0.5 }, rest: 'banana' });
  });

  test('unit attached to the number', () => {
    expect(parseQuantity('500g penne')).toEqual({ quantity: { grams: 500 }, rest: 'penne' });
  });

  test('"of" after a unit is dropped from the rest', () => {
    expect(parseQuantity('2 slices of white bread')).toEqual({
      quantity: { count: 2, unitLabel: 'slice' },
      rest: 'white bread',
    });
  });

  test('volume units convert 1:1 to grams', () => {
    expect(parseQuantity('250 ml milk')!.quantity).toEqual({ grams: 250 });
    expect(parseQuantity('1.5 litres water')!.quantity).toEqual({ grams: 1500 });
  });

  test('a / an count as one, and number words work', () => {
    expect(parseQuantity('a cola')).toEqual({ quantity: { count: 1 }, rest: 'cola' });
    expect(parseQuantity('twenty almonds')!.quantity).toEqual({ count: 20 });
  });

  test('no quantity returns null; units never match inside words', () => {
    expect(parseQuantity('apple')).toBeNull();
    expect(parseQuantity('2 lemons')).toEqual({ quantity: { count: 2 }, rest: 'lemons' });
    expect(parseQuantity('a lemon')).toEqual({ quantity: { count: 1 }, rest: 'lemon' });
  });

  test('negative and zero are parsed as given, not rejected', () => {
    expect(parseQuantity('-2 apples')!.quantity).toEqual({ count: -2 });
    expect(parseQuantity('0 apples')!.quantity).toEqual({ count: 0 });
  });

  test('malformed numbers never produce NaN or Infinity', () => {
    expect(parseQuantity('1/0 cup rice')).toBeNull();
    expect(parseQuantity('9'.repeat(400) + ' apples')).toBeNull();
    expect(parseQuantity('')).toBeNull();
  });
});
