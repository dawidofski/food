import { describe, expect, test } from 'vitest';
import { behaviourHistory } from '@/domain/behaviour';
import type { DiaryEntry } from '@/types/diary';
import type { ClassificationFlags } from '@/types/nutrients';

const flags: ClassificationFlags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};
const NOW = new Date(2026, 10, 16, 12);
let n = 0;
function entry(back: number, over: Partial<DiaryEntry> = {}): DiaryEntry {
  return {
    id: `b${++n}`, at: new Date(2026, 10, 16 - back, 12).toISOString(), rawText: 'x', resolution: 'local',
    items: [], nutrients: {}, coverage: {}, classification: flags,
    warningsShown: [{ ruleId: 'processed-meat', level: 'HIGH' }], userAction: 'added', state: 'active', ...over,
  };
}

describe('behaviourHistory', () => {
  test('an empty diary gives no rules and zero counts, no NaN', () => {
    const h = behaviourHistory([], NOW, { days: 90 });
    expect(h.rules).toEqual([]);
    expect(h.entriesInPeriod).toBe(0);
    expect(h.entriesWithWarnings).toBe(0);
    expect(JSON.stringify(h)).not.toMatch(/NaN/);
  });

  test('counts how many times a rule was shown and what was recorded', () => {
    const es = [
      entry(1), entry(2), entry(3, { userAction: 'addedAfterAlternatives' }),
      entry(4, { userAction: 'cancelled' }), entry(5, { userAction: 'cancelled' }),
    ];
    const r = behaviourHistory(es, NOW, { days: 90 }).rules.find((x) => x.ruleId === 'processed-meat')!;
    expect(r).toMatchObject({ shown: 5, added: 2, addedAfterAlternatives: 1, cancelled: 2 });
  });

  test('cancelled entries are counted here even though they never reach nutrition totals', () => {
    const h = behaviourHistory([entry(1, { userAction: 'cancelled' })], NOW, { days: 30 });
    expect(h.rules[0]!.cancelled).toBe(1);
    expect(h.entriesInPeriod).toBe(1);
  });

  test('superseded and deleted entries are not counted, and a revision counts once', () => {
    const original = entry(1, { state: 'superseded', supersededBy: 'rev' });
    const revision = entry(1, { id: 'rev', revisionOf: original.id });
    const deleted = entry(2, { state: 'deleted' });
    const r = behaviourHistory([original, revision, deleted], NOW, { days: 30 }).rules[0]!;
    expect(r.shown).toBe(1);
  });

  test('a rule listed twice in one entry (a merged card) counts once for that entry', () => {
    const e = entry(1, { warningsShown: [{ ruleId: 'sodium-entry', level: 'MODERATE' }, { ruleId: 'sodium-entry', level: 'INFO' }] });
    expect(behaviourHistory([e], NOW, { days: 30 }).rules[0]!.shown).toBe(1);
  });

  test('the period excludes older entries; null days means all of the diary', () => {
    const es = [entry(5), entry(100)];
    expect(behaviourHistory(es, NOW, { days: 30 }).rules[0]!.shown).toBe(1);
    expect(behaviourHistory(es, NOW, { days: null }).rules[0]!.shown).toBe(2);
  });

  test('splits by calendar month, oldest first, so a change can be read', () => {
    const es = [entry(1), entry(2, { userAction: 'cancelled' }), entry(40), entry(41, { userAction: 'cancelled' }), entry(42, { userAction: 'cancelled' })];
    const months = behaviourHistory(es, NOW, { days: null }).rules[0]!.months;
    expect(months.map((m) => m.month)).toEqual(['2026-10', '2026-11']);
    expect(months[0]).toMatchObject({ shown: 3, cancelled: 2, added: 1 });
    expect(months[1]).toMatchObject({ shown: 2, cancelled: 1, added: 1 });
  });

  test('entries with no warning are in the total but create no rule row', () => {
    const h = behaviourHistory([entry(1, { warningsShown: [] }), entry(2)], NOW, { days: 30 });
    expect(h.entriesInPeriod).toBe(2);
    expect(h.entriesWithWarnings).toBe(1);
    expect(h.rules).toHaveLength(1);
  });

  test('rules are ordered by how often they were shown, then by id', () => {
    const es = [
      entry(1, { warningsShown: [{ ruleId: 'b-rule', level: 'INFO' }] }),
      entry(2, { warningsShown: [{ ruleId: 'a-rule', level: 'INFO' }] }),
      entry(3, { warningsShown: [{ ruleId: 'b-rule', level: 'INFO' }] }),
    ];
    expect(behaviourHistory(es, NOW, { days: 30 }).rules.map((r) => r.ruleId)).toEqual(['b-rule', 'a-rule']);
  });

  test('the earliest recorded day in the period is reported so the screen can say "since"', () => {
    const h = behaviourHistory([entry(3), entry(10)], NOW, { days: 30 });
    expect(h.sinceKey).toBe('2026-11-06');
  });
});
