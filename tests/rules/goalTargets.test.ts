import { describe, expect, test } from 'vitest';
import { computeTargets } from '@/domain/targets';
import { evaluate } from '@/rules/engine';
import { sodiumDailyRule } from '@/rules/catalogue/sodium';
import { addedSugarDailyRule } from '@/rules/catalogue/addedSugar';
import type { Goal, Profile } from '@/types/profile';
import type { Context } from '@/rules/types';
import { ctx, type Opts } from './catalogueContexts';

// The warning rules read ctx.targets. These tests prove, end to end, that a goal moves the figures whose sources are
// expressed as a share of energy intake and leaves the absolute ones alone (spec 8.1.1).

const ON = new Date('2026-11-15');

function profile(goal?: Goal): Profile {
  return {
    heightCm: 180,
    dob: '1991-06-15',
    sex: 'male',
    activityLevel: 'light',
    weightLog: [{ date: '2026-11-01', kg: 80 }],
    flaggedAllergens: [],
    conditions: [],
    ...(goal === undefined ? {} : { goal }),
  };
}

const HOLD = computeTargets(profile({ kind: 'hold' }), ON);
const LOSE = computeTargets(profile({ kind: 'lose', rateKgPerWeek: 0.5 }), ON);

/** A context whose targets come from the real derivation, not the probe's fixed figures. */
function withTargets(targets: Context['targets'], o: Opts): Context {
  return { ...ctx(o), targets };
}

describe('the warning engine sees a goal-adjusted target', () => {
  test('the premise: the goal lowers the added-sugar figure and leaves sodium alone', () => {
    expect(LOSE.addedSugarsG).toBeLessThan(HOLD.addedSugarsG);
    expect(LOSE.sodiumMg).toBe(HOLD.sodiumMg);
  });

  test('a sodium card fires at the same point whether or not a goal is set', () => {
    for (const [today, pending] of [[1800, 200], [1800, 201], [1000, 1001], [0, 2001], [0, 2000]]) {
      const a = sodiumDailyRule.level(withTargets(HOLD, { todaySodium: today!, pendingSodium: pending! }));
      const b = sodiumDailyRule.level(withTargets(LOSE, { todaySodium: today!, pendingSodium: pending! }));
      expect(b).toBe(a);
    }
    // And the boundary is where WHO puts it: exactly 2,000 mg is not over, 2,001 mg is.
    expect(sodiumDailyRule.level(withTargets(LOSE, { todaySodium: 1800, pendingSodium: 200 }))).toBeNull();
    expect(sodiumDailyRule.level(withTargets(LOSE, { todaySodium: 1800, pendingSodium: 201 }))).toBe('MODERATE');
  });

  test('an added-sugar card fires earlier under a deficit, because 10% of a smaller intake is less', () => {
    // An amount between the two ceilings: over the deficit's 10%, still under the maintenance 10%.
    const amount = LOSE.addedSugarsG + 1;
    expect(amount).toBeLessThanOrEqual(HOLD.addedSugarsG);
    const held = addedSugarDailyRule.level(withTargets(HOLD, { todayAddedSugar: 0, pendingAddedSugar: amount }));
    const lost = addedSugarDailyRule.level(withTargets(LOSE, { todayAddedSugar: 0, pendingAddedSugar: amount }));
    expect(held).not.toBe('MODERATE');
    expect(lost).toBe('MODERATE');
  });

  test('the same holds through the engine, not only the rule', () => {
    const amount = LOSE.addedSugarsG + 1;
    const sugarCard = (t: Context['targets']) =>
      evaluate([addedSugarDailyRule], withTargets(t, { todayAddedSugar: 0, pendingAddedSugar: amount })).cards.find(
        (c) => c.ruleId === 'added-sugar-daily',
      );
    expect(sugarCard(LOSE)?.level).toBe('MODERATE');
    expect(sugarCard(HOLD)?.level).not.toBe('MODERATE');
  });
});
