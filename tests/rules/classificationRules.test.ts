import { describe, expect, test } from 'vitest';
import { evaluate } from '@/rules/engine';
import { catalogue } from '@/rules/catalogue';
import { citationProblems } from '@/rules/citations';
import type { Rule } from '@/rules/types';
import { processedMeatRule, processedMeatFrequencyRule } from '@/rules/catalogue/processedMeat';
import { redMeatWeeklyRule } from '@/rules/catalogue/redMeat';
import { alcoholRule } from '@/rules/catalogue/alcohol';
import { sweetDrinkRule } from '@/rules/catalogue/sweetDrink';
import { ultraProcessedRule } from '@/rules/catalogue/ultraProcessed';
import { nutrientDensityRule } from '@/rules/catalogue/nutrientDensity';
import { ctx, probes } from './catalogueContexts';

// Thresholds are the VERIFIED ones (spec "Verification log", Task 12), not the plan's starting figures.

const prose = (r: Rule) =>
  [r.title, r.concern, r.cause, r.evidence.summary, r.evidence.citation.conclusion,
    ...(probes[r.id] ?? []).map((p) => r.portionNote(p.ctx))].join('\n');
const pm = { processedMeat: true };

describe('processed meat', () => {
  test('fires HIGH on any processed meat entry, and stays silent without the flag', () => {
    expect(processedMeatRule.level(ctx({ classification: pm }))).toBe('HIGH');
    expect(processedMeatRule.level(ctx())).toBeNull();
  });
  test('cites IARC Group 1, declares strong evidence, and states the risk as relative', () => {
    expect(processedMeatRule.evidence.citation.publisher).toMatch(/IARC|International Agency/);
    expect(processedMeatRule.evidence.citation.conclusion).toMatch(/Group 1/);
    expect(processedMeatRule.evidence.strength).toBe('strong');
    expect(prose(processedMeatRule)).toMatch(/18%/);
    expect(prose(processedMeatRule)).toMatch(/relative risk/i);
  });
  test('says the classification is about strength of evidence and the 18% is for daily intake over time', () => {
    expect(processedMeatRule.concern).toMatch(/not how large the risk/i);
    expect(processedMeatRule.concern).toMatch(/daily/i);
  });
  test('portion note compares the processed-meat grams with the 50 g reference', () => {
    expect(processedMeatRule.portionNote(ctx({ classification: pm, pendingGrams: 114 }))).toMatch(/114 g[^.]*50 g/);
  });
  test('portion note counts only the processed-meat item of a mixed entry', () => {
    const c = ctx({ classification: pm, refs: [{ grams: 60, flags: pm }, { grams: 200 }] });
    expect(processedMeatRule.portionNote(c)).toMatch(/60 g/);
    expect(processedMeatRule.portionNote(c)).not.toMatch(/260 g/);
  });
  test('has no alternatives: no source supports a specific swap', () => {
    expect(processedMeatRule.alternatives).toBeUndefined();
  });
});

describe('processed meat frequency', () => {
  test('fires INFO when this entry is the third occasion in seven days, not before', () => {
    expect(processedMeatFrequencyRule.level(ctx({ classification: pm, weekProcessedMeatOccasions: 2 }))).toBe('INFO');
    expect(processedMeatFrequencyRule.level(ctx({ classification: pm, weekProcessedMeatOccasions: 1 }))).toBeNull();
  });
  test('silent when the pending entry has no processed meat, however often it was logged', () => {
    expect(processedMeatFrequencyRule.level(ctx({ weekProcessedMeatOccasions: 6 }))).toBeNull();
  });
  test("says the three-occasion point is the app's own choice and not a published limit", () => {
    expect(processedMeatFrequencyRule.concern).toMatch(/not a published (limit|figure)/i);
  });
  test('portion note states the count including this entry', () => {
    expect(processedMeatFrequencyRule.portionNote(ctx({ classification: pm, weekProcessedMeatOccasions: 2 }))).toMatch(/3 /);
  });
});

describe('red meat weekly', () => {
  test('fires above 500 g in seven days including the pending red meat, not at or below', () => {
    expect(redMeatWeeklyRule.level(ctx({ classification: { redMeat: true }, pendingGrams: 120, weekRedMeatGrams: 500 }))).toBe('MODERATE');
    expect(redMeatWeeklyRule.level(ctx({ classification: { redMeat: true }, pendingGrams: 100, weekRedMeatGrams: 400 }))).toBeNull();
  });
  test('counts only the red-meat items of a mixed pending entry', () => {
    const c = ctx({ classification: { redMeat: true }, refs: [{ grams: 80, flags: { redMeat: true } }, { grams: 400 }], weekRedMeatGrams: 430 });
    expect(redMeatWeeklyRule.level(c)).toBe('MODERATE'); // 430 + 80 = 510
    expect(redMeatWeeklyRule.level({ ...c, week: { ...c.week, redMeatGrams: 400 } })).toBeNull(); // 480
  });
  test('silent when the pending entry has no red meat', () => {
    expect(redMeatWeeklyRule.level(ctx({ weekRedMeatGrams: 2000 }))).toBeNull();
  });
  test('declares limited evidence and cites WCRF', () => {
    expect(redMeatWeeklyRule.evidence.strength).toBe('limited');
    expect(redMeatWeeklyRule.evidence.citation.publisher).toMatch(/World Cancer Research Fund/);
    expect(redMeatWeeklyRule.evidence.citation.conclusion).toMatch(/350.500/);
  });
  test('says the diary weight may not be cooked weight', () => {
    expect(redMeatWeeklyRule.concern).toMatch(/cooked/i);
    expect(redMeatWeeklyRule.concern).toMatch(/raw/i);
  });
});

describe('alcohol', () => {
  test('fires on any alcohol entry and does not escalate on a count of entries', () => {
    expect(alcoholRule.level(ctx({ classification: { alcohol: true } }))).toBe('MODERATE');
    expect(alcoholRule.level(ctx({ classification: { alcohol: true }, weekAlcoholOccasions: 30 }))).toBe('MODERATE');
    expect(alcoholRule.level(ctx())).toBeNull();
  });
  test('says no threshold exists and that entries are not drinks', () => {
    expect(alcoholRule.concern).toMatch(/threshold/i);
    expect(alcoholRule.portionNote(ctx({ classification: { alcohol: true }, weekAlcoholOccasions: 3 }))).toMatch(/entries, not drinks/i);
  });
  test('the portion note implies no amount drunk', () => {
    const n = alcoholRule.portionNote(ctx({ classification: { alcohol: true }, weekAlcoholOccasions: 3 }));
    expect(n).not.toMatch(/\bunits?\b|\bglass|\bpint|\bml\b/i);
    expect(n).toMatch(/4 /); // 3 earlier entries plus this one
  });
});

describe('sweet drink', () => {
  test('fires INFO on a sweet-drink entry and is silent otherwise', () => {
    expect(sweetDrinkRule.level(ctx({ classification: { sweetDrink: true } }))).toBe('INFO');
    expect(sweetDrinkRule.level(ctx())).toBeNull();
  });
  test('declares limited evidence, because WHO rates the drink-specific cohort evidence low', () => {
    expect(sweetDrinkRule.evidence.strength).toBe('limited');
    expect(sweetDrinkRule.evidence.isAssociational).toBe(true);
    expect(sweetDrinkRule.concern).toMatch(/low quality/i);
  });
});

describe('ultra-processed', () => {
  test('declares limited, associational evidence and says so on the card', () => {
    expect(ultraProcessedRule.evidence.strength).toBe('limited');
    expect(ultraProcessedRule.evidence.isAssociational).toBe(true);
    expect(prose(ultraProcessedRule)).toMatch(/observational/i);
    expect(prose(ultraProcessedRule)).toMatch(/no threshold is established/i);
  });
  test('is qualitative: fires INFO on NOVA 4 and is silent on NOVA 1 to 3 (no flattening of processed food)', () => {
    expect(ultraProcessedRule.level(ctx({ classification: { novaGroup: 4 } }))).toBe('INFO');
    expect(ultraProcessedRule.level(ctx({ classification: { novaGroup: 3 } }))).toBeNull();
    expect(ultraProcessedRule.level(ctx({ classification: { novaGroup: 2 } }))).toBeNull();
    expect(ultraProcessedRule.level(ctx())).toBeNull();
  });
  test('states the category is broad and it is unclear whether processing or nutrients explain the link', () => {
    expect(ultraProcessedRule.concern).toMatch(/broad/i);
    expect(ultraProcessedRule.concern).toMatch(/unclear whether/i);
  });
  test('stays at INFO through the engine (evidence ceiling)', () => {
    const out = evaluate([ultraProcessedRule], ctx({ classification: { novaGroup: 4 } }));
    expect(out.cards.map((c) => c.level)).toEqual(['INFO']);
  });
});

describe('nutrient density', () => {
  test('fires INFO when an entry supplies a large share of energy but less of the fibre and protein targets', () => {
    expect(nutrientDensityRule.level(ctx({ pendingEnergy: 600, pendingFibre: 0.5, pendingProtein: 2 }))).toBe('INFO');
  });
  test('silent when fibre or protein keeps pace with energy', () => {
    expect(nutrientDensityRule.level(ctx({ pendingEnergy: 600, pendingFibre: 8, pendingProtein: 2 }))).toBeNull();
    expect(nutrientDensityRule.level(ctx({ pendingEnergy: 600, pendingFibre: 0.5, pendingProtein: 40 }))).toBeNull();
  });
  test('silent on a small entry, whatever its makeup', () => {
    expect(nutrientDensityRule.level(ctx({ pendingEnergy: 40, pendingFibre: 0, pendingProtein: 0 }))).toBeNull();
  });
  test('unknown fibre or protein is silence, never zero', () => {
    expect(nutrientDensityRule.level(ctx({ pendingEnergy: 600, pendingProtein: 2 }))).toBeNull();
    const out = evaluate([nutrientDensityRule], ctx({ pendingEnergy: 600, pendingFibre: 0.5 }));
    expect(out.cards).toEqual([]);
  });
  test('garbage targets stay silent', () => {
    const c = ctx({ pendingEnergy: 600, pendingFibre: 0.5, pendingProtein: 2 });
    c.targets = { ...c.targets, fibreG: Number.NaN, proteinG: 0, energyKcal: Number.POSITIVE_INFINITY };
    expect(nutrientDensityRule.level(c)).toBeNull();
  });
  test('frames context, not risk: no disease or risk words anywhere on the card', () => {
    expect(prose(nutrientDensityRule)).not.toMatch(/risk|disease|cancer|diabet|obes|harm/i);
  });
});

describe('the classification rules as a group', () => {
  const ids = ['processed-meat', 'processed-meat-frequency', 'red-meat-weekly', 'alcohol', 'sweet-drink', 'ultra-processed', 'nutrient-density'];
  test('are all in the catalogue and in the nutrition category', () => {
    for (const id of ids) {
      const r = catalogue.find((x) => x.id === id);
      expect(r, id).toBeDefined();
      expect(r?.category).toBe('nutrition');
    }
  });
  test('every citation is complete', () => {
    for (const id of ids) expect(citationProblems(catalogue.find((x) => x.id === id)!.evidence.citation)).toEqual([]);
  });
  test('rules that read flags and no nutrient say so by declaring none', () => {
    const empty = catalogue.filter((r) => r.requiresNutrients.length === 0).map((r) => r.id).sort();
    expect(empty).toEqual(['alcohol', 'processed-meat', 'processed-meat-frequency', 'red-meat-weekly', 'sweet-drink', 'ultra-processed']);
    expect([...nutrientDensityRule.requiresNutrients].sort()).toEqual(['energyKcal', 'fibreG', 'proteinG']);
  });
  test('only processed meat reaches HIGH, over every probe', () => {
    for (const r of catalogue) {
      for (const p of probes[r.id] ?? []) {
        if (r.id !== 'processed-meat') expect(['INFO', 'MODERATE']).toContain(r.level(p.ctx));
      }
    }
  });
  test('the two-hot-dog example: processed meat HIGH sorts first, nothing fails', () => {
    const c = ctx({ classification: pm, pendingGrams: 114, pendingSodium: 2400, weekProcessedMeatOccasions: 2 });
    const out = evaluate(catalogue, c);
    expect(out.failures).toEqual([]);
    expect(out.cards[0]?.ruleId).toBe('processed-meat');
    expect(out.cards[0]?.level).toBe('HIGH');
  });
});
