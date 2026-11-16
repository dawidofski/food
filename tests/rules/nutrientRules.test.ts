import { describe, expect, test } from 'vitest';
import { evaluate } from '@/rules/engine';
import { citationProblems } from '@/rules/citations';
import { catalogue } from '@/rules/catalogue';
import { sodiumEntryRule, sodiumDailyRule } from '@/rules/catalogue/sodium';
import { addedSugarEntryRule, addedSugarDailyRule } from '@/rules/catalogue/addedSugar';
import { saturatedFatDailyRule } from '@/rules/catalogue/saturatedFat';
import { transFatRule } from '@/rules/catalogue/transFat';
import { ctx, probes } from './catalogueContexts';

// Thresholds here are the VERIFIED ones (spec "Verification log"), not the plan's starting figures: WHO publishes no
// single-serving limit, so the entry rules compare one entry with WHO's whole-day figure and say so.

describe('sodium', () => {
  test('entry rule compares ONE entry with the whole-day WHO figure, not an invented 600 mg', () => {
    expect(sodiumEntryRule.level(ctx({ pendingSodium: 2400 }))).toBe('MODERATE');
    expect(sodiumEntryRule.level(ctx({ pendingSodium: 1240 }))).toBeNull();
    expect(sodiumEntryRule.level(ctx({ pendingSodium: 400 }))).toBeNull();
  });
  test('daily rule compares today plus pending against 2000 mg', () => {
    expect(sodiumDailyRule.level(ctx({ todaySodium: 2000, pendingSodium: 1240 }))).toBe('MODERATE'); // no magnitude tier: frequency, not size, escalates a card
    expect(sodiumDailyRule.level(ctx({ todaySodium: 1800, pendingSodium: 400 }))).toBe('MODERATE');
    expect(sodiumDailyRule.level(ctx({ todaySodium: 9000, pendingSodium: 9000 }))).toBe('MODERATE');
    expect(sodiumDailyRule.level(ctx({ todaySodium: 300, pendingSodium: 200 }))).toBeNull();
    expect(sodiumDailyRule.level(ctx({ todaySodium: 1800, pendingSodium: 200 }))).toBeNull(); // exactly at the figure
  });
  test('daily rule does not extrapolate the rest of the day', () => {
    expect(sodiumDailyRule.level(ctx({ todaySodium: 0, pendingSodium: 900, hour: 8 }))).toBeNull();
  });
  test('daily rule on an empty day reads the pending entry alone', () => {
    expect(sodiumDailyRule.level(ctx({ emptyDay: true, pendingSodium: 2500 }))).toBe('MODERATE');
  });
  test('portion notes state the actual amount consumed', () => {
    expect(sodiumEntryRule.portionNote(ctx({ pendingSodium: 1240 }))).toMatch(/1,?240 mg/);
  });
});

describe('added sugar', () => {
  test('daily rule uses 10% of the energy target, with 5% as the conditional INFO tier', () => {
    expect(addedSugarDailyRule.level(ctx({ todayAddedSugar: 60, pendingAddedSugar: 20 }))).toBe('MODERATE');
    expect(addedSugarDailyRule.level(ctx({ todayAddedSugar: 30, pendingAddedSugar: 5 }))).toBe('INFO');
    expect(addedSugarDailyRule.level(ctx({ todayAddedSugar: 10, pendingAddedSugar: 5 }))).toBeNull();
  });
  test('entry rule has no 15 g trigger: it compares one entry with the whole-day figures', () => {
    expect(addedSugarEntryRule.level(ctx({ pendingAddedSugar: 16 }))).toBeNull();
    expect(addedSugarEntryRule.level(ctx({ pendingAddedSugar: 40 }))).toBe('INFO');
    expect(addedSugarEntryRule.level(ctx({ pendingAddedSugar: 70 }))).toBe('MODERATE');
  });
});

describe('saturated fat and trans fat', () => {
  test('saturated fat daily rule uses 10% of energy', () => {
    expect(saturatedFatDailyRule.level(ctx({ todaySatFat: 25, pendingSatFat: 10 }))).toBe('MODERATE');
    expect(saturatedFatDailyRule.level(ctx({ todaySatFat: 10, pendingSatFat: 10 }))).toBeNull();
  });
  test('trans fat fires MODERATE only when one entry alone exceeds the whole-day 1% of energy; no "any amount" rule', () => {
    expect(transFatRule.level(ctx({ pendingTransFat: 4 }))).toBe('MODERATE');
    expect(transFatRule.level(ctx({ pendingTransFat: 2 }))).toBeNull(); // dairy-level amounts stay silent
    expect(transFatRule.level(ctx({ pendingTransFat: 0 }))).toBeNull();
  });
});

describe('through the engine', () => {
  test('unknown nutrient: the rule stays silent rather than reading zero', () => {
    const c = ctx({ unknownPending: ['sodiumMg'], pendingSodium: 9999 });
    const out = evaluate([sodiumEntryRule, sodiumDailyRule], c);
    expect(out.cards).toEqual([]);
    expect(out.failures).toEqual([]);
  });
  test('daily rule is gated on today coverage', () => {
    const c = ctx({ todaySodium: 1900, pendingSodium: 500 });
    c.today.energyCoveredShare.sodiumMg = 0.3;
    c.today.coverage.sodiumMg = 'partial';
    expect(evaluate([sodiumDailyRule], c).cards).toEqual([]);
  });
  test('sodium entry and daily merge into one card and each claim keeps its own citation', () => {
    const out = evaluate(catalogue, ctx({ todaySodium: 1500, pendingSodium: 2400 }));
    const cards = out.cards.filter((c) => c.nutrientKey === 'sodiumMg');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.merged).toHaveLength(1);
    expect(out.failures).toEqual([]);
  });
});

describe('catalogue', () => {
  // These rules read classification flags or the week's counts and no nutrient, so the coverage gate cannot protect them
  // and they declare none on purpose. Any other rule must declare what it reads.
  const FLAG_ONLY = new Set(['processed-meat', 'processed-meat-frequency', 'red-meat-weekly', 'alcohol', 'sweet-drink', 'ultra-processed']);
  test('every nutrient rule declares its required nutrients and a nutrition category', () => {
    for (const r of catalogue) {
      if (!FLAG_ONLY.has(r.id)) expect(r.requiresNutrients.length).toBeGreaterThan(0);
      expect(r.category).toBe('nutrition');
    }
  });
  test('ids are unique', () => {
    expect(new Set(catalogue.map((r) => r.id)).size).toBe(catalogue.length);
  });
  test('scopes are as designed', () => {
    const scope = Object.fromEntries(catalogue.map((r) => [r.id, r.scope]));
    expect(scope).toEqual({
      'sodium-entry': 'entry', 'sodium-daily': 'daily', 'added-sugar-entry': 'entry',
      'added-sugar-daily': 'daily', 'saturated-fat-daily': 'daily', 'trans-fat': 'entry',
      // Weekly rules read the week and not one entry; 'daily' is the aggregate scope, so the usual-intake tone test applies.
      'processed-meat': 'entry', 'processed-meat-frequency': 'daily', 'red-meat-weekly': 'daily', alcohol: 'entry',
      'sweet-drink': 'entry', 'ultra-processed': 'entry', 'nutrient-density': 'entry',
    });
  });
  test.each(catalogue)('$id citation has no problems', (rule) => {
    expect(citationProblems(rule.evidence.citation)).toEqual([]);
  });
  test('every rule has a probe, and every probe fires at the level asserted', () => {
    for (const r of catalogue) {
      const ps = probes[r.id];
      expect(ps, `no probe for ${r.id}`).toBeDefined();
      for (const p of ps ?? []) expect(r.level(p.ctx)).toBe(p.level);
    }
  });
  test('probes run through the engine without tripping the CRITICAL or evidence-ceiling invariant', () => {
    for (const r of catalogue) {
      for (const p of probes[r.id] ?? []) {
        const out = evaluate([r], p.ctx); // throws in test on a nutrition CRITICAL or a capped level
        expect(out.failures).toEqual([]);
        expect(out.cards).toHaveLength(1);
        expect(out.cards[0]?.level).toBe(p.level);
      }
    }
  });
  test('no nutrition rule ever returns CRITICAL for extreme inputs', () => {
    const extreme = ctx({
      pendingSodium: 1e9, todaySodium: 1e9, pendingAddedSugar: 1e9, todayAddedSugar: 1e9,
      pendingSatFat: 1e9, todaySatFat: 1e9, pendingTransFat: 1e9,
    });
    for (const r of catalogue) expect(r.level(extreme)).not.toBe('CRITICAL');
  });
  test('portion notes are free of NaN, Infinity and undefined', () => {
    for (const r of catalogue) {
      for (const p of probes[r.id] ?? []) expect(r.portionNote(p.ctx)).not.toMatch(/NaN|Infinity|undefined/);
    }
  });
  test('rules with garbage targets stay silent instead of producing NaN', () => {
    const c = ctx({ pendingSodium: 5000, pendingAddedSugar: 500, pendingTransFat: 50, todaySatFat: 500, pendingSatFat: 50 });
    c.targets = { ...c.targets, sodiumMg: Number.NaN, addedSugarsG: Number.POSITIVE_INFINITY, addedSugarsIdealG: Number.NaN, satFatG: 0, transFatG: Number.NaN };
    for (const r of catalogue) expect(r.level(c)).toBeNull();
  });
});
