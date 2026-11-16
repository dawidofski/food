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
  test("offers WCRF's own sandwich alternatives to ham, with that citation and nothing it does not say", () => {
    const alts = processedMeatRule.alternatives ?? [];
    expect(alts).toHaveLength(1);
    const a = alts[0]!;
    expect(a.citation.publisher).toMatch(/WCRF|World Cancer Research Fund/);
    expect(a.citation.conclusion).toMatch(/alternatives to ham/i);
    expect(a.citation.conclusion).toMatch(/tinned tuna/i);
    // Offered as WCRF's own example, not as advice tailored to this entry: the reason, not the label, carries the framing.
    expect(a.reason).toMatch(/WCRF/);
    expect(a.reason).toMatch(/own example/i);
    expect(a.reason).toMatch(/sandwich/i);
    expect(citationProblems(a.citation)).toEqual([]);
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
  test('carries IARC as a supporting citation for the classification it names, and WCRF for the amount', () => {
    const sup = redMeatWeeklyRule.evidence.supportingCitations ?? [];
    expect(sup).toHaveLength(1);
    expect(sup[0]?.publisher).toMatch(/IARC|International Agency/);
    expect(sup[0]?.conclusion).toMatch(/Group 2A/);
    expect(citationProblems(sup[0]!)).toEqual([]);
    expect(redMeatWeeklyRule.evidence.citation.publisher).toMatch(/WCRF|World Cancer Research Fund/);
  });
  test('says the diary weight may not be cooked weight', () => {
    expect(redMeatWeeklyRule.concern).toMatch(/cooked/i);
    expect(redMeatWeeklyRule.concern).toMatch(/raw/i);
  });
});

describe('engine copies supporting citations', () => {
  test('a card cannot mutate the rule or share its supporting citation objects', () => {
    const out = evaluate([redMeatWeeklyRule], ctx({ classification: { redMeat: true }, pendingGrams: 150, weekRedMeatGrams: 450 }));
    const card = out.cards[0]!;
    expect(card.evidence.supportingCitations).toEqual(redMeatWeeklyRule.evidence.supportingCitations);
    expect(card.evidence.supportingCitations?.[0]).not.toBe(redMeatWeeklyRule.evidence.supportingCitations?.[0]);
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
  test('carries IARC as a supporting citation for the Group 1 classification it names', () => {
    const sup = alcoholRule.evidence.supportingCitations ?? [];
    expect(sup).toHaveLength(1);
    expect(sup[0]?.publisher).toMatch(/IARC|International Agency/);
    expect(sup[0]?.conclusion).toMatch(/Group 1/);
    expect(citationProblems(sup[0]!)).toEqual([]);
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
  const nova = { novaGroup: 4 as const };
  test('declares limited, associational evidence and says so on the card', () => {
    expect(ultraProcessedRule.evidence.strength).toBe('limited');
    expect(ultraProcessedRule.evidence.isAssociational).toBe(true);
    expect(prose(ultraProcessedRule)).toMatch(/observational/i);
    expect(prose(ultraProcessedRule)).toMatch(/no threshold is established/i);
  });
  test('is a daily rule on the share of the day\'s ENTRIES that are NOVA 4, not a flag on every NOVA 4 item', () => {
    expect(ultraProcessedRule.scope).toBe('daily');
    // 2 of 3 earlier entries plus this one: 3 of 4.
    expect(ultraProcessedRule.level(ctx({ classification: nova, todayEntryCount: 3, todayNova4Entries: 2 }))).toBe('INFO');
    // One NOVA 4 entry on a quiet day does nothing.
    expect(ultraProcessedRule.level(ctx({ classification: nova }))).toBeNull();
    expect(ultraProcessedRule.level(ctx({ classification: nova, todayEntryCount: 1, todayNova4Entries: 0 }))).toBeNull();
  });
  test('needs at least three entries, this one included, so one snack cannot trigger it', () => {
    expect(ultraProcessedRule.level(ctx({ classification: nova, todayEntryCount: 1, todayNova4Entries: 1 }))).toBeNull(); // 2 of 2
    expect(ultraProcessedRule.level(ctx({ classification: nova, todayEntryCount: 2, todayNova4Entries: 2 }))).toBe('INFO'); // 3 of 3
  });
  test('fires only on MORE than half: exactly half is silent', () => {
    expect(ultraProcessedRule.level(ctx({ classification: nova, todayEntryCount: 3, todayNova4Entries: 1 }))).toBeNull(); // 2 of 4
    expect(ultraProcessedRule.level(ctx({ classification: nova, todayEntryCount: 5, todayNova4Entries: 2 }))).toBeNull(); // 3 of 6
    expect(ultraProcessedRule.level(ctx({ classification: nova, todayEntryCount: 4, todayNova4Entries: 3 }))).toBe('INFO'); // 4 of 5
  });
  test('silent unless the pending entry is itself NOVA 4, however the day went', () => {
    expect(ultraProcessedRule.level(ctx({ classification: { novaGroup: 3 }, todayEntryCount: 5, todayNova4Entries: 5 }))).toBeNull();
    expect(ultraProcessedRule.level(ctx({ todayEntryCount: 5, todayNova4Entries: 5 }))).toBeNull();
  });
  test('an empty or unreadable day is silence, not a share', () => {
    expect(ultraProcessedRule.level(ctx({ classification: nova, emptyDay: true }))).toBeNull();
    const c = ctx({ classification: nova, todayEntryCount: 3, todayNova4Entries: 3 });
    c.today.nova4EntryCount = Number.NaN;
    expect(ultraProcessedRule.level(c)).toBeNull();
  });
  test('discloses that it counts entries rather than measuring an amount', () => {
    expect(ultraProcessedRule.concern).toMatch(/counts entries, not energy/i);
    expect(ultraProcessedRule.concern).toMatch(/marks a daily pattern rather than measuring one/i);
    // It must NOT characterise the research literature: nobody on this project read those studies at source.
    expect(ultraProcessedRule.concern).not.toMatch(/much of the research/i);
  });
  test("labels the share and the three-entry floor as the app's own choice", () => {
    expect(ultraProcessedRule.concern).toMatch(/app's own choice[^.]*not a published figure/i);
  });
  test('portion note states the counts including this entry, and is free of NaN', () => {
    const n = ultraProcessedRule.portionNote(ctx({ classification: nova, todayEntryCount: 3, todayNova4Entries: 2 }));
    expect(n).toMatch(/3 of 4/);
    expect(n).not.toMatch(/NaN|Infinity|undefined/);
  });
  test('states the category is broad and it is unclear whether processing or nutrients explain the link', () => {
    expect(ultraProcessedRule.concern).toMatch(/broad/i);
    expect(ultraProcessedRule.concern).toMatch(/unclear whether/i);
  });
  test('stays at INFO through the engine (evidence ceiling)', () => {
    const out = evaluate([ultraProcessedRule], ctx({ classification: nova, todayEntryCount: 3, todayNova4Entries: 2 }));
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
    const empty = catalogue.filter((r) => r.category === 'nutrition' && r.requiresNutrients.length === 0).map((r) => r.id).sort();
    expect(empty).toEqual(['alcohol', 'processed-meat', 'processed-meat-frequency', 'red-meat-weekly', 'sweet-drink', 'ultra-processed']);
    expect([...nutrientDensityRule.requiresNutrients].sort()).toEqual(['energyKcal', 'fibreG', 'proteinG']);
  });
  test('only processed meat reaches HIGH, over every probe', () => {
    for (const r of catalogue.filter((x) => x.category === 'nutrition')) {
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

describe('wording added in the cited-conclusion pass is pinned', () => {
  test('alcohol: the conclusion carries WHO no-safe-level and no-threshold sentences', () => {
    const c = alcoholRule.evidence.citation.conclusion;
    expect(c).toMatch(/cannot talk about a so-called safe level of alcohol use/i);
    expect(c).toMatch(/cannot indicate the existence of a threshold/i);
  });
  test('nutrient density: the card says the comparison is its own and the citation is background', () => {
    expect(nutrientDensityRule.evidence.summary).toMatch(/entirely the app.s own comparison/i);
    expect(nutrientDensityRule.evidence.summary).toMatch(/No guideline sets it/);
    expect(nutrientDensityRule.evidence.summary).toMatch(/background on diet quality/i);
  });
  test('red meat: the conclusion and prose carry the IARC sites and limited-evidence wording', () => {
    const all = [redMeatWeeklyRule.evidence.citation, ...(redMeatWeeklyRule.evidence.supportingCitations ?? [])].map((c) => c.conclusion).join(' ');
    expect(all).toMatch(/pancreatic[\s\S]*prostate/i);
    expect(`${redMeatWeeklyRule.evidence.summary} ${redMeatWeeklyRule.concern}`).toMatch(/limited evidence in humans and\s+strong mechanistic evidence/i);
  });
});
