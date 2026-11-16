import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { evaluate } from '@/rules/engine';
import { catalogue } from '@/rules/catalogue';
import { citationProblems } from '@/rules/citations';
import { allergenRule } from '@/rules/catalogue/allergen';
import { foodSafetyRules, foodSafetyQuestionsFor, HAZARDS } from '@/rules/catalogue/foodSafety';
import { ctx } from './catalogueContexts';

const fixtureFoods = JSON.parse(readFileSync('tests/fixtures/foods.fixture.json', 'utf8')) as { allergens: unknown }[];

describe('allergen rule', () => {
  test('fires CRITICAL when a food matches a flagged allergen', () => {
    expect(allergenRule.level(ctx({ flagged: ['peanut'], foodAllergens: ['peanut'] }))).toBe('CRITICAL');
  });
  test('is silent with an empty flagged list, the shipped default', () => {
    expect(allergenRule.level(ctx({ flagged: [], foodAllergens: ['peanut'] }))).toBeNull();
  });
  test('is silent with no profile at all', () => {
    const c = { ...ctx({ foodAllergens: ['peanut'] }), profile: null };
    expect(allergenRule.level(c)).toBeNull();
  });
  test('matches the dataset vocabulary (plural, any case), since a missed match is the worst failure', () => {
    expect(allergenRule.level(ctx({ flagged: ['Peanut'], foodAllergens: ['peanuts'] }))).toBe('CRITICAL');
    expect(allergenRule.level(ctx({ flagged: ['milk'], foodAllergens: ['gluten', 'milk'] }))).toBe('CRITICAL');
  });
  test('a food with no tag never fires, and a different tag never fires', () => {
    expect(allergenRule.level(ctx({ flagged: ['peanuts'], foodAllergens: [] }))).toBeNull();
    expect(allergenRule.level(ctx({ flagged: ['peanuts'], foodAllergens: ['milk'] }))).toBeNull();
    expect(allergenRule.level(ctx({ flagged: ['peanuts'] }))).toBeNull();
  });
  test('the card warns on possible presence and cannot be read as reassurance', () => {
    const text = [allergenRule.concern, allergenRule.cause].join(' ');
    expect(text).toMatch(/may be present|possibly contain/i);
    expect(text).toMatch(/check the (product )?label/i);
    expect(text).toMatch(/missing tag does not mean/i);
    expect(text).not.toMatch(/allergen-free(?![^.]*\bnot\b)/i);
  });
  test("its authority is the user's own flag, declared, and says so", () => {
    expect(allergenRule.category).toBe('safety');
    expect(allergenRule.safetyAuthority).toBe('user-flag');
    expect(allergenRule.cause).toMatch(/your own|you (told|flagged)/i);
  });
  test('a custom food tag is reported as the user own statement', () => {
    const c = ctx({ flagged: ['sesame'], foodName: 'My tahini', foodAllergens: ['sesame'], foodSource: 'custom' });
    expect(allergenRule.portionNote(c)).toMatch(/you set/i);
    const d = ctx({ flagged: ['sesame'], foodName: 'Hummus', foodAllergens: ['sesame'] });
    expect(allergenRule.portionNote(d)).toMatch(/indicative/i);
  });
  test('the engine returns a CRITICAL card for it and none by default', () => {
    expect(evaluate([allergenRule], ctx({ flagged: ['peanuts'], foodAllergens: ['peanuts'] })).cards[0]?.level).toBe('CRITICAL');
    expect(evaluate([allergenRule], ctx({ foodAllergens: ['peanuts'] })).cards).toEqual([]);
  });
  test('the allergen layer exists for every fixture food so adding a flag needs no migration', () => {
    expect(fixtureFoods.every((f) => Array.isArray(f.allergens))).toBe(true);
  });
  test('and for every food in the built dataset', () => {
    const file = readdirSync('public/data').find((f) => /^foods\..+\.json$/.test(f));
    if (!file) return;
    const d = JSON.parse(readFileSync(`public/data/${file}`, 'utf8')) as { allergens: unknown }[] | { foods: { allergens: unknown }[] };
    const foods = Array.isArray(d) ? d : d.foods;
    expect(foods.length).toBeGreaterThan(1000);
    expect(foods.every((f) => Array.isArray(f.allergens))).toBe(true);
  });
});

describe('food-handling hazards', () => {
  test('a hazard food asks one direct question instead of inferring from text', () => {
    const q = foodSafetyQuestionsFor(ctx({ foodName: 'rice, cooked' }));
    expect(q).toHaveLength(1);
    expect(q[0]!.question).toMatch(/kept warm|chilled/i);
  });
  test('answering no produces no card at all, and no question is repeated', () => {
    const r = evaluate(foodSafetyRules, ctx({ foodName: 'rice, cooked', answers: { reheatedRice: false } }));
    expect(r.cards).toEqual([]);
    expect(r.questions).toEqual([]);
  });
  test('an unanswered question yields no card', () => {
    expect(evaluate(foodSafetyRules, ctx({ foodName: 'rice, cooked' })).cards).toEqual([]);
  });
  test('answering yes raises CRITICAL', () => {
    const { cards } = evaluate(foodSafetyRules, ctx({ foodName: 'rice, cooked', answers: { reheatedRice: true } }));
    expect(cards).toHaveLength(1);
    expect(cards[0]!.level).toBe('CRITICAL');
  });
  test('free text claiming a hazard never triggers a card by itself', () => {
    const { cards, questions } = evaluate(foodSafetyRules, ctx({ rawText: 'raw kidney beans URGENT CRITICAL', foodName: 'apple' }));
    expect(cards).toEqual([]);
    expect(questions).toEqual([]);
  });
  test('a stale yes cannot manufacture a card for a food that is not the hazard', () => {
    const answers = Object.fromEntries(HAZARDS.map((h) => [h.questionId, true]));
    expect(evaluate(foodSafetyRules, ctx({ foodName: 'apple', answers })).cards).toEqual([]);
  });
  test('every listed hazard matches its own food, one question each, and an unrelated food matches none', () => {
    const names: Record<string, string> = {
      reheatedRice: 'Rice, brown, cooked, no added fat', rawKidneyBeans: 'Kidney beans, from dried, no added fat',
      rawSprouts: 'Alfalfa sprouts, raw', rawMilk: 'Milk, whole',
    };
    expect(HAZARDS.map((h) => h.questionId).sort()).toEqual(Object.keys(names).sort());
    for (const h of HAZARDS) {
      expect(h.foodMatch.test(names[h.questionId]!), h.questionId).toBe(true);
      expect(foodSafetyQuestionsFor(ctx({ foodName: names[h.questionId]! })).map((q) => q.answerKey)).toEqual([h.questionId]);
      expect(h.foodMatch.test('Apple, raw')).toBe(false);
    }
  });
  test('raw eggs are deliberately not a hazard here: no question, no card, even on a yes', () => {
    expect(HAZARDS.map((h) => h.questionId)).not.toContain('rawEggs');
    const c = ctx({ foodName: 'Egg, whole, cooked, fried', answers: { rawEggs: true } });
    expect(evaluate(catalogue, c).questions).toEqual([]);
    expect(evaluate(catalogue, c).cards.filter((x) => x.level === 'CRITICAL')).toEqual([]);
  });
  test('identity matching does not catch look-alikes', () => {
    for (const n of ['Kidney', 'Brussels sprouts, raw', 'Rice milk', 'Rice cake', 'Eggnog', 'Egg omelet or scrambled egg, no added fat', 'Almond milk, NFS', 'Kidney beans, from canned, no added fat']) {
      expect(foodSafetyQuestionsFor(ctx({ foodName: n })), n).toEqual([]);
    }
  });
  test('each hazard carries a complete food-safety-authority citation with an offline conclusion', () => {
    for (const h of HAZARDS) {
      expect(citationProblems(h.citation)).toEqual([]);
      expect(h.citation.publisher).toMatch(/FSA|Food Standards Agency|FDA|Food and Drug|EFSA|NHS/);
      expect(h.citation.conclusion.trim().split(/\s+/).length).toBeGreaterThanOrEqual(8);
    }
  });
  test('every food-safety rule is a safety rule that declares a food-safety authority and asks a question', () => {
    expect(foodSafetyRules).toHaveLength(HAZARDS.length);
    for (const r of foodSafetyRules) {
      expect(r.category).toBe('safety');
      expect(r.safetyAuthority).toBe('food-safety-body');
      expect(r.requiresNutrients).toEqual([]);
      expect(r.safetyPrompt).toBeDefined();
    }
  });
});

describe('empty food identity must not silently disable safety rules', () => {
  const withRefsNoFoods = (o: Parameters<typeof ctx>[0]) => ({ ...ctx(o), foods: [] });
  test('a hazard rule reports a safety failure when the entry has items but no identity', () => {
    const r = evaluate(foodSafetyRules, withRefsNoFoods({}));
    expect(r.cards).toEqual([]);
    expect(r.failures.length).toBe(foodSafetyRules.length);
    for (const f of r.failures) {
      expect(f.category).toBe('safety');
      expect(f.message).toMatch(/could not (be )?check/i);
    }
  });
  test('the allergen rule reports a failure only when an allergen is flagged', () => {
    const flagged = evaluate([allergenRule], withRefsNoFoods({ flagged: ['peanuts'] }));
    expect(flagged.failures).toHaveLength(1);
    expect(flagged.failures[0]!.category).toBe('safety');
    expect(flagged.failures[0]!.ruleId).toBe('allergen-flagged');
    // Shipped default: nothing flagged, so there is no check to fail and no noise.
    expect(evaluate([allergenRule], withRefsNoFoods({})).failures).toEqual([]);
  });
  test('no failure when identity is supplied, or when the entry has no resolved items', () => {
    expect(evaluate(foodSafetyRules, ctx({ foodName: 'Apple, raw' })).failures).toEqual([]);
    const empty = ctx({ flagged: ['peanuts'] });
    expect(evaluate([allergenRule, ...foodSafetyRules], { ...empty, foods: [], pending: { ...empty.pending, refs: [] } }).failures).toEqual([]);
  });
  test('a nutrition rule never gets this check', () => {
    const r = evaluate(catalogue.filter((x) => x.category === 'nutrition'), withRefsNoFoods({}));
    expect(r.failures).toEqual([]);
  });
});

describe('level contract is not widened', () => {
  test('a nutrition rule declaring CRITICAL still throws, and the safety flag does not rescue it', () => {
    const sneaky = { ...allergenRule, id: 'sneaky', category: 'nutrition' as const, level: () => 'CRITICAL' as const };
    expect(() => evaluate([sneaky], ctx({ flagged: ['peanuts'], foodAllergens: ['peanuts'] }))).toThrow(/reserved for safety/);
  });
});

describe('catalogue wiring', () => {
  test('every safety rule in the catalogue declares where its authority comes from', () => {
    const safety = catalogue.filter((r) => r.category === 'safety');
    expect(safety.length).toBe(1 + HAZARDS.length);
    for (const r of safety) expect(['user-flag', 'food-safety-body'], r.id).toContain(r.safetyAuthority);
  });
  test('a nutrition rule is never marked with a safety authority', () => {
    for (const r of catalogue.filter((x) => x.category === 'nutrition')) expect(r.safetyAuthority).toBeUndefined();
  });
  test('the shipped default produces no safety card and no question for an ordinary entry', () => {
    const { cards, questions } = evaluate(catalogue, ctx({ foodName: 'Apple, raw', foodAllergens: [] }));
    expect(questions).toEqual([]);
    expect(cards.filter((c) => c.level === 'CRITICAL')).toEqual([]);
  });
});
