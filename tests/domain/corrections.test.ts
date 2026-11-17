import { describe, expect, test } from 'vitest';
import { applyCorrection } from '@/domain/corrections';

describe('applyCorrection', () => {
  test('a corrected figure is known, because the person asserted it', () => {
    const out = applyCorrection({ nutrients: { energyKcal: 500 }, coverage: { energyKcal: 'partial' } }, { sodiumMg: 900 });
    expect(out.nutrients.sodiumMg).toBe(900);
    expect(out.coverage.sodiumMg).toBe('known');
    expect(out.correctedKeys).toContain('sodiumMg');
  });

  // The central invariant: an absent key means UNKNOWN. A zero here would tell the day's totals the meal had no sodium.
  test('clearing a corrected figure removes the key, and never writes a zero', () => {
    const base = { nutrients: { sodiumMg: 900 }, coverage: { sodiumMg: 'known' as const }, correctedKeys: ['sodiumMg' as const] };
    const out = applyCorrection(base, { sodiumMg: null });
    expect('sodiumMg' in out.nutrients).toBe(false);
    expect(out.coverage.sodiumMg).toBe('unknown');
    expect(out.correctedKeys).not.toContain('sodiumMg');
  });

  test('a key the correction does not mention is left exactly as it was', () => {
    const base = {
      nutrients: { energyKcal: 500, proteinG: 20, fibreG: 3.5 },
      coverage: { energyKcal: 'partial' as const, proteinG: 'known' as const },
      // fibreG was corrected by some other route; the correction below does not touch it.
      correctedKeys: ['fibreG' as const],
    };
    const out = applyCorrection(base, { sodiumMg: 900 });
    expect(out.nutrients).toEqual({ energyKcal: 500, proteinG: 20, fibreG: 3.5, sodiumMg: 900 });
    expect(out.coverage).toEqual({ energyKcal: 'partial', proteinG: 'known', sodiumMg: 'known' });
    expect(out.correctedKeys).toEqual(['fibreG', 'sodiumMg']);
    // An unmentioned key stays unknown too: no key appears for it.
    expect('satFatG' in out.nutrients).toBe(false);
    expect('satFatG' in out.coverage).toBe(false);
  });

  test('a non-finite or negative value is refused, leaving the figure as it was', () => {
    const base = {
      nutrients: { sodiumMg: 400 },
      coverage: { sodiumMg: 'partial' as const },
      correctedKeys: [] as never[],
    };
    for (const bad of [NaN, Infinity, -Infinity, -1]) {
      const out = applyCorrection(base, { sodiumMg: bad, proteinG: bad });
      expect(out.nutrients).toEqual({ sodiumMg: 400 });
      expect(out.coverage).toEqual({ sodiumMg: 'partial' });
      expect(out.correctedKeys).toEqual([]);
    }
  });

  test('correcting a key twice does not list it twice', () => {
    const once = applyCorrection({ nutrients: {}, coverage: {} }, { sodiumMg: 900 });
    const twice = applyCorrection(once, { sodiumMg: 700 });
    expect(twice.nutrients.sodiumMg).toBe(700);
    expect(twice.correctedKeys).toEqual(['sodiumMg']);
  });

  test('zero is a figure the person may assert, and is kept as a known zero', () => {
    const out = applyCorrection({ nutrients: { sodiumMg: 900 }, coverage: {} }, { sodiumMg: 0 });
    expect(out.nutrients.sodiumMg).toBe(0);
    expect(out.coverage.sodiumMg).toBe('known');
    expect(out.correctedKeys).toEqual(['sodiumMg']);
  });

  test('the base is not mutated', () => {
    const base = { nutrients: { sodiumMg: 900 }, coverage: { sodiumMg: 'known' as const }, correctedKeys: ['sodiumMg' as const] };
    applyCorrection(base, { sodiumMg: null });
    expect(base).toEqual({ nutrients: { sodiumMg: 900 }, coverage: { sodiumMg: 'known' }, correctedKeys: ['sodiumMg'] });
  });
});
