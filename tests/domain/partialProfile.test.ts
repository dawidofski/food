import { expect, test } from 'vitest';
import { computeTargets } from '@/domain/targets';
import type { Profile } from '@/types/profile';

const flagsOnly: Profile = { weightLog: [], flaggedAllergens: ['peanuts'], conditions: [] };

test('a profile holding only flags gives the same generic targets as no profile', () => {
  const now = new Date('2026-11-16T12:00:00Z');
  const t = computeTargets(flagsOnly, now);
  expect(t.isGeneric).toBe(true);
  expect(t).toEqual(computeTargets(null, now));
});

test('overrides still apply on top of generic targets', () => {
  const t = computeTargets({ ...flagsOnly, overrides: { proteinG: 99 } }, new Date('2026-11-16T12:00:00Z'));
  expect(t.isGeneric).toBe(true);
  expect(t.proteinG).toBe(99);
});
