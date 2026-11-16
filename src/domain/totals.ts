import { isKnownValue, sumNutrients } from '@/domain/nutrients';
import { last7DayKeys, localDayKey } from '@/domain/dayBoundary';
import type { DiaryEntry } from '@/types/diary';
import { NUTRIENT_KEYS, type Coverage, type NutrientKey, type NutrientSet } from '@/types/nutrients';

export type DayTotals = {
  dayKey: string;
  /** A key is absent when no entry that day knew it: unknown, never zero. */
  nutrients: NutrientSet;
  coverage: Coverage;
  /**
   * Per nutrient: the share (0..1) of the day's energy contributed by entries that knew that key.
   * 0 when the day has no positive energy figure. A rule needing a trustworthy total (added sugar)
   * should stay silent when this is low rather than report an understated number.
   */
  energyCoveredShare: Record<NutrientKey, number>;
  /** Vegetable cup-equivalents summed over entries that carry FPED data. Read vegCoverage before trusting a 0. */
  vegCupEq: number;
  /** 'known' for an empty day or when every entry had FPED; 'unknown' when none did; else 'partial'. */
  vegCoverage: 'known' | 'partial' | 'unknown';
  /** True when any entry's classification says it contained a vegetable. */
  hasVegetableFlag: boolean;
};

export type WeekContext = {
  /** Seven days, oldest first, ending on the local day of `on`. */
  days: DayTotals[];
  /** Entries (meals) with processed meat, not grams: the evidence is about frequency. */
  processedMeatOccasions: number;
  /** Grams over the week from entries classified as red meat (the whole entry's item grams). */
  redMeatGrams: number;
  /**
   * Entries whose merged classification has alcohol. This counts drinks logged, NOT grams of
   * ethanol or standard units: the dataset has no alcohol-gram nutrient, so a rule consuming this
   * must not claim to know units.
   */
  alcoholOccasions: number;
  /** Known vegetable cup-equivalents per day, aligned with `days`. May understate a partly-unknown day. */
  vegCupEqByDay: number[];
  /** Days with no vegetable and a fully known record (empty days included). */
  daysWithoutVegetable: number;
  /** Days that have entries but no vegetable evidence and incomplete FPED, so "no vegetable" is not provable. */
  daysVegetableUnknown: number;
};

/** The wrong list can reach these pure functions, so they re-assert what the store promises. */
function counts(e: DiaryEntry): boolean {
  return e.state === 'active' && e.userAction !== 'cancelled';
}

function entriesOn(entries: DiaryEntry[], dayKey: string): DiaryEntry[] {
  return entries.filter((e) => counts(e) && localDayKey(e.at) === dayKey);
}

function buildDay(entries: DiaryEntry[], dayKey: string): DayTotals {
  const day = entriesOn(entries, dayKey);
  const { total, coverage } = sumNutrients(day.map((e) => e.nutrients));

  let energy = 0;
  for (const e of day) {
    const k = e.nutrients.energyKcal;
    if (isKnownValue(k) && k > 0) energy += k;
  }
  const energyCoveredShare = {} as Record<NutrientKey, number>;
  for (const key of NUTRIENT_KEYS) {
    let covered = 0;
    if (energy > 0) {
      for (const e of day) {
        const k = e.nutrients.energyKcal;
        if (isKnownValue(k) && k > 0 && isKnownValue(e.nutrients[key])) covered += k;
      }
    }
    energyCoveredShare[key] = energy > 0 ? covered / energy : 0;
  }

  let vegCupEq = 0;
  let withFped = 0;
  for (const e of day) {
    if (e.fped && isKnownValue(e.fped.vegCupEq)) {
      vegCupEq += e.fped.vegCupEq;
      withFped++;
    }
  }
  const vegCoverage = withFped === day.length ? 'known' : withFped === 0 ? 'unknown' : 'partial';

  return {
    dayKey,
    nutrients: total,
    coverage,
    energyCoveredShare,
    vegCupEq,
    vegCoverage,
    hasVegetableFlag: day.some((e) => e.classification.vegetable),
  };
}

/** Totals for one local day. Entries from other days, cancelled entries and tombstones are ignored. */
export function dayTotals(entries: DiaryEntry[], dayKey: string): DayTotals {
  return buildDay(entries, dayKey);
}

/** The 7-day context ending on the local day of `on` (the caller supplies `on`; nothing here reads the clock). */
export function weekContext(entries: DiaryEntry[], on: Date): WeekContext {
  const keys = last7DayKeys(on);
  const inWindow = new Set(keys);
  const week = entries.filter((e) => counts(e) && inWindow.has(localDayKey(e.at)));
  const days = keys.map((k) => buildDay(week, k));

  let redMeatGrams = 0;
  for (const e of week) {
    if (e.classification.redMeat) {
      for (const it of e.items) if (isKnownValue(it.grams)) redMeatGrams += it.grams;
    }
  }

  let daysWithoutVegetable = 0;
  let daysVegetableUnknown = 0;
  for (const d of days) {
    if (d.vegCupEq > 0 || d.hasVegetableFlag) continue;
    if (d.vegCoverage === 'known') daysWithoutVegetable++;
    else daysVegetableUnknown++;
  }

  return {
    days,
    processedMeatOccasions: week.filter((e) => e.classification.processedMeat).length,
    redMeatGrams,
    alcoholOccasions: week.filter((e) => e.classification.alcohol).length,
    vegCupEqByDay: days.map((d) => d.vegCupEq),
    daysWithoutVegetable,
    daysVegetableUnknown,
  };
}
