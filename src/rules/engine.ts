import { isKnownValue } from '@/domain/nutrients';
import type { NutrientKey } from '@/types/nutrients';
import type { Context, Level, MergedClaim, Rule, RuleFailure, SafetyQuestion, WarningCard } from './types';

export const MAX_CARDS = 3;
const DEFAULT_MIN_COVERAGE = 0.8;
const RANK: Record<Level, number> = { INFO: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };

const LABEL: Record<NutrientKey, string> = {
  energyKcal: 'energy', proteinG: 'protein', fatG: 'fat', satFatG: 'saturated-fat', transFatG: 'trans-fat',
  carbG: 'carbohydrate', sugarsG: 'sugars', addedSugarsG: 'added-sugar', fibreG: 'fibre', sodiumMg: 'sodium',
  potassiumMg: 'potassium', calciumMg: 'calcium', ironMg: 'iron', magnesiumMg: 'magnesium', zincMg: 'zinc',
  vitaminCMg: 'vitamin-C', vitaminDUg: 'vitamin-D', vitaminB12Ug: 'vitamin-B12', folateUg: 'folate',
};

type Gate = { pass: false } | { pass: true; notes: string[] };

/** Silence is the default: any doubt about an input means the rule does not fire. */
function gate(rule: Rule, ctx: Context): Gate {
  const notes: string[] = [];
  const floor = rule.minCoverage ?? DEFAULT_MIN_COVERAGE;
  const daily = rule.scope === 'daily';
  const dayHasEntries = ctx.today.entryCount > 0;

  for (const key of rule.requiresNutrients) {
    const label = LABEL[key];
    // Pending entry: the value must be a finite number and not flagged unknown. Partial is allowed, with a note.
    const cov = ctx.pending.coverage[key];
    if (cov === 'unknown' || !isKnownValue(ctx.pending.nutrients[key])) return { pass: false };
    if (cov === 'partial') {
      notes.push(`Some foods in this entry have no ${label} data, so its ${label} may be understated.`);
    }

    // A day with no entries has nothing to understate: the projection is the pending entry alone. A day WITH
    // entries but no nutrient data is not empty: its coverage reads 'unknown', so the check below stays silent.
    if (!daily || !dayHasEntries) continue;
    // Today's total: BOTH signals must pass. energyCoveredShare can read 1 while coverage is 'partial'
    // (entries with no energy figure are invisible to the ratio), so neither alone is trustworthy.
    const share = ctx.today.energyCoveredShare[key];
    const dayCov = ctx.today.coverage[key];
    if (dayCov === 'unknown' || !Number.isFinite(share) || share < floor) return { pass: false };
    if (dayCov !== 'known' || share < 1) {
      notes.push(`Some of today's food has no ${label} data, so today's ${label} total may be understated.`);
    }
  }
  return { pass: true, notes };
}

function describe(rule: Rule, e: unknown): RuleFailure {
  return {
    ruleId: rule.id,
    category: rule.category,
    message: `rule "${rule.id}" threw while evaluating: ${e instanceof Error ? e.message : String(e)}`,
  };
}

/** Throws only for a level-contract violation (nutrition CRITICAL, or a level above the evidence cap), and only in dev/test; every other problem is returned as a failure. */
function evaluateRule(rule: Rule, ctx: Context): { level: Level; notes: string[] } | RuleFailure | null {
  const g = gate(rule, ctx);
  if (!g.pass) return null;
  let level: Level | null;
  try {
    level = rule.level(ctx);
  } catch (e) {
    return describe(rule, e);
  }
  if (level === null) return null;
  let violation: string | null = null;
  if (level === 'CRITICAL' && rule.category !== 'safety') {
    violation = `rule "${rule.id}" is a nutrition rule and declared CRITICAL; CRITICAL is reserved for safety rules`;
  } else if (
    // The ceiling applies to NUTRITION rules only. It stops a rule claiming more severity than its epidemiological
    // evidence supports. A safety rule's severity does not come from effect size: a flagged allergen is CRITICAL
    // because the user said they react to it, and a handling hazard because the risk is immediate. Applying the
    // ceiling there would silently downgrade an allergen card, the one downgrade this app must never make.
    // Exempt from the ceiling is not exempt from saying why: safety rules still declare their authority.
    rule.category === 'nutrition' &&
    RANK[level] > RANK.MODERATE &&
    (rule.evidence.strength === 'uncertain' || rule.evidence.strength === 'limited')) {
    violation = `rule "${rule.id}" declared ${level} on ${rule.evidence.strength} evidence; ${rule.evidence.strength} evidence is capped at MODERATE`;
  }
  if (violation !== null) {
    // Loud where it can be fixed (dev and test), non-blocking where it cannot (a shipped build must stay usable).
    // import.meta.env.DEV is statically replaced by Vite in a production build.
    if (import.meta.env.DEV) throw new Error(violation);
    return { ruleId: rule.id, category: rule.category, message: violation };
  }
  return { level, notes: g.notes };
}

function unique(xs: (string | undefined)[]): string[] {
  return [...new Set(xs.filter((x): x is string => !!x))];
}

function claimOf(c: WarningCard): MergedClaim {
  return { ruleId: c.ruleId, concern: c.concern, portionNote: c.portionNote, evidence: c.evidence, citation: c.evidence.citation };
}

/** The higher-level card keeps ALL its own prose and evidence; the other is attached whole, never concatenated. */
function merge(a: WarningCard, b: WarningCard): WarningCard {
  const [hi, lo] = RANK[b.level] > RANK[a.level] ? [b, a] : [a, b];
  const note = unique([hi.dataNote, lo.dataNote]).join(' ');
  const { dataNote: _dropped, ...rest } = hi;
  return {
    ...rest,
    mergedFrom: [...hi.mergedFrom, lo.ruleId, ...lo.mergedFrom],
    merged: [...hi.merged, claimOf(lo), ...lo.merged],
    ...(note ? { dataNote: note } : {}),
  };
}

export function evaluate(rules: Rule[], ctx: Context): { cards: WarningCard[]; questions: SafetyQuestion[]; failures: RuleFailure[] } {
  // Safety questions come first. Unanswered means no card, never a guess; the gate asks and re-evaluates.
  const questions: SafetyQuestion[] = [];
  const failures: RuleFailure[] = [];
  const held = new Set<string>();
  for (const r of rules) {
    const p = r.safetyPrompt;
    if (!p) continue;
    let applies: boolean;
    try {
      applies = p.applies(ctx);
    } catch (e) {
      failures.push(describe(r, e));
      held.add(r.id);
      continue;
    }
    if (!applies) continue;
    const answer = ctx.answers[p.answerKey];
    if (answer === undefined) {
      questions.push({ ruleId: r.id, question: p.question, answerKey: p.answerKey });
    } else if (answer === false) {
      held.add(r.id); // answered no: the hazard condition is absent, whatever the rule's own level() says
    }
  }
  if (questions.length > 0) return { cards: [], questions, failures };

  const built: { card: WarningCard; order: number }[] = [];
  rules.forEach((rule, order) => {
    if (held.has(rule.id)) return;
    const res = evaluateRule(rule, ctx);
    if (!res) return;
    if ('ruleId' in res) {
      failures.push(res);
      return;
    }
    let portionNote: string;
    try {
      portionNote = rule.portionNote(ctx);
    } catch (e) {
      failures.push(describe(rule, e));
      return;
    }
    built.push({
      order,
      card: {
        ruleId: rule.id,
        mergedFrom: [],
        merged: [],
        level: res.level,
        title: rule.title,
        concern: rule.concern,
        cause: rule.cause,
        evidence: { ...rule.evidence, citation: { ...rule.evidence.citation } },
        horizon: rule.horizon,
        portionNote,
        alternatives: (rule.alternatives ?? []).map((x) => ({ ...x })),
        ...(rule.nutrientKey ? { nutrientKey: rule.nutrientKey } : {}),
        ...(res.notes.length ? { dataNote: res.notes.join(' ') } : {}),
      },
    });
  });

  // Merge same-nutrient cards; a merged card keeps the position of its first-declared member.
  const merged: { card: WarningCard; order: number }[] = [];
  const slot = new Map<NutrientKey, number>();
  for (const b of built) {
    const key = b.card.nutrientKey;
    const at = key === undefined ? undefined : slot.get(key);
    if (key === undefined || at === undefined) {
      if (key !== undefined) slot.set(key, merged.length);
      merged.push(b);
    } else {
      const prev = merged[at]!;
      merged[at] = { card: merge(prev.card, b.card), order: prev.order };
    }
  }

  // More than three CRITICAL cards is possible and all but three are cut; safety rules are few and mutually
  // exclusive in practice, so no tiebreak beyond declaration order is applied.
  merged.sort((x, y) => RANK[y.card.level] - RANK[x.card.level] || x.order - y.order);
  return { cards: merged.slice(0, MAX_CARDS).map((m) => m.card), questions: [], failures };
}
