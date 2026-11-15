import { describe, expect, test } from 'vitest';
import { ageOn, computeTargets, currentWeightKg } from '@/domain/targets';
import { ownerProfile } from '../fixtures/profile';

const ON = new Date('2026-11-15');

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
    expect(t.rmrKcal).toBe(2061); // 10*100 + 6.25*197 - 5*35 + 5
    expect(t.energyKcal).toBe(2834); // x 1.375 light activity
  });

  test('computeTargets pins the guideline-derived limits', () => {
    const t = computeTargets(ownerProfile, ON);
    expect(t.sodiumMg).toBe(2000);
    expect(t.satFatG).toBe(31);
    expect(t.addedSugarsG).toBe(71);
    expect(t.addedSugarsIdealG).toBe(35);
    expect(t.transFatG).toBe(3);
    expect(t.fibreG).toBe(40);
    expect(t.proteinG).toBe(120);
    expect(t.proteinFloorG).toBe(80);
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
        { date: '2026-01-01', kg: 100 },
        { date: '2026-11-01', kg: 96 },
      ],
    };
    expect(computeTargets(p, ON).proteinG).toBe(115);
  });

  test('currentWeightKg uses the latest-dated entry even when unsorted', () => {
    const p = {
      ...ownerProfile,
      weightLog: [
        { date: '2026-11-01', kg: 96 },
        { date: '2026-01-01', kg: 100 },
      ],
    };
    expect(currentWeightKg(p)).toBe(96);
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
});
