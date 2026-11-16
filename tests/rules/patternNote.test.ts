import { describe, expect, test } from 'vitest';
import { addedSugarDailyRule, addedSugarEntryRule } from '@/rules/catalogue/addedSugar';
import { saturatedFatDailyRule } from '@/rules/catalogue/saturatedFat';
import { sodiumDailyRule, sodiumEntryRule } from '@/rules/catalogue/sodium';
import { sweetDrinkRule } from '@/rules/catalogue/sweetDrink';
import { ultraProcessedRule } from '@/rules/catalogue/ultraProcessed';
import { catalogue } from '@/rules/catalogue';
import type { Rule } from '@/rules/types';
import { weekContext } from '@/domain/totals';
import { MIN_LOGGED_DAYS } from '@/domain/trends';
import type { DiaryEntry } from '@/types/diary';
import type { ClassificationFlags, Coverage, NutrientSet } from '@/types/nutrients';
import { ctx, type Opts } from './catalogueContexts';

/**
 * The frequency note (spec G3: a warning must say whether the concern is about occasional or habitual consumption).
 * It states the app's OWN count of what was logged. It is not a threshold, it carries no published figure of its own,
 * and it can never change a level.
 */

const note = (rule: Rule, o: Opts = {}): string | null => rule.patternNote?.(ctx(o)) ?? null;

// ---------- the six days before today ----------

describe('a note on the days before today', () => {
  test('4 of 5 complete days above the figure: the note says exactly that', () => {
    const text = note(sodiumDailyRule, {
      todaySodium: 1800, pendingSodium: 400,
      weekCompleteDaysBeforeToday: { sodiumMg: [2100, 2200, 1200, 2400, 2900] },
    });
    expect(text).toBe(
      'Of the 6 days before today, 5 had complete sodium data and 4 of those were above 2,000 mg. ' +
        "WHO's figure is about average intake over time.",
    );
  });

  test('the note counts the days before today and never today itself', () => {
    // Today is 9,000 mg and is not in the window: the card already states today, and today is still being logged.
    const text = note(sodiumDailyRule, {
      todaySodium: 9000, pendingSodium: 400,
      weekCompleteDaysBeforeToday: { sodiumMg: [1000, 1100, 1200, 1300] },
    });
    expect(text).toContain('4 had complete sodium data and none of those were above 2,000 mg');
    expect(text).not.toContain('9,000');
  });

  test('too few complete days: no note at all, rather than a note over two days', () => {
    const thin = Array.from({ length: MIN_LOGGED_DAYS - 1 }, () => 2400);
    expect(note(sodiumDailyRule, { todaySodium: 1800, pendingSodium: 400, weekCompleteDaysBeforeToday: { sodiumMg: thin } })).toBeNull();
    const enough = Array.from({ length: MIN_LOGGED_DAYS }, () => 2400);
    expect(note(sodiumDailyRule, { todaySodium: 1800, pendingSodium: 400, weekCompleteDaysBeforeToday: { sodiumMg: enough } })).not.toBeNull();
  });

  test('the gate is the trends view\'s MIN_LOGGED_DAYS, not a second number of this rule\'s own', () => {
    expect(MIN_LOGGED_DAYS).toBeGreaterThan(1);
    const justUnder = Array.from({ length: MIN_LOGGED_DAYS - 1 }, (_, i) => 2100 + i);
    for (const rule of [sodiumDailyRule, sodiumEntryRule]) {
      expect(note(rule, { pendingSodium: 2400, weekCompleteDaysBeforeToday: { sodiumMg: justUnder } })).toBeNull();
    }
  });

  test('added sugar and saturated fat state their own figure and what it is a share of', () => {
    expect(note(addedSugarDailyRule, { todayAddedSugar: 60, pendingAddedSugar: 20, weekCompleteDaysBeforeToday: { addedSugarsG: [70, 80, 20, 90, 95] } })).toBe(
      'Of the 6 days before today, 5 had complete added-sugar data and 4 of those were above about 63 g, ' +
        "which is 10% of the energy target. WHO's figure is about usual intake over time.",
    );
    expect(note(saturatedFatDailyRule, { todaySatFat: 25, pendingSatFat: 10, weekCompleteDaysBeforeToday: { satFatG: [30, 35, 10, 40, 45] } })).toBe(
      'Of the 6 days before today, 5 had complete saturated-fat data and 4 of those were above about 28 g, ' +
        "which is 10% of the energy target. WHO's recommendation is about usual intake as a share of energy.",
    );
  });

  test('the entry card and the daily card of one nutrient say the same thing, so a merge loses nothing', () => {
    const o: Opts = { pendingSodium: 2400, weekCompleteDaysBeforeToday: { sodiumMg: [2100, 2200, 1200, 2400, 2900] } };
    expect(note(sodiumEntryRule, o)).toBe(note(sodiumDailyRule, o));
    const s: Opts = { pendingAddedSugar: 70, weekCompleteDaysBeforeToday: { addedSugarsG: [70, 80, 20, 90, 95] } };
    expect(note(addedSugarEntryRule, s)).toBe(note(addedSugarDailyRule, s));
  });
});

// ---------- a partial day is not a day under the figure ----------

const none: ClassificationFlags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};
const NOW = new Date('2026-11-15T12:00:00');
let seq = 0;
function entry(day: string, over: Partial<DiaryEntry> = {}): DiaryEntry {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return {
    id: `p${++seq}`, at: new Date(y, m - 1, d, 12).toISOString(), rawText: 'x', resolution: 'local',
    items: [{ source: 'dataset', foodId: 'x', grams: 100, classification: none }],
    nutrients: { energyKcal: 500 }, coverage: { energyKcal: 'known' }, classification: none,
    warningsShown: [], userAction: 'added', state: 'active', ...over,
  };
}
const knowing = (day: string, n: NutrientSet, over: Partial<DiaryEntry> = {}) =>
  entry(day, {
    nutrients: { energyKcal: 500, ...n },
    coverage: { energyKcal: 'known', ...(Object.fromEntries(Object.keys(n).map((k) => [k, 'known'])) as Coverage) },
    ...over,
  });
const SIX = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'];

/** A real week built from diary rows, so the note is tested against what `weekContext` actually produces. */
const withWeek = (entries: DiaryEntry[], o: Opts = {}) => ({ ...ctx(o), week: weekContext(entries, NOW) });

describe('a day we cannot vouch for is not a day under the figure', () => {
  test('the nutrient partial on most days: no note, and the partial days are not counted as under', () => {
    const entries = [
      knowing(SIX[0]!, { sodiumMg: 1000 }),
      knowing(SIX[1]!, { sodiumMg: 1100 }),
      // Four days whose sodium is a floor: a second entry on each knew no sodium.
      ...SIX.slice(2).flatMap((d) => [knowing(d, { sodiumMg: 200 }), entry(d)]),
    ];
    const c = withWeek(entries, { todaySodium: 1800, pendingSodium: 400 });
    expect(c.week.completeDayTotalsBeforeToday.sodiumMg).toEqual([1000, 1100]);
    expect(sodiumDailyRule.patternNote?.(c)).toBeNull();
  });

  test('with enough complete days the note counts only those days, not the partial ones', () => {
    const entries = [
      ...SIX.slice(0, 4).map((d) => knowing(d, { sodiumMg: 2400 })),
      ...SIX.slice(4).flatMap((d) => [knowing(d, { sodiumMg: 200 }), entry(d)]),
    ];
    const c = withWeek(entries, { todaySodium: 1800, pendingSodium: 400 });
    expect(sodiumDailyRule.patternNote?.(c)).toContain('4 had complete sodium data and 4 of those were above');
  });

  test('a cancelled entry in the window is counted nowhere', () => {
    const active = SIX.slice(0, 4).map((d) => knowing(d, { sodiumMg: 1000 }));
    const cancelled = knowing(SIX[4]!, { sodiumMg: 9000 }, { userAction: 'cancelled' });
    const drinks = entry(SIX[0]!, { classification: { ...none, sweetDrink: true, novaGroup: 4 }, userAction: 'cancelled' });
    const c = withWeek([...active, cancelled, drinks], { todaySodium: 1800, pendingSodium: 400, classification: { sweetDrink: true } });
    expect(c.week.completeDayTotalsBeforeToday.sodiumMg).toEqual([1000, 1000, 1000, 1000]);
    expect(sodiumDailyRule.patternNote?.(c)).toContain('4 had complete sodium data and none of those were above');
    // The cancelled drink is not an occasion: with this entry it is the first one in the window.
    expect(sweetDrinkRule.patternNote?.(c)).toContain('1 entry in the last 7 days');
  });
});

// ---------- occasions, counted per entry ----------

describe('a note on how often something was logged', () => {
  test('sweetened drinks: this entry plus the committed ones, counted as entries', () => {
    expect(note(sweetDrinkRule, { classification: { sweetDrink: true }, weekSweetDrinkOccasions: 2, weekLoggedDays: 5 })).toBe(
      'Counting this entry, sugar-sweetened drinks appear in 3 entries in the last 7 days, over 5 days with entries. ' +
        'The diary counts entries, not drinks: an entry with two glasses counts once.',
    );
  });

  test('ultra-processed food: the same count over the week, as entries', () => {
    expect(
      note(ultraProcessedRule, {
        classification: { novaGroup: 4 }, todayEntryCount: 3, todayNova4Entries: 2,
        weekUltraProcessedOccasions: 8, weekLoggedDays: 6,
      }),
    ).toBe(
      'Counting this entry, NOVA group 4 food appears in 9 entries in the last 7 days, over 6 days with entries. ' +
        'The diary counts entries, not energy or amount.',
    );
  });

  test('too few logged days: no note, because 3 drinks in 7 days says nothing when 3 days were logged', () => {
    const thin = { weekSweetDrinkOccasions: 2, weekLoggedDays: MIN_LOGGED_DAYS - 1 };
    expect(note(sweetDrinkRule, { classification: { sweetDrink: true }, ...thin })).toBeNull();
    expect(note(ultraProcessedRule, { classification: { novaGroup: 4 }, weekUltraProcessedOccasions: 8, weekLoggedDays: MIN_LOGGED_DAYS - 1 })).toBeNull();
    expect(note(sweetDrinkRule, { classification: { sweetDrink: true }, weekSweetDrinkOccasions: 2, weekLoggedDays: MIN_LOGGED_DAYS })).not.toBeNull();
  });

  test('a count that cannot be trusted produces no note', () => {
    expect(note(sweetDrinkRule, { classification: { sweetDrink: true }, weekSweetDrinkOccasions: Number.NaN })).toBeNull();
    expect(note(ultraProcessedRule, { classification: { novaGroup: 4 }, weekUltraProcessedOccasions: -1 })).toBeNull();
  });
});

// ---------- the note can never move a level ----------

describe('the note is not a threshold', () => {
  const WITH_PATTERN: Opts[] = [
    { weekCompleteDaysBeforeToday: { sodiumMg: [2400, 2500, 2600, 2700, 2800], addedSugarsG: [80, 85, 90, 95, 99], satFatG: [40, 41, 42, 43, 44] }, weekLoggedDays: 7, weekSweetDrinkOccasions: 6, weekUltraProcessedOccasions: 12 },
    { weekCompleteDaysBeforeToday: { sodiumMg: [100, 110, 120, 130, 140], addedSugarsG: [1, 2, 3, 4, 5], satFatG: [1, 2, 3, 4, 5] }, weekLoggedDays: 7, weekSweetDrinkOccasions: 0, weekUltraProcessedOccasions: 0 },
    { weekCompleteDaysBeforeToday: { sodiumMg: [], addedSugarsG: [], satFatG: [] }, weekLoggedDays: 0, weekSweetDrinkOccasions: 0, weekUltraProcessedOccasions: 0 },
  ];
  /** One context per rule that is at, below and above its own trigger, so a moved level would show as a diff. */
  const CASES: { rule: Rule; base: Opts }[] = [
    { rule: sodiumEntryRule, base: { pendingSodium: 2400 } },
    { rule: sodiumEntryRule, base: { pendingSodium: 1900 } },
    { rule: sodiumDailyRule, base: { todaySodium: 1800, pendingSodium: 400 } },
    { rule: sodiumDailyRule, base: { todaySodium: 100, pendingSodium: 100 } },
    { rule: addedSugarEntryRule, base: { pendingAddedSugar: 70 } },
    { rule: addedSugarEntryRule, base: { pendingAddedSugar: 40 } },
    { rule: addedSugarDailyRule, base: { todayAddedSugar: 60, pendingAddedSugar: 20 } },
    { rule: addedSugarDailyRule, base: { todayAddedSugar: 1, pendingAddedSugar: 1 } },
    { rule: saturatedFatDailyRule, base: { todaySatFat: 25, pendingSatFat: 10 } },
    { rule: saturatedFatDailyRule, base: { todaySatFat: 2, pendingSatFat: 2 } },
    { rule: sweetDrinkRule, base: { classification: { sweetDrink: true } } },
    { rule: sweetDrinkRule, base: {} },
    { rule: ultraProcessedRule, base: { classification: { novaGroup: 4 }, todayEntryCount: 3, todayNova4Entries: 2 } },
    { rule: ultraProcessedRule, base: { classification: { novaGroup: 4 }, todayEntryCount: 3, todayNova4Entries: 0 } },
  ];

  test('no pattern of earlier days raises, lowers or creates a level', () => {
    for (const { rule, base } of CASES) {
      const baseline = rule.level(ctx(base));
      for (const pattern of WITH_PATTERN) {
        expect(rule.level(ctx({ ...base, ...pattern })), `${rule.id} moved on the week's pattern`).toBe(baseline);
      }
    }
  });

  test('no note states a frequency at which anything changes: it counts, it does not judge', () => {
    for (const rule of catalogue) {
      for (const pattern of WITH_PATTERN) {
        const text = rule.patternNote?.(ctx({ classification: { sweetDrink: true, novaGroup: 4 }, ...pattern }));
        if (text === null || text === undefined) continue;
        expect(text, `${rule.id}: the note must not read as a limit`).not.toMatch(
          /\b(limit|risk|too (much|many|often)|should|recommend(ed|s)? (no more|fewer)|safe|unsafe|per week is)\b/i,
        );
      }
    }
  });
});
