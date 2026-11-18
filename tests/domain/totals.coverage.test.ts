import { describe, expect, test } from 'vitest';
import { dayTotals, weekContext } from '@/domain/totals';
import { evaluate } from '@/rules/engine';
import { sodiumDailyRule } from '@/rules/catalogue/sodium';
import type { Context } from '@/rules/types';
import type { DiaryEntry } from '@/types/diary';
import type { ClassificationFlags } from '@/types/nutrients';
import { ownerProfile } from '../fixtures/profile';

const none: ClassificationFlags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};
const NOON = new Date(2026, 10, 15, 12);
let seq = 0;
function make(over: Partial<DiaryEntry> = {}): DiaryEntry {
  return {
    id: `c${++seq}`, at: NOON.toISOString(), rawText: 'x', resolution: 'local',
    items: [{ source: 'dataset', foodId: 'x', grams: 100, classification: none }],
    nutrients: { energyKcal: 500, sodiumMg: 1500 }, coverage: { energyKcal: 'known', sodiumMg: 'known' },
    classification: none, warningsShown: [], userAction: 'added', state: 'active', ...over,
  };
}
const partialSodium = () => make({ coverage: { energyKcal: 'known', sodiumMg: 'partial' } });

describe('day coverage honours each entry\'s own coverage', () => {
  test('an entry whose own coverage is partial makes the day partial, not known', () => {
    const d = dayTotals([partialSodium()], '2026-11-15');
    expect(d.coverage.sodiumMg).toBe('partial');
  });

  test('one partial entry among known ones makes the day partial', () => {
    const d = dayTotals([make(), partialSodium()], '2026-11-15');
    expect(d.coverage.sodiumMg).toBe('partial');
  });

  test('all entries known stays known; an absent key stays unknown', () => {
    const d = dayTotals([make(), make()], '2026-11-15');
    expect(d.coverage.sodiumMg).toBe('known');
    expect(d.coverage.fibreG).toBe('unknown');
  });

  test('an entry missing the key still makes the day partial', () => {
    const d = dayTotals([make(), make({ nutrients: { energyKcal: 500 }, coverage: { energyKcal: 'known' } })], '2026-11-15');
    expect(d.coverage.sodiumMg).toBe('partial');
  });

  test('weekContext days carry the same coverage', () => {
    const w = weekContext([partialSodium()], NOON);
    expect(w.days[6]!.coverage.sodiumMg).toBe('partial');
  });

  test('through the engine: a daily rule on such a day carries the "may be understated" note', () => {
    const small = make({ nutrients: { energyKcal: 100, sodiumMg: 200 }, coverage: { energyKcal: 'known', sodiumMg: 'partial' } });
    const history = [make(), make(), make(), small];
    const today = dayTotals(history, '2026-11-15');
    const week = weekContext(history, NOON);
    const context: Context = {
      foods: [],
      pending: {
        refs: [{ source: 'dataset', foodId: 'x', grams: 100, classification: none }],
        nutrients: { energyKcal: 300, sodiumMg: 900 }, coverage: { energyKcal: 'known', sodiumMg: 'known' },
        classification: none, needsHelp: [], confidence: 1,
      },
      today, week,
      targets: {
        energyKcal: 2500,
        maintenanceKcal: 2500, rmrKcal: 1900, proteinG: 100, proteinFloorG: 80, fibreG: 30, sodiumMg: 2000, satFatG: 28,
        addedSugarsG: 50, addedSugarsIdealG: 25, transFatG: 2, micronutrients: {}, isGeneric: false,
      basis: { protein: 'issn-range', energy: 'mifflin', expenditure: 'formula' },
      },
      profile: ownerProfile, now: NOON, answers: {},
    };
    const { cards } = evaluate([sodiumDailyRule], context);
    expect(today.coverage.sodiumMg).toBe('partial');
    expect(cards).toHaveLength(1);
    expect(cards[0]!.dataNote).toMatch(/today's sodium total may be understated/);
  });

  test('a day made only of partial entries has no covered energy share, so the engine gate stays silent', () => {
    const history = [partialSodium()];
    const today = dayTotals(history, '2026-11-15');
    expect(today.energyCoveredShare.sodiumMg).toBe(0);
  });
});
