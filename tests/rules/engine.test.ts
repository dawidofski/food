import { afterEach, describe, expect, test, vi } from 'vitest';
import { evaluate } from '@/rules/engine';
import type { Context, Level, Rule } from '@/rules/types';
import { ownerProfile } from '../fixtures/profile';
import type { DayTotals } from '@/domain/totals';
import { NUTRIENT_KEYS, type Coverage, type NutrientKey, type NutrientSet } from '@/types/nutrients';

// ---------- context builder ----------

type Opts = {
  sodiumHeavy?: boolean;
  addedSugarUnknown?: boolean;
  addedSugarCoveredShare?: number;
  /** Day-level coverage label for added sugar; defaults to 'partial' when the share is below 1. */
  addedSugarDayCoverage?: 'known' | 'partial' | 'unknown';
  emptyDay?: boolean;
  /** Entries exist today but none carries any nutrient data. */
  dayAllUnknown?: boolean;
  food?: string;
  answers?: Record<string, boolean>;
};

const flags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1 as const,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};

function ctx(o: Opts = {}): Context {
  const pendingN: NutrientSet = { energyKcal: 300, sodiumMg: o.sodiumHeavy ? 900 : 100, addedSugarsG: 2 };
  const pendingC: Coverage = { energyKcal: 'known', sodiumMg: 'known', addedSugarsG: 'known' };
  if (o.addedSugarUnknown) {
    delete pendingN.addedSugarsG;
    pendingC.addedSugarsG = 'unknown';
  }
  const todayN: NutrientSet = o.emptyDay || o.dayAllUnknown ? {} : { energyKcal: 1000, sodiumMg: o.sodiumHeavy ? 1500 : 200, addedSugarsG: 10 };
  const share = {} as Record<NutrientKey, number>;
  const todayC: Coverage = {};
  for (const k of NUTRIENT_KEYS) {
    share[k] = o.emptyDay || o.dayAllUnknown ? 0 : 1;
    todayC[k] = o.emptyDay || o.dayAllUnknown ? 'unknown' : 'known';
  }
  if (o.addedSugarCoveredShare !== undefined) {
    todayN.addedSugarsG = 60; // enough that a daily added-sugar rule would fire
    share.addedSugarsG = o.addedSugarCoveredShare;
    todayC.addedSugarsG = o.addedSugarCoveredShare < 1 ? 'partial' : 'known';
  }
  if (o.addedSugarDayCoverage) todayC.addedSugarsG = o.addedSugarDayCoverage;
  const today: DayTotals = {
    dayKey: '2026-11-15', entryCount: o.emptyDay ? 0 : 2, nutrients: todayN, coverage: todayC, energyCoveredShare: share,
    vegCupEq: 0, vegCoverage: 'known', hasVegetableFlag: false, nova4EntryCount: 0,
  };
  const food = o.food ?? 'plain';
  return {
    foods: [],
    pending: {
      refs: [{ source: 'dataset', foodId: food, grams: 100, classification: flags }],
      nutrients: pendingN, coverage: pendingC, classification: flags, needsHelp: [], confidence: 1,
    },
    today,
    week: {
      days: [today], processedMeatOccasions: 0, redMeatGrams: 0, alcoholOccasions: 0,
      vegCupEqByDay: [0], daysWithoutVegetable: 0, daysVegetableUnknown: 0,
      loggedDays: 6, sweetDrinkOccasions: 0, ultraProcessedOccasions: 0,
      completeDayTotalsBeforeToday: { sodiumMg: [], addedSugarsG: [], satFatG: [] },
    },
    targets: {
      energyKcal: 2500,
      maintenanceKcal: 2500, rmrKcal: 1900, proteinG: 100, proteinFloorG: 80, fibreG: 30, sodiumMg: 2000, satFatG: 28,
      addedSugarsG: 50, addedSugarsIdealG: 25, transFatG: 2, micronutrients: {}, isGeneric: false,
      basis: { protein: 'issn-range', energy: 'mifflin', expenditure: 'formula' },
    },
    profile: ownerProfile,
    now: new Date('2026-11-15T12:00:00'),
    answers: o.answers ?? {},
  };
}

// ---------- local stub rules (the real catalogue does not exist yet) ----------

function stub(id: string, level: (c: Context) => Level | null, over: Partial<Rule> = {}): Rule {
  return {
    id,
    title: id,
    category: 'nutrition',
    level,
    concern: `concern ${id}`,
    cause: `cause ${id}`,
    evidence: {
      strength: 'moderate',
      body: 'TEST',
      summary: 'summary',
      citation: { title: 't', publisher: 'p', year: 2020, url: 'https://example.org', conclusion: 'c' },
      isAssociational: false,
    },
    horizon: 'both',
    portionNote: () => `portion ${id}`,
    requiresNutrients: [],
    scope: 'entry',
    ...over,
  };
}

const silentRule = stub('silent', () => null);
const infoRule = stub('info', () => 'INFO');
const moderateRule = stub('moderate', () => 'MODERATE');
const highRule = stub('high', () => 'HIGH');
const criticalRule = stub('critical', () => 'CRITICAL', { category: 'safety' });
const fiveFiringRules = [
  stub('a', () => 'INFO'), stub('b', () => 'MODERATE'), stub('c', () => 'HIGH'),
  stub('d', () => 'INFO'), stub('e', () => 'MODERATE'),
];

const sodiumEntryRule = stub('sodium-entry', (c) => ((c.pending.nutrients.sodiumMg ?? 0) > 600 ? 'MODERATE' : null), {
  requiresNutrients: ['sodiumMg'], nutrientKey: 'sodiumMg', scope: 'entry',
  portionNote: () => 'This entry is salty.',
});
const sodiumDailyRule = stub(
  'sodium-daily',
  (c) => ((c.today.nutrients.sodiumMg ?? 0) + (c.pending.nutrients.sodiumMg ?? 0) > 2000 ? 'HIGH' : null),
  { requiresNutrients: ['sodiumMg'], nutrientKey: 'sodiumMg', scope: 'daily', portionNote: () => 'The day is salty.' },
);
const addedSugarRule = stub('added-sugar', (c) => ((c.pending.nutrients.addedSugarsG ?? 0) > 15 ? 'MODERATE' : 'INFO'), {
  requiresNutrients: ['addedSugarsG'], nutrientKey: 'addedSugarsG', scope: 'entry',
});
const addedSugarDailyRule = stub(
  'added-sugar-daily',
  (c) => ((c.today.nutrients.addedSugarsG ?? 0) + (c.pending.nutrients.addedSugarsG ?? 0) > 50 ? 'MODERATE' : null),
  { requiresNutrients: ['addedSugarsG'], nutrientKey: 'addedSugarsG', scope: 'daily' },
);
const nutritionRuleClaimingCritical = stub('fat-critical', () => 'CRITICAL', { category: 'nutrition' });
const reheatedRiceRule = stub('reheated-rice', (c) => (c.answers.reheatedRice ? 'CRITICAL' : null), {
  category: 'safety',
  safetyPrompt: {
    answerKey: 'reheatedRice',
    applies: (c) => c.pending.refs.some((r) => r.foodId === 'rice'),
    question: 'Was this rice kept warm rather than chilled?',
  },
});

// ---------- the brief's ten tests ----------

describe('evaluate (brief)', () => {
  test('a rule returning null produces no card — the normal case', () => {
    expect(evaluate([silentRule], ctx()).cards).toEqual([]);
  });

  test('cards are ordered by level, highest first', () => {
    const { cards } = evaluate([infoRule, criticalRule, moderateRule], ctx());
    expect(cards.map(c => c.level)).toEqual(['CRITICAL', 'MODERATE', 'INFO']);
  });

  test('at most three cards are shown', () => {
    expect(evaluate(fiveFiringRules, ctx()).cards).toHaveLength(3);
  });

  test('rules on the same nutrient merge into one card', () => {
    const { cards } = evaluate([sodiumEntryRule, sodiumDailyRule], ctx({ sodiumHeavy: true }));
    expect(cards.filter(c => c.nutrientKey === 'sodiumMg')).toHaveLength(1);
  });

  test('a rule stays silent when a required nutrient is unknown', () => {
    const { cards } = evaluate([addedSugarRule], ctx({ addedSugarUnknown: true }));
    expect(cards).toEqual([]);
  });

  test('a daily-aggregate rule stays silent below its coverage floor and says why', () => {
    const { cards } = evaluate([addedSugarDailyRule], ctx({ addedSugarCoveredShare: 0.5 }));
    expect(cards).toEqual([]);
  });

  test('a card below minCoverage but above the silence floor carries a data note', () => {
    const { cards } = evaluate([addedSugarDailyRule], ctx({ addedSugarCoveredShare: 0.85 }));
    expect(cards[0]!.dataNote).toMatch(/no added-sugar data/i);
  });

  test('no nutrition rule may declare CRITICAL', () => {
    expect(() => evaluate([nutritionRuleClaimingCritical], ctx())).toThrow(/safety/i);
  });

  test('a safety rule with an unanswered question yields a question, not a card', () => {
    const { cards, questions } = evaluate([reheatedRiceRule], ctx({ food: 'rice' }));
    expect(cards).toEqual([]);
    expect(questions[0]!.question).toMatch(/kept warm/i);
  });

  test('the same safety rule fires CRITICAL once the question is answered yes', () => {
    const { cards } = evaluate([reheatedRiceRule], ctx({ food: 'rice', answers: { reheatedRice: true } }));
    expect(cards[0]!.level).toBe('CRITICAL');
  });
});

// ---------- beyond the brief ----------

describe('evaluate (additional invariants)', () => {
  test('partial day coverage with a full energy share still fires only with a data note (both signals consulted)', () => {
    const c = ctx({ addedSugarCoveredShare: 1, addedSugarDayCoverage: 'partial' });
    const { cards } = evaluate([addedSugarDailyRule], c);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.dataNote).toMatch(/no added-sugar data/i);
  });

  test('unknown day coverage stays silent even when the energy share reads 1', () => {
    const c = ctx({ addedSugarCoveredShare: 1, addedSugarDayCoverage: 'unknown' });
    expect(evaluate([addedSugarDailyRule], c).cards).toEqual([]);
  });

  test('a fully known day fires with no data note', () => {
    const { cards } = evaluate([addedSugarDailyRule], ctx({ addedSugarCoveredShare: 1 }));
    expect(cards).toHaveLength(1);
    expect(cards[0]!.dataNote).toBeUndefined();
  });

  test('a custom minCoverage is honoured', () => {
    const strict = { ...addedSugarDailyRule, minCoverage: 0.95 };
    expect(evaluate([strict], ctx({ addedSugarCoveredShare: 0.85 })).cards).toEqual([]);
  });

  test('an empty day has nothing to understate, so a daily rule is not silenced by it', () => {
    const rule = stub('daily-empty', () => 'INFO', { requiresNutrients: ['sodiumMg'], scope: 'daily' });
    expect(evaluate([rule], ctx({ emptyDay: true })).cards).toHaveLength(1);
  });

  test('scope is a required field: a rule that omits it does not compile', () => {
    const { scope: _s, ...rest } = addedSugarDailyRule;
    // @ts-expect-error scope must be stated by the rule author
    const incomplete: Rule = rest;
    expect(incomplete.id).toBe('added-sugar-daily');
  });

  test('a known pending nutrient with unknown coverage stays silent', () => {
    const c = ctx();
    c.pending.coverage.sodiumMg = 'unknown';
    expect(evaluate([sodiumEntryRule], c).cards).toEqual([]);
  });

  test('a non-finite pending value is unknown, not a number', () => {
    const c = ctx({ sodiumHeavy: true });
    c.pending.nutrients.sodiumMg = Number.NaN;
    expect(evaluate([sodiumEntryRule], c).cards).toEqual([]);
  });

  test('two rules on different nutrients both fire as two cards', () => {
    const { cards } = evaluate([sodiumEntryRule, addedSugarRule], ctx({ sodiumHeavy: true }));
    expect(cards.map((x) => x.nutrientKey).sort()).toEqual(['addedSugarsG', 'sodiumMg']);
  });

  test('a merged card keeps its own prose and carries each absorbed claim under its own citation', () => {
    const entry = stub('sodium-entry', () => 'MODERATE', {
      requiresNutrients: ['sodiumMg'], nutrientKey: 'sodiumMg', scope: 'entry', portionNote: () => 'This entry is salty.',
      concern: 'entry concern',
      evidence: { ...sodiumEntryRule.evidence, body: 'EFSA', citation: { ...sodiumEntryRule.evidence.citation, title: 'ENTRY SOURCE' } },
    });
    const daily = stub('sodium-daily', () => 'HIGH', {
      requiresNutrients: ['sodiumMg'], nutrientKey: 'sodiumMg', scope: 'entry', portionNote: () => 'The day is salty.',
      evidence: { ...sodiumEntryRule.evidence, body: 'WHO', citation: { ...sodiumEntryRule.evidence.citation, title: 'DAILY SOURCE' } },
    });
    const { cards } = evaluate([entry, daily], ctx({ sodiumHeavy: true }));
    const c = cards[0]!;
    expect(c.level).toBe('HIGH');
    expect(c.ruleId).toBe('sodium-daily');
    expect(c.mergedFrom).toEqual(['sodium-entry']);
    expect(c.portionNote).toBe('The day is salty.');
    expect(c.portionNote).not.toContain('This entry is salty.');
    expect(c.evidence.citation.title).toBe('DAILY SOURCE');
    expect(c.merged).toEqual([
      { ruleId: 'sodium-entry', level: 'MODERATE', concern: 'entry concern', portionNote: 'This entry is salty.', evidence: entry.evidence, citation: entry.evidence.citation },
    ]);
    expect(c.merged[0]!.citation.title).toBe('ENTRY SOURCE');
  });

  test('three rules on one nutrient flatten into one card with two absorbed claims', () => {
    const mk = (id: string, l: Level) => stub(id, () => l, { requiresNutrients: ['sodiumMg'], nutrientKey: 'sodiumMg', scope: 'entry' });
    const { cards } = evaluate([mk('x', 'INFO'), mk('y', 'HIGH'), mk('z', 'MODERATE')], ctx());
    expect(cards).toHaveLength(1);
    expect(cards[0]!.ruleId).toBe('y');
    expect(cards[0]!.merged.map((m) => m.ruleId).sort()).toEqual(['x', 'z']);
  });

  test('a card does not alias the catalogue: mutating it leaves the rule untouched', () => {
    const cite = { title: 'at', publisher: 'p', year: 2020, url: 'https://example.org', conclusion: 'a replacement conclusion' };
    const rule = stub('alias', () => 'INFO', { alternatives: [{ label: 'a', reason: 'r', citation: cite }] });
    const card = evaluate([rule], ctx()).cards[0]!;
    card.evidence.summary = 'changed';
    card.evidence.citation.title = 'changed';
    card.alternatives[0]!.label = 'changed';
    card.alternatives[0]!.citation.title = 'changed';
    card.alternatives.push({ label: 'x', reason: 'y', citation: cite });
    expect(rule.evidence.summary).toBe('summary');
    expect(rule.evidence.citation.title).toBe('t');
    expect(rule.alternatives).toEqual([{ label: 'a', reason: 'r', citation: cite }]);
    expect(cite.title).toBe('at');
  });

  test('a day with entries but no nutrient data is not an empty day: a daily rule stays silent', () => {
    const rule = stub('fibre-low', () => 'INFO', { requiresNutrients: ['sodiumMg'], scope: 'daily' });
    const c = ctx({ dayAllUnknown: true });
    expect(c.today.entryCount).toBeGreaterThan(0);
    expect(c.today.nutrients).toEqual({});
    expect(evaluate([rule], c).cards).toEqual([]);
  });

  test('a CRITICAL card survives the three-card cap even when declared last', () => {
    const { cards } = evaluate([infoRule, moderateRule, highRule, criticalRule], ctx());
    expect(cards).toHaveLength(3);
    expect(cards.map((x) => x.level)).toEqual(['CRITICAL', 'HIGH', 'MODERATE']);
  });

  test('equal levels keep declaration order', () => {
    const { cards } = evaluate([stub('first', () => 'INFO'), stub('second', () => 'INFO')], ctx());
    expect(cards.map((x) => x.ruleId)).toEqual(['first', 'second']);
  });

  test('a safety question answered no yields neither card nor question on the second pass', () => {
    const first = evaluate([reheatedRiceRule], ctx({ food: 'rice' }));
    expect(first.questions).toHaveLength(1);
    const second = evaluate([reheatedRiceRule], ctx({ food: 'rice', answers: { reheatedRice: false } }));
    expect(second).toEqual({ cards: [], questions: [], failures: [] });
  });

  test('a question that does not apply to the food is not asked', () => {
    expect(evaluate([reheatedRiceRule], ctx({ food: 'bread' }))).toEqual({ cards: [], questions: [], failures: [] });
  });

  test('pending questions suppress every card, including unrelated ones', () => {
    const r = evaluate([reheatedRiceRule, highRule], ctx({ food: 'rice' }));
    expect(r.cards).toEqual([]);
    expect(r.questions.map((q) => q.answerKey)).toEqual(['reheatedRice']);
  });

  test('a safety rule that ignores its own answer is still held back when answered no', () => {
    const sloppy = { ...reheatedRiceRule, level: () => 'CRITICAL' as const };
    expect(evaluate([sloppy], ctx({ food: 'rice', answers: { reheatedRice: false } })).cards).toEqual([]);
  });

  test('the card carries evidence.isAssociational through', () => {
    const base = stub('assoc', () => 'INFO');
    const rule = { ...base, evidence: { ...base.evidence, isAssociational: true } };
    expect(evaluate([rule], ctx()).cards[0]!.evidence.isAssociational).toBe(true);
  });

  test('alternatives are omitted from the card as an empty list when the rule has none', () => {
    expect(evaluate([infoRule], ctx()).cards[0]!.alternatives).toEqual([]);
  });

  test('an empty rules array yields nothing', () => {
    expect(evaluate([], ctx())).toEqual({ cards: [], questions: [], failures: [] });
  });

  test('a throwing nutrition rule and a throwing safety rule are reported in failures; other rules still fire', () => {
    const badN = stub('bad-nutrition', () => {
      throw new Error('boom');
    });
    const badS = stub(
      'bad-safety',
      () => {
        throw new Error('bang');
      },
      { category: 'safety' },
    );
    const r = evaluate([badN, infoRule, badS, highRule], ctx());
    expect(r.cards.map((x) => x.ruleId)).toEqual(['high', 'info']);
    expect(r.failures).toEqual([
      { ruleId: 'bad-nutrition', category: 'nutrition', message: 'rule "bad-nutrition" threw while evaluating: boom' },
      { ruleId: 'bad-safety', category: 'safety', message: 'rule "bad-safety" threw while evaluating: bang' },
    ]);
  });

  test('a rule whose portionNote or safety prompt throws is a failure, not a crash', () => {
    const badNote = stub('bad-note', () => 'INFO', { portionNote: () => { throw new Error('note'); } });
    const badPrompt = stub('bad-prompt', () => 'INFO', {
      category: 'safety',
      safetyPrompt: { answerKey: 'k', applies: () => { throw new Error('applies'); }, question: 'q?' },
    });
    const r = evaluate([badNote, badPrompt, moderateRule], ctx());
    expect(r.cards.map((x) => x.ruleId)).toEqual(['moderate']);
    expect(r.failures.map((f) => f.ruleId)).toEqual(['bad-prompt', 'bad-note']);
  });

  test('failures is empty when every rule evaluates', () => {
    expect(evaluate([infoRule], ctx()).failures).toEqual([]);
  });

  test('the development/test signal is on under vitest', () => {
    expect(import.meta.env.DEV).toBe(true);
  });

  describe('evidence strength caps the level', () => {
    const weak = (strength: 'uncertain' | 'limited', level: Level) =>
      stub(`weak-${strength}-${level}`, () => level, { evidence: { ...infoRule.evidence, strength } });

    test.each(['uncertain', 'limited'] as const)('%s evidence may reach MODERATE', (s) => {
      expect(evaluate([weak(s, 'MODERATE')], ctx()).cards).toHaveLength(1);
      expect(evaluate([weak(s, 'INFO')], ctx()).cards).toHaveLength(1);
    });

    test.each(['uncertain', 'limited'] as const)('%s evidence returning HIGH throws under test', (s) => {
      expect(() => evaluate([weak(s, 'HIGH')], ctx())).toThrow(/evidence/i);
    });

    test('a safety rule with limited evidence may still return CRITICAL: its severity is the hazard, not study strength', () => {
      const r = stub('weak-safety', () => 'CRITICAL', { category: 'safety', evidence: { ...infoRule.evidence, strength: 'limited' } });
      expect(evaluate([r], ctx()).cards[0]!.level).toBe('CRITICAL');
    });

    test('a nutrition rule with limited evidence is still capped at MODERATE', () => {
      expect(() => evaluate([weak('limited', 'HIGH')], ctx())).toThrow(/capped at MODERATE/);
      expect(evaluate([weak('limited', 'MODERATE')], ctx()).cards[0]!.level).toBe('MODERATE');
    });

    test('strong and moderate evidence may reach HIGH', () => {
      expect(evaluate([stub('s', () => 'HIGH', { evidence: { ...infoRule.evidence, strength: 'strong' } })], ctx()).cards).toHaveLength(1);
      expect(evaluate([highRule], ctx()).cards).toHaveLength(1);
    });

    test('in production an overclaiming rule is reported in failures and skipped', () => {
      vi.stubEnv('DEV', false);
      try {
        const r = evaluate([weak('uncertain', 'HIGH'), moderateRule], ctx());
        expect(r.cards.map((c) => c.ruleId)).toEqual(['moderate']);
        expect(r.failures).toHaveLength(1);
        expect(r.failures[0]).toMatchObject({ ruleId: 'weak-uncertain-HIGH', category: 'nutrition' });
        expect(r.failures[0]!.message).toMatch(/evidence/i);
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  describe('in a production build', () => {
    afterEach(() => vi.unstubAllEnvs());

    test('a nutrition rule claiming CRITICAL is reported in failures and skipped; other rules still fire', () => {
      vi.stubEnv('DEV', false);
      expect(import.meta.env.DEV).toBe(false);
      const r = evaluate([nutritionRuleClaimingCritical, highRule, criticalRule], ctx());
      expect(r.cards.map((c) => c.ruleId)).toEqual(['critical', 'high']);
      expect(r.failures).toHaveLength(1);
      expect(r.failures[0]).toMatchObject({ ruleId: 'fat-critical', category: 'nutrition' });
      expect(r.failures[0]!.message).toMatch(/safety/i);
    });
  });

  test('a nutrition rule claiming CRITICAL does not throw while its inputs are unknown (silent first)', () => {
    const r = { ...nutritionRuleClaimingCritical, requiresNutrients: ['addedSugarsG' as const] };
    expect(evaluate([r], ctx({ addedSugarUnknown: true })).cards).toEqual([]);
  });

  test('does not mutate its rules or context', () => {
    const c = ctx({ sodiumHeavy: true });
    const before = JSON.stringify(c);
    evaluate([sodiumEntryRule, sodiumDailyRule], c);
    expect(JSON.stringify(c)).toBe(before);
  });
});

describe('merging keeps the absorbed alternatives', () => {
  const alt = (label: string) => ({ label, reason: 'a reason long enough', citation: { title: 't', publisher: 'p', year: 2020, url: 'https://example.org', conclusion: 'replace it with something else' } });
  test('both alternatives survive, de-duplicated by label', () => {
    const a = stub('a', () => 'MODERATE', { nutrientKey: 'sodiumMg', alternatives: [alt('one'), alt('shared')] });
    const b = stub('b', () => 'INFO', { nutrientKey: 'sodiumMg', alternatives: [alt('shared'), alt('two')] });
    const { cards } = evaluate([a, b], ctx());
    expect(cards).toHaveLength(1);
    expect(cards[0]!.alternatives.map((x) => x.label)).toEqual(['one', 'shared', 'two']);
  });
});

describe('the pattern note is carried, never evaluated into a level', () => {
  test('a firing rule carries its note; a rule whose note is null carries no field at all', () => {
    const withNote = stub('with', () => 'MODERATE', { patternNote: () => 'Counted 4 of 6 days.' });
    const withoutNote = stub('without', () => 'MODERATE', { patternNote: () => null, nutrientKey: 'fibreG' });
    const { cards } = evaluate([withNote, withoutNote], ctx());
    expect(cards[0]!.patternNote).toBe('Counted 4 of 6 days.');
    expect('patternNote' in cards[1]!).toBe(false);
  });

  test('a silent rule\'s note is never evaluated: it cannot create a card', () => {
    let called = 0;
    const silent = stub('quiet', () => null, { patternNote: () => { called++; return 'Counted something.'; } });
    const { cards } = evaluate([silent], ctx());
    expect(cards).toHaveLength(0);
    expect(called).toBe(0);
  });

  test('the note does not move a level, whatever it says', () => {
    const plain = stub('p', () => 'INFO');
    const noisy = stub('p', () => 'INFO', { patternNote: () => 'Counted 6 of 6 days above the figure.' });
    expect(evaluate([noisy], ctx()).cards[0]!.level).toBe(evaluate([plain], ctx()).cards[0]!.level);
  });

  test('a note that throws is reported and omitted; the card that fired still shows', () => {
    const bad = stub('bad', () => 'HIGH', { patternNote: () => { throw new Error('bad count'); } });
    const { cards, failures } = evaluate([bad], ctx());
    expect(cards).toHaveLength(1);
    expect('patternNote' in cards[0]!).toBe(false);
    expect(failures.map((f) => f.message).join(' ')).toMatch(/bad count/);
  });

  test('a merged card keeps the surviving rule\'s own note, and no claim appears under another rule\'s note', () => {
    const hi = stub('hi', () => 'HIGH', { nutrientKey: 'sodiumMg', patternNote: () => 'The high card counted the days.' });
    const lo = stub('lo', () => 'MODERATE', { nutrientKey: 'sodiumMg', patternNote: () => 'The low card counted the days.' });
    const { cards } = evaluate([lo, hi], ctx());
    expect(cards).toHaveLength(1);
    expect(cards[0]!.ruleId).toBe('hi');
    expect(cards[0]!.patternNote).toBe('The high card counted the days.');
    expect(JSON.stringify(cards[0]!.merged)).not.toContain('counted the days');
  });

  test('the note is a different field from the "may be understated" data note', () => {
    const r = stub('both', () => 'MODERATE', {
      requiresNutrients: ['addedSugarsG'], scope: 'daily', patternNote: () => 'Counted 5 of 6 days.',
    });
    const { cards } = evaluate([r], ctx({ addedSugarCoveredShare: 0.9 }));
    expect(cards[0]!.patternNote).toBe('Counted 5 of 6 days.');
    expect(cards[0]!.dataNote).toMatch(/understated/);
  });
});
