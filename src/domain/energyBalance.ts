import { completeDayValue, type DayTotals } from './totals';
import type { Targets } from '@/types/profile';

/**
 * The conversion between an energy balance and body weight. Printed on the page so the figure is never a black
 * box: the owner's own estimate had 700 kcal a day at 1 kg a week, which is roughly what you get by mixing up
 * the per-pound figure (3,500 kcal) with kilograms. §7.2 rejects this figure for a twelve-week projection and
 * accepts it here, for setting and explaining a starting rate.
 */
export const KCAL_PER_KG = 7700;

/** How far back the average looks. This app's own choice, said on screen as such. */
export const BALANCE_WINDOW_DAYS = 14;

/**
 * Below this many days the app can vouch for, it reports patchy logging instead of an average.
 *
 * This app's own choice, in the spirit of the 4-of-7 gate the trends screen already uses. An average over four
 * logged days out of fourteen is not this person's eating, it is the four days they happened to record.
 */
export const MIN_COMPLETE_DAYS = 8;

export type ExpenditureBasis = Targets['basis']['expenditure'];

export type EnergyBalance =
  | { kind: 'patchy'; completeDays: number }
  | {
      kind: 'known';
      completeDays: number;
      /** Mean energy per day over the days the app can vouch for — never over days with nothing logged. */
      intakeKcal: number;
      expenditureKcal: number;
      basis: ExpenditureBasis;
      /** Negative is a deficit. */
      balanceKcal: number;
      /** What that balance implies, at 7,700 kcal/kg. Negative is loss. */
      impliedKgPerWeek: number;
    };

/**
 * What the diary and the expenditure figure imply, as a daily balance and as a rate.
 *
 * A rate is what a person can act on: "about 0.4 kg a week" means something and "−430 kcal a day" does not.
 *
 * **A day with nothing logged is absent from the average, never counted as zero.** `completeDayValue` already
 * decides which days the app can vouch for — every entry knew its energy, none of them was itself a floor — and
 * it is reused here rather than reimplemented, so the two cannot drift apart. Counting unlogged days would
 * invent an enormous deficit out of a quiet week and project dramatic loss from it.
 */
export function energyBalance(
  days: DayTotals[],
  expenditureKcal: number,
  basis: ExpenditureBasis,
): EnergyBalance {
  const known: number[] = [];
  for (const d of days) {
    const v = completeDayValue(d, 'energyKcal');
    if (v !== undefined) known.push(v);
  }
  const completeDays = known.length;
  if (completeDays < MIN_COMPLETE_DAYS || !Number.isFinite(expenditureKcal) || expenditureKcal <= 0) {
    return { kind: 'patchy', completeDays };
  }
  const intakeKcal = known.reduce((a, b) => a + b, 0) / completeDays;
  const balanceKcal = intakeKcal - expenditureKcal;
  const impliedKgPerWeek = (balanceKcal * 7) / KCAL_PER_KG;
  return {
    kind: 'known',
    completeDays,
    intakeKcal,
    expenditureKcal,
    basis,
    balanceKcal,
    impliedKgPerWeek: Number.isFinite(impliedKgPerWeek) ? impliedKgPerWeek : 0,
  };
}
