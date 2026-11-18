import { describe, expect, test } from 'vitest';
import { parseQuantity } from '@/domain/quantity';

/**
 * What the quantity parser does with Spanish phrasing, before any model is involved.
 *
 * The addendum says to test before building, and this is the half that can be tested without a key: whether a
 * phrase even reaches the fallback, or fails earlier in the parser. A phrase whose quantity parses is one the
 * dataset search gets a fair go at; one whose quantity does not parse is a gap worth knowing about.
 *
 * Recorded as characterisation, not as a wish list: where a case does not work, the test says so plainly rather
 * than being deleted, so the next person knows it was checked and what was found.
 */
describe('Spanish quantities, as the parser handles them today', () => {
  test('a decimal comma is read as a decimal point', () => {
    const q = parseQuantity('1,5 kg de arroz');
    expect(q?.quantity).toEqual({ grams: 1500 });
  });

  test('metric units parse whatever the food word is', () => {
    expect(parseQuantity('200 g de pollo')?.quantity).toEqual({ grams: 200 });
    expect(parseQuantity('250 ml de leche')?.quantity).toEqual({ grams: 250 });
  });

  test('a bare count parses', () => {
    expect(parseQuantity('2 huevos')?.quantity).toEqual({ count: 2 });
  });

  test('Spanish amount words are read as amounts, with no key and no network', () => {
    // The gap this found: digits and metric units are language-neutral and always worked, but "medio",
    // "un" and "dos" did not, so a Spanish phrase could not even reach the dataset search without a model.
    // These parse offline now, which the AI fallback can never claim.
    expect(parseQuantity('medio aguacate')?.quantity).toEqual({ count: 0.5 });
    expect(parseQuantity('media manzana')?.quantity).toEqual({ count: 0.5 });
    expect(parseQuantity('dos huevos')?.quantity).toEqual({ count: 2 });
    expect(parseQuantity('una loncha de jamón')?.quantity).toEqual({ count: 1 });
  });

  test('the food is left for the search, with the preposition stripped', () => {
    // "de" belongs to the phrasing, not to the food: searching for "de arroz" would find nothing.
    expect(parseQuantity('medio aguacate')?.rest).toBe('aguacate');
    expect(parseQuantity('dos huevos')?.rest).toBe('huevos');
    expect(parseQuantity('una loncha de jamón')?.rest).toBe('loncha de jamón');
  });

  test('a phrase with no number at all leaves the whole text for the search', () => {
    expect(parseQuantity('pechuga de pollo')).toBeNull();
  });

  test('the English words still mean what they did', () => {
    expect(parseQuantity('half an avocado')?.quantity).toEqual({ count: 0.5 });
    expect(parseQuantity('two eggs')?.quantity).toEqual({ count: 2 });
  });
});
