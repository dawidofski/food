import { describe, expect, test } from 'vitest';
import { parseEntry } from '@/domain/parseEntry';
import { quantityToGrams, resolveItems } from '@/domain/resolveItems';
import { combineLookups, type FoodLookup } from '@/domain/foodLookup';
import { buildSearchIndex, search } from '@/data/foodSearch';
import type { DatasetFood } from '@/types/food';

const FLAGS = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1 as const,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};

// 1088 mg per 100 g x 114 g = 1240.3 mg, so the arithmetic is genuinely exercised.
const hotDog: DatasetFood = {
  id: 'hotdog', name: 'Frankfurter, beef', synonyms: ['hot dog'],
  per100g: { energyKcal: 290, sodiumMg: 1088, proteinG: 10, addedSugarsG: 1 },
  portions: [{ label: '1 frankfurter', grams: 57 }, { label: '1 oz', grams: 28.35 }],
  classification: { ...FLAGS, processedMeat: true, redMeat: true, novaGroup: 4 }, allergens: [],
};
const oliveOil: DatasetFood = {
  id: 'oil', name: 'Olive oil', synonyms: [],
  per100g: { energyKcal: 884, fatG: 100 },
  portions: [{ label: '1 tbsp', grams: 13.5 }, { label: '1 cup', grams: 216 }],
  classification: { ...FLAGS, novaGroup: 2 }, allergens: [],
};
const oilNoTbsp: DatasetFood = { ...oliveOil, portions: [{ label: '1 cup', grams: 216 }] };
// Sodium and added sugars were never recorded for this one.
const mystery: DatasetFood = {
  id: 'mystery', name: 'Mystery food', synonyms: [],
  per100g: { energyKcal: 100, proteinG: 5 },
  portions: [{ label: '1 regular', grams: 80 }],
  classification: FLAGS, allergens: [],
};
const egg: DatasetFood = {
  id: 'egg', name: 'Egg, whole', synonyms: [], per100g: { energyKcal: 143 },
  portions: [{ label: '1 large', grams: 50 }], classification: FLAGS, allergens: ['egg'],
};

function lookupOf(foods: DatasetFood[]): FoodLookup {
  const index = buildSearchIndex(foods);
  const byId = new Map(foods.map((f) => [f.id, f]));
  return {
    search: (q, limit) => search(index, q, limit).map((h) => ({ source: 'dataset' as const, food: h.food, score: h.score })),
    get: (source, id) => (source === 'dataset' ? byId.get(id) : undefined),
  };
}
const fixtureLookup = lookupOf([hotDog, oliveOil, mystery, egg]);
const lookupWithoutTbsp = lookupOf([hotDog, oilNoTbsp]);
const lookupWithPartialData = lookupOf([mystery]);

describe('resolveItems', () => {
  test('two hot dogs resolves to 114 g and sums nutrients', () => {
    const r = resolveItems(parseEntry('two hot dogs').items, fixtureLookup);
    expect(r.refs[0]!.grams).toBe(114);
    expect(r.nutrients.sodiumMg).toBeCloseTo(1240, 0);
  });

  test('an unmatched food is returned for help rather than guessed', () => {
    const r = resolveItems(parseEntry('one frikandel').items, fixtureLookup);
    expect(r.refs).toEqual([]);
    expect(r.needsHelp[0]!.foodQuery).toBe('frikandel');
  });

  test('a kitchen unit with no matching portion row needs help', () => {
    const r = resolveItems(parseEntry('2 tbsp olive oil').items, lookupWithoutTbsp);
    expect(r.needsHelp).toHaveLength(1);
  });

  test('zero and negative quantities are rejected before the gate', () => {
    expect(resolveItems(parseEntry('0 hot dogs').items, fixtureLookup).refs).toEqual([]);
    expect(resolveItems(parseEntry('-2 eggs').items, fixtureLookup).refs).toEqual([]);
  });

  test('a very large quantity scales honestly with no NaN or Infinity', () => {
    const r = resolveItems(parseEntry('50 hot dogs').items, fixtureLookup);
    expect(r.refs[0]!.grams).toBe(2850);
    expect(Object.values(r.nutrients).every(Number.isFinite)).toBe(true);
  });

  test('unknown nutrients stay absent through resolution', () => {
    const r = resolveItems(parseEntry('one mystery food').items, lookupWithPartialData);
    expect('addedSugarsG' in r.nutrients).toBe(false);
    expect(r.coverage.addedSugarsG).toBe('unknown');
  });

  test('absurd magnitudes go to needsHelp, never into a total', () => {
    for (const text of ['1e299 kg hot dogs', '99999999 kg hot dogs', '500 kg hot dogs', '100000 hot dogs']) {
      const items = parseEntry(text).items;
      expect(items.length, text).toBeGreaterThan(0);
      const r = resolveItems(items, fixtureLookup);
      expect(r.refs, text).toEqual([]);
      expect(r.nutrients, text).toEqual({});
      expect(r.needsHelp, text).toHaveLength(items.length);
    }
    const ok = resolveItems(parseEntry('100 kg hot dogs').items, fixtureLookup);
    expect(ok.refs[0]!.grams).toBe(100000);
  });

  test('non-finite quantities are rejected defensively', () => {
    for (const quantity of [{ grams: NaN }, { grams: Infinity }, { count: NaN }, { count: -Infinity }, {}]) {
      const r = resolveItems([{ rawFragment: 'x', quantity, foodQuery: 'hot dogs' }], fixtureLookup);
      expect(r.refs).toEqual([]);
      expect(r.needsHelp).toHaveLength(1);
    }
  });

  test('one resolved item and one needing help: the resolved one still counts', () => {
    const r = resolveItems(parseEntry('two hot dogs and a frikandel').items, fixtureLookup);
    expect(r.refs).toHaveLength(1);
    expect(r.refs[0]!.grams).toBe(114);
    expect(r.nutrients.sodiumMg).toBeCloseTo(1240, 0);
    expect(r.needsHelp.map((i) => i.foodQuery)).toEqual(['frikandel']);
    expect(r.classification.processedMeat).toBe(true);
  });

  test('a nutrient unknown on one food is partial, and the known part is not zero-filled', () => {
    const r = resolveItems(parseEntry('a hot dog and a mystery food').items, fixtureLookup);
    expect(r.coverage.sodiumMg).toBe('partial');
    expect(r.nutrients.sodiumMg).toBeCloseTo(1088 * 0.57, 5);
  });

  test('gram quantities and kitchen units resolve', () => {
    expect(resolveItems(parseEntry('200 g hot dog').items, fixtureLookup).refs[0]!.grams).toBe(200);
    const r = resolveItems(parseEntry('2 tbsp olive oil').items, fixtureLookup);
    expect(r.refs[0]).toMatchObject({ source: 'dataset', foodId: 'oil', grams: 27, portionLabel: '1 tbsp' });
  });

  test('each ref snapshots its own classification', () => {
    const r = resolveItems(parseEntry('200 g hot dog').items, fixtureLookup);
    expect(r.refs[0]!.classification.processedMeat).toBe(true);
  });

  test('nothing resolved gives confidence 0; resolved entries sit near 1', () => {
    expect(resolveItems(parseEntry('one frikandel').items, fixtureLookup).confidence).toBe(0);
    expect(resolveItems(parseEntry('two hot dogs').items, fixtureLookup).confidence).toBeGreaterThan(0.5);
  });
});

describe('quantityToGrams', () => {
  test('bare counts take a whole-item portion before a measure', () => {
    expect(quantityToGrams({ count: 3 }, hotDog)).toBe(171);
    expect(quantityToGrams({ count: 2 }, mystery)).toBe(160);
  });
  test('a bare count falls back to a cup when there is no whole-item portion', () => {
    expect(quantityToGrams({ count: 1 }, oilNoTbsp)).toBe(216);
  });
  test('sub-serving measures rank last, but a container label that mentions fl oz is a container', () => {
    const cola: DatasetFood = {
      ...egg, id: 'cola',
      portions: [{ label: '1 fl oz (no ice)', grams: 31 }, { label: '1 cup', grams: 247 }, { label: '1 can (12 fl oz)', grams: 372 }],
    };
    expect(quantityToGrams({ count: 1 }, cola)).toBe(372);
    expect(quantityToGrams({ count: 1 }, { ...cola, portions: cola.portions.filter((p) => !p.label.includes('can')) })).toBe(247);
    expect(quantityToGrams({ count: 1 }, { ...cola, portions: [{ label: '1 fl oz', grams: 31 }, { label: '1 tbsp', grams: 15 }] })).toBe(31); // measures only: label order, not weight
  });
  test('the middle size is preferred, and qualified variants lose', () => {
    const apple: DatasetFood = {
      ...egg, id: 'apple',
      portions: [{ label: '1 small', grams: 165 }, { label: '1 medium', grams: 200 }, { label: '1 large', grams: 242 }],
    };
    expect(quantityToGrams({ count: 1 }, apple)).toBe(200);
    const bread: DatasetFood = {
      ...egg, id: 'bread',
      portions: [{ label: '1 slice, crust not eaten', grams: 13 }, { label: '1 slice', grams: 28 }],
    };
    expect(quantityToGrams({ count: 2, unitLabel: 'slice' }, bread)).toBe(56);
    expect(quantityToGrams({ count: 2 }, bread)).toBe(56);
  });
  test('dataset guideline rows and a school container never beat a cup', () => {
    const milk: DatasetFood = {
      ...egg, id: 'milk',
      portions: [{ label: '1 cup', grams: 244 }, { label: '1 individual school container', grams: 244 }, { label: 'Guideline amount per fl oz of beverage', grams: 2.5 }],
    };
    expect(quantityToGrams({ count: 1 }, milk)).toBe(244);
    expect(quantityToGrams({ count: 1 }, { ...milk, portions: milk.portions.slice(1) })).toBe(244);
    expect(quantityToGrams({ count: 1 }, { ...milk, portions: milk.portions.slice(2) })).toBeNull();
  });
  test('labels that merely contain "per" are real portions: pepper, personal pizza, paper, "N per package"', () => {
    const pepper: DatasetFood = { ...egg, id: 'pepper', portions: [{ label: '1 pepper', grams: 15 }, { label: '1 cup', grams: 150 }] };
    expect(quantityToGrams({ count: 1 }, pepper)).toBe(15);
    const pizza: DatasetFood = { ...egg, id: 'pizza', portions: [{ label: '1 personal size pizza (5-7" diameter)', grams: 150 }, { label: '1 cup', grams: 100 }] };
    expect(quantityToGrams({ count: 1 }, pizza)).toBe(150);
    const bacon: DatasetFood = { ...egg, id: 'bacon', portions: [{ label: '1 slice (15 per 8 oz package)', grams: 8 }, { label: '1 cup', grams: 100 }] };
    expect(quantityToGrams({ count: 2 }, bacon)).toBe(16);
    const guideline: DatasetFood = { ...egg, id: 'g', portions: [{ label: '1 guideline amount per item', grams: 1 }, { label: 'Topping per surface inch of pizza', grams: 3 }, { label: 'Guideline amount per fl oz of beverage', grams: 2.5 }] };
    expect(quantityToGrams({ count: 1 }, guideline)).toBeNull();
  });
  test('the chosen weight does not depend on the order of the portion rows', () => {
    const apple: DatasetFood = {
      ...egg, id: 'apple',
      portions: [
        { label: '1 medium (3" dia)', grams: 182 }, { label: '1 medium', grams: 200 }, { label: '1 small', grams: 165 },
        { label: '1 large', grams: 242 }, { label: '1 cup', grams: 125 },
      ],
    };
    const orders = [apple.portions, [...apple.portions].reverse(), [...apple.portions.slice(2), ...apple.portions.slice(0, 2)]];
    const weights = orders.map((portions) => quantityToGrams({ count: 1 }, { ...apple, portions }));
    expect(new Set(weights).size).toBe(1);
    const sliced = orders.map((portions) => quantityToGrams({ count: 1, unitLabel: 'cup' }, { ...apple, portions }));
    expect(new Set(sliced).size).toBe(1);
  });
  test('a whole item beats a fragment of it, whatever the row order or weights', () => {
    const cases: [string, { label: string; grams: number }[], number][] = [
      ['banana', [{ label: '1 banana', grams: 126 }, { label: '1 slice', grams: 6 }, { label: '1 cup', grams: 150 }, { label: '1 linear inch', grams: 15 }], 126],
      ['cereal', [{ label: '1 cup', grams: 40 }, { label: '1 prepackaged single serving', grams: 30 }, { label: '1 piece', grams: 0.1 }], 30],
      ['butter', [{ label: '1 stick', grams: 113 }, { label: '1 pat', grams: 7 }, { label: '1 tablespoon', grams: 14 }], 113],
      ['oxtail', [{ label: '1 tail', grams: 240 }, { label: '1 tail bone', grams: 30 }, { label: '1 cup', grams: 135 }], 240],
      ['apricot', [{ label: '1 apricot', grams: 35 }, { label: '1 slice/chunk', grams: 10 }], 35],
    ];
    for (const [name, portions, want] of cases) {
      const orders = [portions, [...portions].reverse(), [...portions.slice(1), ...portions.slice(0, 1)]];
      for (const o of orders) expect(quantityToGrams({ count: 1 }, { ...egg, portions: o }), name).toBe(want);
    }
  });
  test('portions tied on group and tier resolve to the middle weight, in any row order', () => {
    const sausage = [{ label: '1 patty', grams: 35 }, { label: '1 breakfast size link', grams: 20 }, { label: '1 bun-size or griller link', grams: 75 }, { label: '1 slice', grams: 15 }];
    for (const o of [sausage, [...sausage].reverse(), [...sausage.slice(2), ...sausage.slice(0, 2)]]) {
      expect(quantityToGrams({ count: 1 }, { ...egg, portions: o })).toBe(35);
    }
  });
  test('a cup of the dry food never beats the cooked cup', () => {
    // FNDDS states some staples both ways: "1 cup, dry, yields <cooked grams>" is a conversion
    // row for a cup of DRY grain (about four servings once cooked), not a serving of the food.
    const barley = [{ label: '1 cup, dry, yields', grams: 740 }, { label: '1 cup, cooked', grams: 170 }];
    const creamOfWheat = [{ label: '1 cup, dry, yields', grams: 965 }, { label: '1 cup, cooked', grams: 240 }, { label: '1 oz, dry, yields', grams: 170 }];
    for (const [portions, want] of [[barley, 170], [creamOfWheat, 240]] as const) {
      for (const o of [portions, [...portions].reverse(), [...portions.slice(1), ...portions.slice(0, 1)]]) {
        expect(quantityToGrams({ count: 1 }, { ...egg, portions: o })).toBe(want);
      }
    }
  });
  test('a sized fragment is still a fragment: a medium slice never beats a whole breast', () => {
    // Real "Chicken breast, rotisserie, skin eaten" rows. The slice carries a size word, so the
    // fragment demotion has to outrank the middle-size promotion or a 60 g slice wins.
    const breast = [
      { label: '1 cup, cooked, diced', grams: 135 }, { label: '1 breast', grams: 130 },
      { label: '1 small or thin slice', grams: 30 }, { label: '1 medium slice', grams: 60 },
      { label: '1 large or thick slice', grams: 85 }, { label: '1 oz, cooked', grams: 28.35 },
      { label: '1 breast quarter (yield after cooking, bone removed)', grams: 155 },
    ];
    // Every rotation and its reverse: the pick must not depend on the row order at all.
    for (let k = 0; k < breast.length; k++) {
      const rotated = [...breast.slice(k), ...breast.slice(0, k)];
      for (const o of [rotated, [...rotated].reverse()]) {
        expect(quantityToGrams({ count: 1 }, { ...egg, portions: o }), `rotation ${k}`).toBe(130);
      }
    }
    // The user naming the unit still overrides the demotion.
    expect(quantityToGrams({ count: 2, unitLabel: 'slice' }, { ...egg, portions: breast })).toBe(120);
  });
  test('a meatball is a fragment of a meat loaf, but still the serving of a meatball food', () => {
    // Real "Meat loaf, NS as to type of meat" rows. A meatball is not a serving of a loaf, and
    // 28 g looks plausible at the gate, so the slice has to win: a silent 3.9x understatement on a
    // red/processed meat would suppress a sodium warning that should fire.
    const meatLoaf = [
      { label: '1 small or thin slice', grams: 86 }, { label: '1 medium slice', grams: 108 },
      { label: '1 large slice', grams: 144 }, { label: '1 cocktail meatball', grams: 7 },
      { label: '1 small meatball', grams: 14 }, { label: '1 medium meatball', grams: 28 },
      { label: '1 large meatball', grams: 42 }, { label: '1 cup', grams: 140 },
      { label: '1 cubic inch', grams: 19 },
    ];
    for (let k = 0; k < meatLoaf.length; k++) {
      const rotated = [...meatLoaf.slice(k), ...meatLoaf.slice(0, k)];
      for (const o of [rotated, [...rotated].reverse()]) {
        expect(quantityToGrams({ count: 1 }, { ...egg, portions: o }), `rotation ${k}`).toBe(108);
      }
    }
    // A food whose own whole item IS a meatball keeps it: the fragment tier sits inside group 0,
    // so it still outranks the group-1 cup ("Meatball, meatless", "Meatballs ... with sauce").
    const meatless = [{ label: '1 meatball', grams: 18 }, { label: '1 cup', grams: 144 }];
    const withSauce = [{ label: '1 cup', grams: 235 }, { label: '1 meatball with sauce', grams: 43 }];
    for (const [portions, want] of [[meatless, 18], [withSauce, 43]] as const) {
      for (const o of [portions, [...portions].reverse()]) {
        expect(quantityToGrams({ count: 1 }, { ...egg, portions: o })).toBe(want);
      }
    }
  });
  test('among fragments the size ladder still applies: the medium slice, not the largest', () => {
    const whiteBread = [
      { label: '1 small or thin/very thin slice', grams: 24 }, { label: '1 medium or regular slice', grams: 28 },
      { label: '1 large or thick slice', grams: 43 }, { label: '1 slice, crust not eaten', grams: 13 },
      { label: '1 slice, snack-size', grams: 10 }, { label: '1 cup', grams: 40 }, { label: '1 cubic inch', grams: 2.8 },
    ];
    for (const o of [whiteBread, [...whiteBread].reverse()]) {
      expect(quantityToGrams({ count: 1 }, { ...egg, portions: o })).toBe(28);
    }
  });
  test('an explicit fragment unit still wins: 2 slices of banana', () => {
    expect(quantityToGrams({ count: 2, unitLabel: 'slice' }, { ...egg, portions: [{ label: '1 banana', grams: 126 }, { label: '1 slice', grams: 6 }] })).toBe(12);
  });
  test('a food with no portions at all has no serving', () => {
    expect(quantityToGrams({ count: 1 }, { ...egg, portions: [] })).toBeNull();
  });
  test('a bare-count ref reports the portion it chose', () => {
    expect(resolveItems(parseEntry('two hot dogs').items, fixtureLookup).refs[0]!.portionLabel).toBe('1 frankfurter');
  });
  test('unit labels match case-insensitively and tolerate the leading number', () => {
    expect(quantityToGrams({ count: 2, unitLabel: 'TBSP' }, oliveOil)).toBe(27);
    expect(quantityToGrams({ count: 1, unitLabel: 'cup' }, oliveOil)).toBe(216);
    expect(quantityToGrams({ count: 1, unitLabel: 'tsp' }, oliveOil)).toBeNull();
  });
});

describe('combineLookups', () => {
  test('merges sources by score and routes get by source', () => {
    const customEgg = { ...egg, id: 'c1' };
    const custom: FoodLookup = {
      search: () => [{ source: 'custom', food: customEgg, score: 0.01 }],
      get: (s, id) => (s === 'custom' && id === 'c1' ? customEgg : undefined),
    };
    const both = combineLookups(custom, fixtureLookup);
    expect(both.search('egg')[0]!.source).toBe('custom');
    expect(both.get('custom', 'c1')?.id).toBe('c1');
    expect(both.get('dataset', 'egg')?.id).toBe('egg');
    expect(resolveItems(parseEntry('an egg').items, both).refs[0]!.source).toBe('custom');
  });
});
