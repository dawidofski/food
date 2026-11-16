import { isKnownValue, sumNutrients } from '@/domain/nutrients';
import { last7DayKeys, localDayKey } from '@/domain/dayBoundary';
import type { DiaryEntry } from '@/types/diary';
import type { ClassificationFlags } from '@/types/nutrients';
import { NUTRIENT_KEYS, type Coverage, type NutrientKey, type NutrientSet } from '@/types/nutrients';

export type DayTotals = {
  dayKey: string;
  /** Counted entries that day. 0 is an empty day; >0 with empty `nutrients` means entries exist but carry no nutrient data. */
  entryCount: number;
  /** A key is absent when no entry that day knew it: unknown, never zero. */
  nutrients: NutrientSet;
  coverage: Coverage;
  /**
   * Per nutrient: the share (0..1) of the day's energy contributed by entries that knew that key.
   * 0 when the day has no positive energy figure. A rule needing a trustworthy total (added sugar)
   * should stay silent when this is low rather than report an understated number.
   * CAVEAT: entries with no energy figure are invisible to this ratio, so it can be 1 while
   * `coverage[key]` is 'partial'. A rule MUST check BOTH this share AND `coverage[key]` before
   * trusting a daily total; checking only one can fire off an understated number.
   */
  energyCoveredShare: Record<NutrientKey, number>;
  /**
   * Vegetable cup-equivalents summed over entries that carry FPED data. This is a LOWER BOUND when
   * vegCoverage is not 'known': a 0 with 'unknown' or 'partial' means "we do not know", not "none".
   */
  vegCupEq: number;
  /** 'known' for an empty day or when every entry had FPED; 'unknown' when none did; else 'partial'. */
  vegCoverage: 'known' | 'partial' | 'unknown';
  /** True when any entry's classification says it contained a vegetable. */
  hasVegetableFlag: boolean;
  /** Counted entries that day whose merged classification is NOVA group 4. Entries, not energy: no per-entry energy share is kept. */
  nova4EntryCount: number;
};

/**
 * The nutrients whose daily rules can carry a frequency note. One per daily nutrient rule: sodium, added sugar and
 * saturated fat. Nothing here is a threshold; the figure each is compared with lives in `Targets`, where it is sourced.
 */
export const PATTERN_NUTRIENTS = ['sodiumMg', 'addedSugarsG', 'satFatG'] as const satisfies readonly NutrientKey[];
export type PatternNutrient = (typeof PATTERN_NUTRIENTS)[number];

/** Days before today in the frequency window. Today is the seventh day of the window and is never one of these. */
export const PATTERN_WINDOW_DAYS = 6;

/**
 * A day's total for `key` when it can be trusted: every counted entry knew it, no entry's own figure was itself a
 * floor, and the known values cover the day's energy. Undefined otherwise. A day we cannot vouch for is LEFT OUT of a
 * count — it is never counted as a day under a figure, because a floor below a figure proves nothing.
 * (The same test the trends view applies before plotting a week; kept here so `totals` does not depend on `trends`.)
 */
export function completeDayValue(d: DayTotals, key: NutrientKey): number | undefined {
  const v = d.nutrients[key];
  if (!isKnownValue(v) || d.coverage[key] !== 'known' || d.energyCoveredShare[key] < 0.999) return undefined;
  return v;
}

export type WeekContext = {
  /** Seven days, oldest first, ending on the local day of `on`. */
  days: DayTotals[];
  /** Entries (meals) with processed meat, not grams: the evidence is about frequency. */
  processedMeatOccasions: number;
  /** Grams over the week of items whose own classification is red meat. */
  redMeatGrams: number;
  /**
   * Entries containing alcohol (merged classification): "two beers" in one entry is 1. This is NOT a
   * drink count, and NOT grams of
   * ethanol or standard units: the dataset has no alcohol-gram nutrient, so a rule consuming this
   * must not claim to know units.
   */
  alcoholOccasions: number;
  /** Known vegetable cup-equivalents per day, aligned with `days`. May understate a partly-unknown day. */
  vegCupEqByDay: number[];
  /**
   * Days with no vegetable and a fully known record. An EMPTY day counts (correct arithmetic), so a
   * fresh or lapsed diary reads 7. The consuming view MUST gate on having enough logged days before
   * showing this, or it tells someone who simply has not logged that they ate no vegetables.
   */
  daysWithoutVegetable: number;
  /**
   * Days with entries, no vegetable flag and incomplete FPED, so "no vegetable" cannot be proven.
   * Show these as "unknown": never add them to daysWithoutVegetable, and never treat them as a vegetable day.
   */
  daysVegetableUnknown: number;
  /** Days in the window with at least one counted entry, today included. The honesty gate for anything counted over the window. */
  loggedDays: number;
  /**
   * Per nutrient: that day's total for each of the SIX days BEFORE today whose figure for the key is complete
   * (`completeDayValue`), oldest first. TODAY IS EXCLUDED: a card already states today, and today is still being logged.
   * A day whose coverage for the key is 'partial' or 'unknown' is ABSENT from the list rather than present as a low
   * number, so the length is the number of days we can vouch for and is at most six. Counting how many of them are
   * above a figure is the consumer's job, because the figure belongs to `Targets`, not here.
   */
  completeDayTotalsBeforeToday: Record<PatternNutrient, number[]>;
  /**
   * Entries (meals) containing a sugar-sweetened drink, not drinks: an entry with two colas is 1. Counted per entry
   * exactly as `processedMeatOccasions` is.
   */
  sweetDrinkOccasions: number;
  /**
   * Entries whose merged classification is NOVA group 4, not amounts or energy: an entry with two packaged snacks is 1.
   * Counted per entry exactly as `processedMeatOccasions` is.
   */
  ultraProcessedOccasions: number;
};

/** The wrong list can reach these pure functions, so they re-assert what the store promises. */
function counts(e: DiaryEntry): boolean {
  return e.state === 'active' && e.userAction !== 'cancelled';
}

/** A row written before classification was snapshotted must degrade, not white-screen the diary: treat it as all-false. */
function flagsOf(x: { classification?: ClassificationFlags }): Partial<ClassificationFlags> {
  return x.classification ?? {};
}

function entriesOn(entries: DiaryEntry[], dayKey: string): DiaryEntry[] {
  return entries.filter((e) => counts(e) && localDayKey(e.at) === dayKey);
}

function buildDay(entries: DiaryEntry[], dayKey: string): DayTotals {
  const day = entriesOn(entries, dayKey);
  const { total, coverage } = sumNutrients(day.map((e) => e.nutrients));
  // sumNutrients sees only values, so it cannot tell that an entry's figure is itself a floor (some of its items had no
  // figure). An entry whose own coverage says 'partial' makes the day's figure partial, never known.
  for (const key of NUTRIENT_KEYS) {
    if (coverage[key] === 'known' && day.some((e) => e.coverage?.[key] === 'partial')) coverage[key] = 'partial';
  }

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
        if (isKnownValue(k) && k > 0 && isKnownValue(e.nutrients[key]) && e.coverage?.[key] !== 'partial') covered += k;
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
    entryCount: day.length,
    nutrients: total,
    coverage,
    energyCoveredShare,
    vegCupEq,
    vegCoverage,
    hasVegetableFlag: day.some((e) => flagsOf(e).vegetable),
    nova4EntryCount: day.filter((e) => flagsOf(e).novaGroup === 4).length,
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
  // Per item: a chicken-and-beef dish counts only the beef, not the whole entry.
  for (const e of week) {
    for (const it of e.items) {
      if (flagsOf(it).redMeat && isKnownValue(it.grams)) redMeatGrams += it.grams;
    }
  }

  let daysWithoutVegetable = 0;
  let daysVegetableUnknown = 0;
  for (const d of days) {
    if (d.vegCupEq > 0 || d.hasVegetableFlag) continue;
    if (d.vegCoverage === 'known') daysWithoutVegetable++;
    else daysVegetableUnknown++;
  }

  // The six days before today: `days` is oldest first and ends on today, so today is the last element and is dropped.
  const before = days.slice(0, PATTERN_WINDOW_DAYS);
  const completeDayTotalsBeforeToday = {} as Record<PatternNutrient, number[]>;
  for (const key of PATTERN_NUTRIENTS) {
    completeDayTotalsBeforeToday[key] = before
      .map((d) => completeDayValue(d, key))
      .filter((v): v is number => v !== undefined);
  }

  return {
    days,
    processedMeatOccasions: week.filter((e) => flagsOf(e).processedMeat).length,
    redMeatGrams,
    alcoholOccasions: week.filter((e) => flagsOf(e).alcohol).length,
    vegCupEqByDay: days.map((d) => d.vegCupEq),
    daysWithoutVegetable,
    daysVegetableUnknown,
    loggedDays: days.filter((d) => d.entryCount > 0).length,
    completeDayTotalsBeforeToday,
    sweetDrinkOccasions: week.filter((e) => flagsOf(e).sweetDrink).length,
    ultraProcessedOccasions: week.filter((e) => flagsOf(e).novaGroup === 4).length,
  };
}
