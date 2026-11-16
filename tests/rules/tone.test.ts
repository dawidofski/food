import { describe, expect, test } from 'vitest';
import { catalogue } from '@/rules/catalogue';
import type { Rule } from '@/rules/types';
import { probes } from './catalogueContexts';

/** Every string a person could read on a card for this rule, including its portion note in each probe context. */
function allProse(rule: Rule): string {
  const parts = [
    rule.title, rule.concern, rule.cause, rule.evidence.summary,
    rule.evidence.citation.title, rule.evidence.citation.conclusion,
    ...(rule.alternatives ?? []).flatMap((a) => [a.label, a.reason]),
    ...(probes[rule.id] ?? []).map((p) => rule.portionNote(p.ctx)),
  ];
  return parts.join('\n');
}
/** Prose the app writes itself. The citation's conclusion is the source's own words and is excluded from phrasing checks. */
function ownProse(rule: Rule): string {
  return allProse(rule).replace(rule.evidence.citation.conclusion, '');
}

const DISEASE = /\b(cancer|heart disease|cardiovascular|diabetes|stroke|hypertension|high blood pressure|tooth decay|caries|obesity)\b/i;

test('the tone tests really run over the catalogue', () => {
  expect(catalogue.length).toBeGreaterThanOrEqual(6);
  for (const r of catalogue) expect(probes[r.id]?.length, `${r.id} has no probe for its portion note`).toBeGreaterThan(0);
});

describe.each(catalogue)('$id', (rule) => {
  test('no exclamation marks or shaming phrasing', () => {
    const text = allProse(rule);
    expect(text).not.toMatch(/!/);
    expect(text).not.toMatch(
      /you should not|you must not|you shouldn't|you mustn't|bad choice|unhealthy habit|junk|guilty|cheat|\bbad\b|\bsin\b|\bnever\b|\bdon't\b|\bavoid\b|\bstop\b|\bquit\b/i,
    );
  });

  test('never attributes disease to one serving', () => {
    const text = ownProse(rule);
    expect(text).not.toMatch(/this (meal|serving|portion|entry|food) (causes|will cause|gives you|leads to|raises your risk)/i);
    // Wherever a disease is named, the sentence carries a hedge and does not speak of this entry or serving.
    for (const sentence of text.split(/(?<=[.?])\s+/)) {
      if (!DISEASE.test(sentence)) continue;
      expect(sentence, `unhedged disease claim: ${sentence}`).toMatch(/\b(may|associated|linked|risk|evidence|studies|trials|usual|over time)\b/i);
      expect(sentence, `disease tied to one serving: ${sentence}`).not.toMatch(/\b(this|today's|one) (meal|serving|portion|entry|food|day)\b/i);
    }
  });

  test('associational evidence is phrased as association, never as cause', () => {
    if (!rule.evidence.isAssociational) return;
    const text = ownProse(rule);
    expect(text).not.toMatch(/\bcauses?\b|\bcaused\b|\bleads? to\b|\bresults? in\b|\bwill\b|\bproves?\b|\bensures?\b/i);
    expect(text).toMatch(/\b(associated|linked|may|risk|suggest|observ)/i);
  });

  test('carries a citation with a substantive offline conclusion', () => {
    const c = rule.evidence.citation;
    expect(c.conclusion.length).toBeGreaterThan(20);
    expect(c.conclusion.trim().split(/\s+/).length).toBeGreaterThanOrEqual(8);
    expect(c.conclusion).not.toMatch(/https?:\/\//);
    expect(c.publisher.trim()).toBeTruthy();
    expect(c.url).toMatch(/^https:\/\//);
  });

  test('alternatives exist only where the rule offers honest ones', () => {
    if (rule.alternatives === undefined) return;
    expect(rule.alternatives.length).toBeGreaterThan(0);
    for (const a of rule.alternatives) {
      expect(a.label.trim().length).toBeGreaterThan(3);
      expect(a.reason.trim().length).toBeGreaterThan(20);
    }
    // An alternative must trace to the cited source's replacement advice, not to taste: the reason names it.
    expect(rule.alternatives.map((a) => a.reason).join(' ')).toMatch(/WHO/);
  });

  test('a rule that compares one entry with a daily figure says plainly that no single-serving guideline exists', () => {
    if (rule.scope !== 'entry') return;
    expect(rule.concern).toMatch(/\b(no|not)\b[^.]*\b(single|one) (serving|entry|meal)/i);
  });

  test('a rule on a daily figure says the figure concerns usual intake, not one day or serving', () => {
    if (rule.scope !== 'daily') return;
    expect(rule.concern).toMatch(/usual|average|over time|day-to-day|habitual/i);
  });

  test('claims no more than its evidence: strong or moderate only, declared honestly', () => {
    expect(['strong', 'moderate']).toContain(rule.evidence.strength);
    expect(rule.evidence.body).toBeTruthy();
  });
});
