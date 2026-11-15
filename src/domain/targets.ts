import type { ActivityLevel, Profile, Sex, Targets } from '@/types/profile';

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  veryActive: 1.9,
};

const SEX_CONSTANT: Record<Sex, number> = {
  male: 5,
  female: -161,
  unspecified: (5 + -161) / 2,
};

/**
 * Generic fallback basis, used when the profile is null or incomplete:
 * 175 cm, 70 kg, age 40, sex 'unspecified', light activity.
 */
const GENERIC = {
  heightCm: 175,
  weightKg: 70,
  age: 40,
  sex: 'unspecified' as Sex,
  activityLevel: 'light' as ActivityLevel,
};

const SODIUM_MG = 2000; // WHO

function isPositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/** Whole years completed on `on`, from an ISO date of birth. Uses UTC calendar fields. NaN if dob is invalid. */
export function ageOn(dob: string, on: Date): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob);
  if (!m) return NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  let age = on.getUTCFullYear() - y;
  const month = on.getUTCMonth() + 1;
  const day = on.getUTCDate();
  // A 29 Feb birthday is reached on 1 March in non-leap years (plain month/day ordering).
  if (month < mo || (month === mo && day < d)) age -= 1;
  return age;
}

/** Weight from the latest-dated log entry (not the last array element). */
export function currentWeightKg(p: Profile): number | undefined {
  let best: { date: string; kg: number } | undefined;
  for (const e of p.weightLog) {
    if (!isPositive(e.kg)) continue;
    if (best === undefined || e.date > best.date) best = e;
  }
  return best?.kg;
}

function derive(
  heightCm: number,
  weightKg: number,
  age: number,
  sex: Sex,
  activity: ActivityLevel,
  isGeneric: boolean,
): Targets {
  const rmr = 10 * weightKg + 6.25 * heightCm - 5 * age + SEX_CONSTANT[sex];
  const energy = Math.round(rmr * ACTIVITY_FACTORS[activity]);
  return {
    rmrKcal: Math.round(rmr),
    energyKcal: energy,
    proteinG: Math.round(1.2 * weightKg),
    proteinFloorG: Math.round(0.8 * weightKg),
    fibreG: Math.max(30, Math.round((14 * energy) / 1000)),
    sodiumMg: SODIUM_MG,
    satFatG: Math.round((0.1 * energy) / 9),
    addedSugarsG: Math.round((0.1 * energy) / 4),
    addedSugarsIdealG: Math.round((0.05 * energy) / 4),
    transFatG: Math.round((0.01 * energy) / 9),
    isGeneric,
  };
}

function genericTargets(): Targets {
  return derive(GENERIC.heightCm, GENERIC.weightKg, GENERIC.age, GENERIC.sex, GENERIC.activityLevel, true);
}

export function computeTargets(p: Profile | null, on: Date): Targets {
  if (p === null) return genericTargets();
  const weight = currentWeightKg(p);
  const age = ageOn(p.dob, on);
  const complete =
    weight !== undefined &&
    isPositive(p.heightCm) &&
    Number.isFinite(age) &&
    age >= 0 &&
    p.sex in SEX_CONSTANT &&
    p.activityLevel in ACTIVITY_FACTORS;
  const base = complete
    ? derive(p.heightCm, weight, age, p.sex, p.activityLevel, false)
    : genericTargets();
  const overrides: Partial<Targets> = {};
  for (const [k, v] of Object.entries(p.overrides ?? {})) {
    if (typeof v === 'number' && Number.isFinite(v)) (overrides as Record<string, number>)[k] = v;
  }
  return { ...base, ...overrides, isGeneric: base.isGeneric };
}
