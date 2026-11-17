import { KCAL_PER_KG } from '@/domain/goalConversion';
import type { NutrientKey } from '@/types/nutrients';
import type { ActivityLevel, Goal, Profile, Sex, Targets } from '@/types/profile';

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

/**
 * Protein, grams per kilogram of body weight per day. Both figures are read verbatim from their sources and recorded
 * in the design document's verification log.
 *
 * EFSA_PRI: EFSA Panel on Dietetic Products, Nutrition and Allergies, "Scientific Opinion on Dietary Reference Values for
 * protein", EFSA Journal 2012;10(2):2557, https://doi.org/10.2903/j.efsa.2012.2557: "the PRI for adults of all ages was
 * estimated to be 0.83 g protein/kg body weight per day". It is the floor for everyone, and the target for someone who
 * is sedentary, because the range below is stated for exercising individuals and the app must not assume anyone trains.
 *
 * ISSN range: Jager et al., "International Society of Sports Nutrition Position Stand: protein and exercise", J Int Soc
 * Sports Nutr 2017;14:20, Position 2: "an overall daily protein intake in the range of 1.4-2.0 g protein/kg body
 * weight/day". Its basis is stated to be body weight. A weight-loss goal takes the top of the range; every other case
 * takes the middle.
 */
const PROTEIN_EFSA_PRI_G_PER_KG = 0.83;
const PROTEIN_ISSN_MID_G_PER_KG = 1.7;
const PROTEIN_ISSN_TOP_G_PER_KG = 2.0;

type MicroRef = Partial<Record<NutrientKey, number>>;

/**
 * Adult reference values from EFSA's Summary of Dietary Reference Values (January 2017 consolidated table): PRIs, and AIs
 * for magnesium, potassium, vitamin D and vitamin B12. Population planning values, not personal requirements. Calcium is
 * the 25-and-over band, a woman's iron is the premenopausal PRI, and zinc is the PRI at a phytate intake of 600 mg/d (the
 * app cannot know the real one). Age is not modelled. 'unspecified' takes the HIGHER iron reference and the LOWER of the
 * two for every other nutrient, so no gap is announced that only one sex's figure would produce. Table, column and
 * limits are recorded in the design document's verification log.
 */
const MICRO_MALE: MicroRef = {
  calciumMg: 950, ironMg: 11, magnesiumMg: 350, zincMg: 11.7, vitaminCMg: 110, vitaminDUg: 15,
  vitaminB12Ug: 4, folateUg: 330, potassiumMg: 3500,
};
const MICRO_FEMALE: MicroRef = {
  calciumMg: 950, ironMg: 16, magnesiumMg: 300, zincMg: 9.3, vitaminCMg: 95, vitaminDUg: 15,
  vitaminB12Ug: 4, folateUg: 330, potassiumMg: 3500,
};

/**
 * Which kind of EFSA value each reference is. A PRI covers nearly everyone's needs; an AI is set when the evidence cannot
 * support a PRI, so it is a best estimate. Kind assignment follows EFSA's opinions (see the verification log).
 */
export const MICRO_KIND: Partial<Record<NutrientKey, 'PRI' | 'AI'>> = {
  calciumMg: 'PRI', ironMg: 'PRI', zincMg: 'PRI', vitaminCMg: 'PRI', folateUg: 'PRI',
  magnesiumMg: 'AI', potassiumMg: 'AI', vitaminDUg: 'AI', vitaminB12Ug: 'AI',
};

function microsFor(sex: Sex): MicroRef {
  if (sex === 'male') return { ...MICRO_MALE };
  if (sex === 'female') return { ...MICRO_FEMALE };
  const out: MicroRef = {};
  for (const k of Object.keys(MICRO_MALE) as NutrientKey[]) {
    const a = MICRO_MALE[k]!;
    const b = MICRO_FEMALE[k]!;
    out[k] = k === 'ironMg' ? Math.max(a, b) : Math.min(a, b);
  }
  return out;
}

function isPositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/** Whole years completed on `on`, from an ISO date of birth. Uses UTC calendar fields: callers pass a date whose UTC day is the intended day. NaN if dob is invalid. */
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

/**
 * The range of body-fat percentage the app will use to switch to lean-mass resting metabolism. These two bounds are the
 * app's own choice and not a published figure: they are wide enough to admit lean athletes and people with obesity, and
 * narrow enough to reject a typo or a unit slip (0, a negative, 95, 150). Outside this range, or when the value is not a
 * finite number, the percentage is ignored and the resting rate stays on Mifflin-St Jeor. Zero is a value, and an
 * implausible one, not "none stated".
 */
const BODY_FAT_PCT_PLAUSIBLE = { min: 3, max: 60 } as const;

function usableBodyFatPct(pct: number | undefined): number | undefined {
  return typeof pct === 'number' && Number.isFinite(pct) && pct >= BODY_FAT_PCT_PLAUSIBLE.min && pct <= BODY_FAT_PCT_PLAUSIBLE.max
    ? pct
    : undefined;
}


/**
 * The largest weekly rate of change the app will turn into an energy offset. This is the app's own choice and not a
 * published figure. 1 kg a week is a deficit of 1,100 kcal a day, which already exceeds what the resting-rate floor
 * below allows for most adults; the cap exists so that a gain goal, which has no such floor, and a heavy or very active
 * person, whose floor is far away, cannot be given an extreme offset either. A requested rate above it is reduced to
 * it, and `Targets.goalCapped` says so.
 */
export const MAX_GOAL_RATE_KG_PER_WEEK = 1;

/**
 * The goal's effect on energy. A goal with no usable rate does not move energy: inventing a default deficit for someone
 * who never stated one would put them in a deficit they did not ask for. (Protein moves on the goal's kind alone.)
 * The energy target never falls below the resting rate, whatever the rate asked for.
 */
function applyGoal(maintenance: number, rmr: number, goal: Goal | undefined): { energy: number; capped: boolean } {
  const rate = goal?.rateKgPerWeek;
  if ((goal?.kind !== 'lose' && goal?.kind !== 'gain') || !isPositive(rate)) return { energy: maintenance, capped: false };
  const usedRate = Math.min(rate, MAX_GOAL_RATE_KG_PER_WEEK);
  const offset = Math.round((usedRate * KCAL_PER_KG) / 7);
  if (goal.kind === 'gain') return { energy: maintenance + offset, capped: usedRate < rate };
  const floor = Math.round(rmr);
  const energy = Math.max(maintenance - offset, floor);
  // Capped when the rate was reduced, or when the floor, not the rate, set the target (and so the deficit is smaller).
  return { energy, capped: usedRate < rate || energy !== maintenance - offset };
}

function derive(
  heightCm: number,
  weightKg: number,
  age: number,
  sex: Sex,
  activity: ActivityLevel,
  isGeneric: boolean,
  goal?: Goal,
  bodyFatPct?: number,
): Targets {
  // Katch-McArdle: 370 + 21.6 x lean kg, when a plausible body-fat percentage is known; otherwise Mifflin-St Jeor.
  const bf = usableBodyFatPct(bodyFatPct);
  const rmr =
    bf !== undefined
      ? 370 + 21.6 * (weightKg * (1 - bf / 100))
      : 10 * weightKg + 6.25 * heightCm - 5 * age + SEX_CONSTANT[sex];
  const maintenance = Math.round(rmr * ACTIVITY_FACTORS[activity]);
  // A deficit computed from a stranger's expenditure is meaningless, so the generic basis is not goal-adjusted.
  const adjusted = isGeneric ? { energy: maintenance, capped: false } : applyGoal(maintenance, rmr, goal);
  // Everything expressed by its source as a share of energy INTAKE follows the adjusted energy (a tighter intake carries
  // a tighter absolute allowance). Sodium and the micronutrients are absolute amounts and never move.
  const energy = adjusted.energy;
  // The generic basis's 'light' activity level is a convenience for the energy formula, not a claim that anyone exercises.
  // The ISSN range is stated for exercising individuals, so for a person the app knows nothing about, protein takes
  // EFSA's PRI, which is stated for adults generally. Energy and protein are deliberately not coupled here.
  const exercises = activity !== 'sedentary' && !isGeneric;
  const proteinPerKg = !exercises
    ? PROTEIN_EFSA_PRI_G_PER_KG
    : goal?.kind === 'lose'
      ? PROTEIN_ISSN_TOP_G_PER_KG
      : PROTEIN_ISSN_MID_G_PER_KG;
  return {
    rmrKcal: Math.round(rmr),
    energyKcal: energy,
    // Protein is sourced (see the constants above). Fibre, below, is still the app's own working figure.
    proteinG: Math.round(proteinPerKg * weightKg),
    proteinFloorG: Math.round(PROTEIN_EFSA_PRI_G_PER_KG * weightKg),
    fibreG: Math.max(30, Math.round((14 * energy) / 1000)),
    sodiumMg: SODIUM_MG,
    satFatG: Math.round((0.1 * energy) / 9),
    addedSugarsG: Math.round((0.1 * energy) / 4),
    addedSugarsIdealG: Math.round((0.05 * energy) / 4),
    transFatG: Math.round((0.01 * energy) / 9),
    micronutrients: microsFor(sex),
    isGeneric,
    ...(adjusted.capped ? { goalCapped: true as const } : {}),
    basis: { protein: exercises ? 'issn-range' : 'efsa-pri', energy: bf !== undefined ? 'katch-mcardle' : 'mifflin', expenditure: 'formula' },
  };
}

function genericTargets(): Targets {
  return derive(GENERIC.heightCm, GENERIC.weightKg, GENERIC.age, GENERIC.sex, GENERIC.activityLevel, true);
}

export function computeTargets(p: Profile | null, on: Date): Targets {
  if (p === null) return genericTargets();
  const weight = currentWeightKg(p);
  const age = p.dob === undefined ? NaN : ageOn(p.dob, on);
  const { heightCm, sex, activityLevel } = p;
  const derived =
    weight !== undefined &&
    isPositive(heightCm) &&
    Number.isFinite(age) &&
    age >= 0 &&
    sex !== undefined && Object.hasOwn(SEX_CONSTANT, sex) &&
    activityLevel !== undefined && Object.hasOwn(ACTIVITY_FACTORS, activityLevel)
      ? derive(heightCm, weight, age, sex, activityLevel, false, p.goal, p.bodyFatPct)
      : undefined;
  // Belt and braces: any non-finite derived target falls back to generic.
  const base =
    derived !== undefined && Object.values(derived).every((v) => typeof v !== 'number' || Number.isFinite(v))
      ? derived
      : genericTargets();
  const overrides: Partial<Targets> = {};
  for (const [k, v] of Object.entries(p.overrides ?? {})) {
    if (typeof v === 'number' && Number.isFinite(v)) (overrides as Record<string, number>)[k] = v;
  }
  // A number the person typed has no source: where an override applies, the basis says so instead of keeping a citation.
  const basis = { ...base.basis };
  if (overrides.proteinG !== undefined) basis.protein = 'custom';
  if (overrides.energyKcal !== undefined || overrides.rmrKcal !== undefined) basis.energy = 'custom';
  const merged: Targets = { ...base, ...overrides, basis, isGeneric: base.isGeneric };
  // A typed energy figure replaces the goal's result, so "the goal was reduced" no longer describes it.
  if (overrides.energyKcal !== undefined) delete merged.goalCapped;
  return merged;
}
