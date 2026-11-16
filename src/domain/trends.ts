import { lastNDayKeys, localDayKey } from '@/domain/dayBoundary';
import { isKnownValue } from '@/domain/nutrients';
import { dayTotals, type DayTotals } from '@/domain/totals';
import type { DiaryEntry } from '@/types/diary';
import type { NutrientKey } from '@/types/nutrients';

/**
 * Change over weeks (design section 11, stretched past seven days). Same honesty as the week view: an absent nutrient is
 * unknown, never zero, and a week is only a data point when enough of its days were logged. Nothing here is a score.
 */

/** A week is only a data point when at least this many of its seven days have entries. Same gate as the week view. */
export const MIN_LOGGED_DAYS = 4;

export const TREND_NUTRIENTS = ['fibreG', 'proteinG', 'sodiumMg', 'addedSugarsG', 'energyKcal'] as const satisfies readonly NutrientKey[];
export type TrendNutrient = (typeof TREND_NUTRIENTS)[number];

/**
 * 'thin': too few logged days, so the week says nothing. 'unknown': enough days were logged but too few carried complete
 * data for this figure. Neither is ever a number, so neither can plot as a low week.
 */
export type Point =
  | { status: 'value'; value: number; /** Present on a median: how many days it was taken over. */ days?: number; /** True when it is a floor. */ atLeast?: true }
  | { status: 'thin' }
  | { status: 'unknown' };

export type TrendWeek = {
  /** First and last local day of the seven-day window. */
  startKey: string;
  endKey: string;
  /** Days with at least one counted entry. Always a real count, including 0. */
  loggedDays: number;
  enough: boolean;
  processedMeat: Point;
  vegDays: Point;
  metrics: Record<TrendNutrient, Point>;
};

const THIN: Point = { status: 'thin' };

function counts(e: DiaryEntry): boolean {
  return e.state === 'active' && e.userAction !== 'cancelled';
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** A day's figure is usable only when every counted entry knew it and it covers the day's energy: the Missing view's rule. */
function completeValue(d: DayTotals, key: NutrientKey): number | undefined {
  const v = d.nutrients[key];
  if (!isKnownValue(v) || d.coverage[key] !== 'known' || d.energyCoveredShare[key] < 0.999) return undefined;
  return v;
}

/**
 * `weeks` consecutive seven-day windows ending on the local day of `now`, oldest first. The newest window is the same
 * "last 7 days" the other screens use. Cancelled, deleted and superseded entries are ignored, so a revision counts once.
 */
export function weeklyTrends(entries: DiaryEntry[], now: Date, weeks = 12): TrendWeek[] {
  const keys = lastNDayKeys(now, weeks * 7);
  const byDay = new Map<string, DiaryEntry[]>();
  const wanted = new Set(keys);
  for (const e of entries) {
    if (!counts(e)) continue;
    const k = localDayKey(e.at);
    if (!wanted.has(k)) continue;
    const list = byDay.get(k);
    if (list) list.push(e);
    else byDay.set(k, [e]);
  }

  const out: TrendWeek[] = [];
  for (let w = 0; w < weeks; w++) {
    const wk = keys.slice(w * 7, w * 7 + 7);
    const all = wk.map((k) => dayTotals(byDay.get(k) ?? [], k));
    const logged = all.filter((d) => d.entryCount > 0);
    const enough = logged.length >= MIN_LOGGED_DAYS;

    const metrics = {} as Record<TrendNutrient, Point>;
    for (const key of TREND_NUTRIENTS) {
      if (!enough) {
        metrics[key] = THIN;
        continue;
      }
      const vals = logged.map((d) => completeValue(d, key)).filter((v): v is number => v !== undefined);
      metrics[key] = vals.length >= MIN_LOGGED_DAYS ? { status: 'value', value: median(vals), days: vals.length } : { status: 'unknown' };
    }

    let processedMeat: Point = THIN;
    let vegDays: Point = THIN;
    if (enough) {
      const weekEntries = wk.flatMap((k) => byDay.get(k) ?? []);
      processedMeat = { status: 'value', value: weekEntries.filter((e) => e.classification?.processedMeat).length };
      const withVeg = logged.filter((d) => d.vegCupEq > 0 || d.hasVegetableFlag).length;
      // A day with no vegetable evidence and incomplete FPED may still have had one: the count is then a floor.
      const unprovable = logged.filter((d) => d.vegCupEq === 0 && !d.hasVegetableFlag && d.vegCoverage !== 'known').length;
      vegDays = unprovable > 0 ? { status: 'value', value: withVeg, atLeast: true } : { status: 'value', value: withVeg };
    }

    out.push({ startKey: wk[0]!, endKey: wk[6]!, loggedDays: logged.length, enough, processedMeat, vegDays, metrics });
  }
  return out;
}
