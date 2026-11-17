import { describe, expect, test } from 'vitest';
import { ACTIVITY_FACTORS, ageOn, computeTargets, currentWeightKg } from '@/domain/targets';
import type { ActivityLevel, Goal, Profile } from '@/types/profile';
import { ownerProfile } from '../fixtures/profile';

const ON = new Date('2026-11-15');

const ACTIVITY_LEVELS = Object.keys(ACTIVITY_FACTORS) as ActivityLevel[];

/**
 * A complete, valid profile with a single weight entry. Synthetic values only. `extra` takes any other Profile field
 * (a body-fat percentage later) so callers need no new helper.
 */
function profileAt(weightKg: number, activityLevel: ActivityLevel, goal?: Goal, extra: Partial<Profile> = {}): Profile {
  return {
    heightCm: 180,
    dob: '1991-06-15',
    sex: 'male',
    activityLevel,
    weightLog: [{ date: '2026-11-01', kg: weightKg }],
    flaggedAllergens: [],
    conditions: [],
    ...(goal === undefined ? {} : { goal }),
    ...extra,
  };
}

describe('targets', () => {
  test('ageOn derives age from date of birth, not a stored number', () => {
    expect(ageOn('1991-06-15', new Date('2026-11-15'))).toBe(35);
    expect(ageOn('1991-06-15', new Date('2026-06-14'))).toBe(34); // day before birthday
  });

  test('ageOn handles a 29 February birthday without throwing', () => {
    expect(() => ageOn('1992-02-29', new Date('2026-02-28'))).not.toThrow();
    expect(Number.isFinite(ageOn('1992-02-29', new Date('2026-03-01')))).toBe(true);
    expect(ageOn('1992-02-29', new Date('2026-03-01'))).toBe(34);
    expect(ageOn('1992-02-29', new Date('2026-02-28'))).toBe(33);
  });

  test('computeTargets matches Mifflin-St Jeor for the owner profile', () => {
    const t = computeTargets(ownerProfile, ON);
    expect(t.rmrKcal).toBe(1755); // 10*80 + 6.25*180 - 5*35 + 5
    expect(t.energyKcal).toBe(2413); // x 1.375 light activity
  });

  test('computeTargets pins the guideline-derived limits', () => {
    const t = computeTargets(ownerProfile, ON);
    expect(t.sodiumMg).toBe(2000);
    expect(t.satFatG).toBe(27);
    expect(t.addedSugarsG).toBe(60);
    expect(t.addedSugarsIdealG).toBe(30);
    expect(t.transFatG).toBe(3);
    expect(t.fibreG).toBe(34);
    expect(t.proteinG).toBe(136); // light activity, no goal: ISSN 1.7 g/kg of 80 kg
    expect(t.proteinFloorG).toBe(66); // EFSA 0.83 g/kg of 80 kg
    expect(t.isGeneric).toBe(false);
  });

  test('computeTargets returns generic targets for a null profile', () => {
    const t = computeTargets(null, ON);
    expect(t.isGeneric).toBe(true);
    expect(t.sodiumMg).toBe(2000);
    expect(t.rmrKcal).toBe(1516); // 175cm, 70kg, age 40, unspecified, light
    expect(t.energyKcal).toBe(2084);
    for (const v of Object.values(t)) {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
    }
  });

  test('ageOn on the exact birthday is the new age', () => {
    expect(ageOn('1991-06-15', new Date('2026-06-15'))).toBe(35);
  });

  test.each([
    ['invalid dob', { dob: 'not-a-date' }],
    ['inherited-key sex', { sex: 'constructor' as never }],
    ['inherited-key activityLevel', { activityLevel: 'toString' as never }],
  ])('corrupt profile (%s) falls back to finite generic targets', (_n, patch) => {
    const t = computeTargets({ ...ownerProfile, ...patch }, ON);
    expect(t.isGeneric).toBe(true);
    for (const v of Object.values(t)) {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
    }
  });

  test('targets follow the latest weight in the log', () => {
    const p = {
      ...ownerProfile,
      weightLog: [
        { date: '2026-01-01', kg: 80 },
        { date: '2026-11-01', kg: 76 },
      ],
    };
    expect(computeTargets(p, ON).proteinG).toBe(129); // 1.7 g/kg of 76 kg
  });

  test('currentWeightKg uses the latest-dated entry even when unsorted', () => {
    const p = {
      ...ownerProfile,
      weightLog: [
        { date: '2026-11-01', kg: 76 },
        { date: '2026-01-01', kg: 80 },
      ],
    };
    expect(currentWeightKg(p)).toBe(76);
  });

  test('overrides win over computed targets', () => {
    const p = { ...ownerProfile, overrides: { sodiumMg: 2300 } };
    expect(computeTargets(p, ON).sodiumMg).toBe(2300);
  });

  test('empty weightLog falls back to generic targets with no NaN', () => {
    const t = computeTargets({ ...ownerProfile, weightLog: [] }, ON);
    expect(t.isGeneric).toBe(true);
    expect(currentWeightKg({ ...ownerProfile, weightLog: [] })).toBeUndefined();
    for (const v of Object.values(t)) {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
    }
  });

  describe('micronutrient reference intakes', () => {
    const keys = ['calciumMg', 'ironMg', 'magnesiumMg', 'zincMg', 'vitaminCMg', 'vitaminDUg', 'vitaminB12Ug', 'folateUg', 'potassiumMg'] as const;

    test('every micronutrient the dataset carries has a positive finite reference', () => {
      for (const sex of ['male', 'female', 'unspecified'] as const) {
        const t = computeTargets({ ...ownerProfile, sex }, ON);
        for (const k of keys) {
          const v = t.micronutrients[k];
          expect(Number.isFinite(v) && (v ?? 0) > 0, `${sex} ${k}`).toBe(true);
        }
      }
      for (const k of keys) expect(computeTargets(null, ON).micronutrients[k]).toBeGreaterThan(0);
    });

    test('iron differs by sex and unspecified takes the higher reference', () => {
      const m = computeTargets({ ...ownerProfile, sex: 'male' }, ON).micronutrients.ironMg!;
      const f = computeTargets({ ...ownerProfile, sex: 'female' }, ON).micronutrients.ironMg!;
      const u = computeTargets({ ...ownerProfile, sex: 'unspecified' }, ON).micronutrients.ironMg!;
      expect(m).toBe(11);
      expect(f).toBe(16);
      expect(u).toBe(Math.max(m, f));
    });

    test('pins the EFSA adult values', () => {
      expect(computeTargets({ ...ownerProfile, sex: 'male' }, ON).micronutrients).toEqual({
        calciumMg: 950, ironMg: 11, magnesiumMg: 350, zincMg: 11.7, vitaminCMg: 110, vitaminDUg: 15,
        vitaminB12Ug: 4, folateUg: 330, potassiumMg: 3500,
      });
    });
  });

  describe('protein', () => {
    test('the floor is EFSA PRI for any adult', () => {
      // 0.83 g/kg. For an 80 kg adult: 66 g.
      expect(computeTargets(profileAt(80, 'sedentary'), ON).proteinFloorG).toBe(66);
    });

    test('a sedentary adult target is the EFSA PRI, not a sports figure', () => {
      const t = computeTargets(profileAt(80, 'sedentary'), ON);
      expect(t.proteinG).toBe(66);
      expect(t.basis.protein).toBe('efsa-pri');
    });

    test('an adult who exercises gets the ISSN range, positioned at its middle when holding', () => {
      // 1.7 g/kg of 80 kg = 136 g.
      const t = computeTargets(profileAt(80, 'moderate', { kind: 'hold' }), ON);
      expect(t.proteinG).toBe(136);
      expect(t.basis.protein).toBe('issn-range');
    });

    test('no goal and a gain goal sit at the same point as holding', () => {
      expect(computeTargets(profileAt(80, 'moderate'), ON).proteinG).toBe(136);
      expect(computeTargets(profileAt(80, 'moderate', { kind: 'gain' }), ON).proteinG).toBe(136);
    });

    test('losing weight moves protein to the top of the range whose basis is stated', () => {
      // 2.0 g/kg of 80 kg = 160 g. NOT a larger figure: see the spec, section 6. A rate is not required.
      expect(computeTargets(profileAt(80, 'moderate', { kind: 'lose' }), ON).proteinG).toBe(160);
    });

    test('a sedentary person losing weight is not given a sports figure', () => {
      const t = computeTargets(profileAt(80, 'sedentary', { kind: 'lose' }), ON);
      expect(t.proteinG).toBe(66);
      expect(t.basis.protein).toBe('efsa-pri');
    });

    test('the floor never exceeds the target', () => {
      for (const a of ACTIVITY_LEVELS) {
        const t = computeTargets(profileAt(80, a), ON);
        expect(t.proteinFloorG).toBeLessThanOrEqual(t.proteinG);
      }
    });

    test('basis names where energy and expenditure come from', () => {
      const t = computeTargets(profileAt(80, 'moderate'), ON);
      expect(t.basis.energy).toBe('mifflin');
      expect(t.basis.expenditure).toBe('formula');
    });
  });
});
