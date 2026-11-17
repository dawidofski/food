/**
 * What the owner types in from Samsung Health for one local day. It is not food and does not live in the diary.
 *
 * Every figure is optional and ABSENT MEANS UNKNOWN, never zero: a day with no step count is not a day with no steps.
 * `date` is a local day key (`localDayKey`) and is the store's key.
 */
export type HealthDay = {
  date: string;
  /** 0-100 inclusive. */
  sleepScore?: number;
  /** Context only. A whole-day burn figure already contains steps, so they are never added to it. */
  steps?: number;
  /** A whole day's energy burned, in kcal. */
  energyBurnedKcal?: number;
};
