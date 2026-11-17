/**
 * The two-way conversion between a weekly rate of weight change and a daily energy deficit or surplus. One pair of
 * functions and one set of sentences, so every reading agrees; the weight page reuses them (design document section 8.5).
 */

/**
 * Energy per kilogram of body weight change. The app adopts 7,700 kcal/kg as a working approximation; it is the app's own
 * choice, not a figure taken from a cited source. Why it is accepted to SET a weekly offset and refused for a long
 * projection is recorded in the design document's verification log, under "Weight goal and energy".
 */
export const KCAL_PER_KG = 7700;

/** Daily kcal that a weekly rate (kg a week, a magnitude) needs. */
export function dailyKcalForRate(rateKgPerWeek: number): number {
  return Math.round((rateKgPerWeek * KCAL_PER_KG) / 7);
}

/** Weekly rate (kg a week, a magnitude) that a daily deficit or surplus implies. The inverse of `dailyKcalForRate`. */
export function rateForDailyKcal(kcalPerDay: number): number {
  return (kcalPerDay * 7) / KCAL_PER_KG;
}

export const formatRate = (rate: number): string => String(Math.round(rate * 100) / 100);

export const offsetWord = (kind: 'lose' | 'gain'): 'deficit' | 'surplus' => (kind === 'lose' ? 'deficit' : 'surplus');

export function rateToDailyPhrase(kind: 'lose' | 'gain', rate: number): string {
  return `${formatRate(rate)} kg a week needs a ${offsetWord(kind)} of about ${dailyKcalForRate(rate)} kcal a day.`;
}

export function dailyToRatePhrase(kind: 'lose' | 'gain', kcal: number): string {
  return `A ${offsetWord(kind)} of ${Math.round(kcal)} kcal a day is about ${formatRate(rateForDailyKcal(kcal))} kg a week.`;
}

export const CONVERSION_NOTE = `Both readings use ${KCAL_PER_KG.toLocaleString('en-GB')} kcal per kg of body weight, the app's own working approximation and not a published figure.`;
