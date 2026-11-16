import { lastNDayKeys, localDayKey } from '@/domain/dayBoundary';
import type { DiaryEntry } from '@/types/diary';

/**
 * What the stored data can honestly support about the warnings: how often each was shown and what was RECORDED when it
 * was. A 'cancelled' entry means the entry was not added to the diary. The app cannot know whether the food was then
 * eaten, so nothing here says anything about what was eaten or avoided, and nothing is a rate, a grade or a streak.
 *
 * Only `state: 'active'` rows count, so a superseded original and its revision are one entry, and a deleted entry is
 * gone. Unlike the nutrition code, cancelled rows are deliberately included: they are the point of this view.
 */

export type ActionCounts = { shown: number; added: number; addedAfterAlternatives: number; cancelled: number };

export type RuleHistory = ActionCounts & {
  ruleId: string;
  /** Calendar months (`YYYY-MM`) in which the rule was shown, oldest first. */
  months: ({ month: string } & ActionCounts)[];
};

export type BehaviourHistory = {
  rules: RuleHistory[];
  /** Counted entries in the period, with or without a warning. */
  entriesInPeriod: number;
  entriesWithWarnings: number;
  /** Local day of the earliest counted entry in the period, or null when there is none. */
  sinceKey: string | null;
};

const zero = (): ActionCounts => ({ shown: 0, added: 0, addedAfterAlternatives: 0, cancelled: 0 });

function bump(c: ActionCounts, action: DiaryEntry['userAction']): void {
  c.shown++;
  if (action === 'cancelled') c.cancelled++;
  else if (action === 'addedAfterAlternatives') c.addedAfterAlternatives++;
  else c.added++;
}

/** `days: null` means the whole diary. The period is the last `days` local days ending on the local day of `now`. */
export function behaviourHistory(entries: DiaryEntry[], now: Date, period: { days: number | null }): BehaviourHistory {
  const firstKey = period.days === null ? null : lastNDayKeys(now, period.days)[0]!;
  const rules = new Map<string, RuleHistory>();
  let entriesInPeriod = 0;
  let entriesWithWarnings = 0;
  let sinceKey: string | null = null;

  for (const e of entries) {
    if (e.state !== 'active') continue;
    const day = localDayKey(e.at);
    if (firstKey !== null && day < firstKey) continue;
    entriesInPeriod++;
    if (sinceKey === null || day < sinceKey) sinceKey = day;

    const ids = new Set(e.warningsShown.map((w) => w.ruleId));
    if (ids.size === 0) continue;
    entriesWithWarnings++;
    const month = day.slice(0, 7);
    for (const ruleId of ids) {
      let r = rules.get(ruleId);
      if (!r) {
        r = { ruleId, ...zero(), months: [] };
        rules.set(ruleId, r);
      }
      bump(r, e.userAction);
      let m = r.months.find((x) => x.month === month);
      if (!m) {
        m = { month, ...zero() };
        r.months.push(m);
      }
      bump(m, e.userAction);
    }
  }

  const list = [...rules.values()];
  for (const r of list) r.months.sort((a, b) => (a.month < b.month ? -1 : 1));
  list.sort((a, b) => b.shown - a.shown || (a.ruleId < b.ruleId ? -1 : 1));
  return { rules: list, entriesInPeriod, entriesWithWarnings, sinceKey };
}
