import { describe, expect, test } from 'vitest';
import { ACTIVITY_FACTORS, MAX_GOAL_RATE_KG_PER_WEEK, ageOn, computeTargets, currentWeightKg } from '@/domain/targets';
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

const emptyProfile: Profile = { weightLog: [], flaggedAllergens: [], conditions: [] };

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

    test('a null profile gets the EFSA PRI, not the sports range, though its energy basis is light activity', () => {
      const t = computeTargets(null, ON);
      expect(t.proteinG).toBe(58); // 0.83 x 70 kg
      expect(t.proteinFloorG).toBe(58);
      expect(t.basis.protein).toBe('efsa-pri');
      expect(t.energyKcal).toBe(2084); // energy still uses light activity
    });

    test('an incomplete profile that falls back to generic also gets the EFSA PRI, even with a lose goal', () => {
      const t = computeTargets(profileAt(80, 'moderate', { kind: 'lose' }, { heightCm: undefined }), ON);
      expect(t.isGeneric).toBe(true);
      expect(t.proteinG).toBe(58);
      expect(t.basis.protein).toBe('efsa-pri');
    });

    test('basis names where energy and expenditure come from', () => {
      const t = computeTargets(profileAt(80, 'moderate'), ON);
      expect(t.basis.energy).toBe('mifflin');
      expect(t.basis.expenditure).toBe('formula');
    });
  });

  describe('an override replaces the basis it overrides, and only that', () => {
    test('a typed protein target is custom and leaves energy alone', () => {
      const t = computeTargets({ ...profileAt(80, 'moderate'), overrides: { proteinG: 95 } }, ON);
      expect(t.proteinG).toBe(95);
      expect(t.basis).toEqual({ protein: 'custom', energy: 'mifflin', expenditure: 'formula' });
    });

    test('a typed energy or resting figure is custom and leaves protein alone', () => {
      for (const overrides of [{ energyKcal: 2000 }, { rmrKcal: 1600 }]) {
        const t = computeTargets({ ...profileAt(80, 'moderate'), overrides }, ON);
        expect(t.basis).toEqual({ protein: 'issn-range', energy: 'custom', expenditure: 'formula' });
      }
    });

    test('an override of something else changes no basis', () => {
      const t = computeTargets({ ...profileAt(80, 'moderate'), overrides: { sodiumMg: 2300 } }, ON);
      expect(t.basis).toEqual({ protein: 'issn-range', energy: 'mifflin', expenditure: 'formula' });
    });
  });

  describe('resting metabolism from body composition', () => {
    test('a usable body-fat percentage switches the resting rate to Katch-McArdle', () => {
      // 370 + 21.6 x lean kg. 80 kg at 25% fat = 60 kg lean -> 370 + 1296 = 1666.
      const t = computeTargets(profileAt(80, 'light', undefined, { bodyFatPct: 25 }), ON);
      expect(t.rmrKcal).toBe(1666);
      expect(t.basis.energy).toBe('katch-mcardle');
    });

    test.each([0, -5, 2.9, 60.1, 95, 100, Number.NaN, Number.POSITIVE_INFINITY])(
      'an implausible body-fat percentage (%s) is ignored, not used',
      (bad) => {
        const t = computeTargets(profileAt(80, 'light', undefined, { bodyFatPct: bad }), ON);
        expect(t.basis.energy).toBe('mifflin');
        expect(t.rmrKcal).toBe(computeTargets(profileAt(80, 'light'), ON).rmrKcal);
      },
    );

    test.each([3, 60])('the bounds themselves (%s) are accepted', (ok) => {
      expect(computeTargets(profileAt(80, 'light', undefined, { bodyFatPct: ok }), ON).basis.energy).toBe('katch-mcardle');
    });

    test('an override still marks energy custom when Katch-McArdle was used underneath', () => {
      const t = computeTargets(
        profileAt(80, 'light', undefined, { bodyFatPct: 25, overrides: { energyKcal: 2000 } }),
        ON,
      );
      expect(t.basis.energy).toBe('custom');
      expect(t.energyKcal).toBe(2000);
    });

    test('energy, and the figures derived from it, follow the new resting rate', () => {
      const t = computeTargets(profileAt(80, 'light', undefined, { bodyFatPct: 25 }), ON);
      expect(t.energyKcal).toBe(Math.round(1666 * 1.375));
    });
  });

  describe('a weight goal', () => {
    const on = ON;

    test('a deficit shifts energy by rate x 7700 / 7', () => {
      const hold = computeTargets(profileAt(80, 'light', { kind: 'hold' }), on).energyKcal;
      const lose = computeTargets(profileAt(80, 'light', { kind: 'lose', rateKgPerWeek: 0.5 }), on).energyKcal;
      expect(hold - lose).toBe(Math.round((0.5 * 7700) / 7)); // 550
    });

    test('a gain goal adds the same offset', () => {
      const hold = computeTargets(profileAt(80, 'light', { kind: 'hold' }), on).energyKcal;
      const gain = computeTargets(profileAt(80, 'light', { kind: 'gain', rateKgPerWeek: 0.25 }), on).energyKcal;
      expect(gain - hold).toBe(Math.round((0.25 * 7700) / 7)); // 275
    });

    test('a goal with no rate does not move energy, though it still moves protein', () => {
      const hold = computeTargets(profileAt(80, 'light', { kind: 'hold' }), on);
      const lose = computeTargets(profileAt(80, 'light', { kind: 'lose' }), on);
      expect(lose.energyKcal).toBe(hold.energyKcal);
      expect(lose.goalCapped).toBeUndefined();
      expect(lose.proteinG).toBe(160);
    });

    test('an unusable rate (zero, negative, not a number) does not move energy', () => {
      const hold = computeTargets(profileAt(80, 'light', { kind: 'hold' }), on).energyKcal;
      for (const rateKgPerWeek of [0, -0.5, Number.NaN]) {
        expect(computeTargets(profileAt(80, 'light', { kind: 'lose', rateKgPerWeek }), on).energyKcal).toBe(hold);
      }
    });

    test('the energy target never falls below the resting rate, and says when it was capped', () => {
      const t = computeTargets(profileAt(80, 'light', { kind: 'lose', rateKgPerWeek: 5 }), on);
      expect(t.energyKcal).toBeGreaterThanOrEqual(t.rmrKcal);
      expect(t.goalCapped).toBe('both'); // 5 kg/week exceeds the maximum AND the deficit would pass the floor
    });

    test('the cap names only the limit that applied, including when the capped target lands exactly on the floor', () => {
      // Active, 59 kg, 10 % body fat: maintenance 2617, resting 1517, so the maximum rate (1,100 kcal) lands exactly ON the floor.
      const p = profileAt(59, 'active', { kind: 'lose', rateKgPerWeek: 3 }, { bodyFatPct: 10 });
      const t = computeTargets(p, on);
      expect(t.energyKcal).toBe(t.rmrKcal);
      expect(t.goalCapped).toBe('max-rate'); // the floor did not bite: nothing was raised to it
    });

    test('a modest deficit is not flagged as capped', () => {
      const t = computeTargets(profileAt(80, 'light', { kind: 'lose', rateKgPerWeek: 0.5 }), on);
      expect(t.goalCapped).toBeUndefined();
    });

    test('a rate above the maximum is reduced to it, and says so', () => {
      // Heavy, active person: the floor is far away, so only the maximum rate can be what caps this.
      const hold = computeTargets(profileAt(150, 'veryActive', { kind: 'hold' }), on).energyKcal;
      const t = computeTargets(profileAt(150, 'veryActive', { kind: 'lose', rateKgPerWeek: 3 }), on);
      expect(hold - t.energyKcal).toBe(Math.round((MAX_GOAL_RATE_KG_PER_WEEK * 7700) / 7));
      expect(t.goalCapped).toBe('max-rate');
    });

    test('a rate within the maximum is still capped when the resting-rate floor truncates the deficit', () => {
      const t = computeTargets(profileAt(80, 'sedentary', { kind: 'lose', rateKgPerWeek: 0.5 }), on);
      expect(t.rmrKcal).toBe(1755);
      expect(t.energyKcal).toBe(t.rmrKcal); // 2106 - 550 = 1556, clamped to the floor
      expect(t.goalCapped).toBe('floor');
    });

    test('a gain rate above the maximum is reduced to it, and says so', () => {
      const hold = computeTargets(profileAt(80, 'light', { kind: 'hold' }), on).energyKcal;
      const t = computeTargets(profileAt(80, 'light', { kind: 'gain', rateKgPerWeek: 3 }), on);
      expect(t.energyKcal - hold).toBe(1100);
      expect(t.goalCapped).toBe('max-rate');
    });

    test('a goal does not adjust generic targets', () => {
      const t = computeTargets({ ...emptyProfile, goal: { kind: 'lose', rateKgPerWeek: 0.5 } }, on);
      expect(t.isGeneric).toBe(true);
      expect(t.energyKcal).toBe(computeTargets(emptyProfile, on).energyKcal);
      expect(t.goalCapped).toBeUndefined();
    });

    test('the goal does not change which formula produced the maintenance figure', () => {
      expect(computeTargets(profileAt(80, 'light', { kind: 'lose', rateKgPerWeek: 0.5 }), on).basis.energy).toBe('mifflin');
      const lean = profileAt(80, 'light', { kind: 'lose', rateKgPerWeek: 0.5 }, { bodyFatPct: 20 });
      expect(computeTargets(lean, on).basis.energy).toBe('katch-mcardle');
    });

    test('a custom energy override still wins, and is not called capped', () => {
      const p = profileAt(80, 'light', { kind: 'lose', rateKgPerWeek: 5 }, { overrides: { energyKcal: 2000 } });
      const t = computeTargets(p, on);
      expect(t.energyKcal).toBe(2000);
      expect(t.basis.energy).toBe('custom');
      expect(t.goalCapped).toBeUndefined();
    });

    // Spec 8.1.1: each figure follows its source's own basis.
    test('the shares of energy follow the goal; the absolute figures never move', () => {
      const hold = computeTargets(profileAt(80, 'light', { kind: 'hold' }), on);
      const lose = computeTargets(profileAt(80, 'light', { kind: 'lose', rateKgPerWeek: 0.5 }), on);
      expect(lose.satFatG).toBeLessThan(hold.satFatG);
      expect(lose.addedSugarsG).toBeLessThan(hold.addedSugarsG);
      expect(lose.addedSugarsIdealG).toBeLessThan(hold.addedSugarsIdealG);
      expect(lose.transFatG).toBeLessThan(hold.transFatG);
      expect(lose.fibreG).toBeLessThanOrEqual(hold.fibreG);
      // Pinned to arithmetic, not direction: a wrong divisor would still be "less than".
      expect(lose.energyKcal).toBe(1863);
      expect(lose.satFatG).toBe(21);
      expect(lose.addedSugarsG).toBe(47);
      expect(lose.addedSugarsIdealG).toBe(23);
      expect(lose.transFatG).toBe(2);
      expect(lose.fibreG).toBe(30);
      expect(lose.sodiumMg).toBe(hold.sodiumMg);
      expect(lose.micronutrients).toEqual(hold.micronutrients);
    });
  });
});
