import { lsKey } from '@/data/db';
import type { Context, Rule, SafetyQuestion } from '@/rules/types';

/**
 * A "no" to a food-handling question, remembered per food across sessions. Someone who says once that they chill their
 * rice is not asked about rice again; the question is kept rare so the one tier that cannot be collapsed stays credible.
 * Only a "no" is remembered: a "yes" is a fact about one serving and is always asked again. Stored under the app prefix,
 * so "erase everything" removes it. If storage is blocked the question is simply asked again.
 */
const KEY = lsKey('safety.no');

const entryOf = (answerKey: string, foodName: string): string => `${answerKey}|${foodName.trim().toLowerCase()}`;

function read(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    const v: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function rememberNo(answerKey: string, foodNames: string[]): void {
  if (foodNames.length === 0) return;
  try {
    const s = read();
    for (const n of foodNames) s.add(entryOf(answerKey, n));
    localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch {
    /* asked again next time */
  }
}

export function isRememberedNo(answerKey: string, foodNames: string[]): boolean {
  if (foodNames.length === 0) return false;
  const s = read();
  return foodNames.every((n) => s.has(entryOf(answerKey, n)));
}

/** The names of the pending foods this question is about: those for which the rule's own `applies` says yes. */
export function foodsAskedAbout(rules: Rule[], q: SafetyQuestion, base: Omit<Context, 'answers'>): string[] {
  const p = rules.find((r) => r.id === q.ruleId)?.safetyPrompt;
  if (!p) return [];
  try {
    return base.foods.filter((f) => p.applies({ ...base, answers: {}, foods: [f] })).map((f) => f.name);
  } catch {
    return [];
  }
}

/** The questions already answered "no" for every food they concern: their answers, ready to seed the evaluation. */
export function rememberedAnswers(rules: Rule[], questions: SafetyQuestion[], base: Omit<Context, 'answers'>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const q of questions) {
    if (isRememberedNo(q.answerKey, foodsAskedAbout(rules, q, base))) out[q.answerKey] = false;
  }
  return out;
}
