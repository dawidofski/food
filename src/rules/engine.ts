import { isKnownValue } from '@/domain/nutrients';
import type { NutrientKey } from '@/types/nutrients';
import type { Context, Level, Rule, SafetyQuestion, WarningCard } from './types';

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
  const daily = (rule.scope ?? 'daily') === 'daily';
  const dayHasData = Object.keys(ctx.today.nutrients).length > 0;

  for (const key of rule.requiresNutrients) {
    const label = LABEL[key];
    // Pending entry: the value must be a finite number and not flagged unknown. Partial is allowed, with a note.
    const cov = ctx.pending.coverage[key];
    if (cov === 'unknown' || !isKnownValue(ctx.pending.nutrients[key])) return { pass: false };
    if (cov === 'partial') {
      notes.push(`Some foods in this entry have no ${label} data, so its ${label} may be understated.`);
    }

    // An empty day has nothing to understate: the projection is the pending entry alone.
    if (!daily || !dayHasData) continue;
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

function evaluateRule(rule: Rule, ctx: Context): { level: Level; notes: string[] } | null {
  const g = gate(rule, ctx);
  if (!g.pass) return null;
  let level: Level | null;
  try {
    level = rule.level(ctx);
  } catch (e) {
    // Not swallowed: silently dropping a safety rule would hide a hazard, and a failing rule is a catalogue bug.
    throw new Error(`rule "${rule.id}" threw while evaluating: ${e instanceof Error ? e.message : String(e)}`, {
      cause: e,
    });
  }
  if (level === null) return null;
  if (level === 'CRITICAL' && rule.category !== 'safety') {
    throw new Error(`rule "${rule.id}" is a nutrition rule and declared CRITICAL; CRITICAL is reserved for safety rules`);
  }
  return { level, notes: g.notes };
}

function unique(xs: (string | undefined)[]): string[] {
  return [...new Set(xs.filter((x): x is string => !!x))];
}

function merge(a: WarningCard, b: WarningCard): WarningCard {
  const [hi, lo] = RANK[b.level] > RANK[a.level] ? [b, a] : [a, b];
  const note = unique([hi.dataNote, lo.dataNote]).join(' ');
  const { dataNote: _dropped, ...rest } = hi;
  return {
    ...rest,
    portionNote: unique([hi.portionNote, lo.portionNote]).join(' '),
    mergedFrom: [...hi.mergedFrom, lo.ruleId, ...lo.mergedFrom],
    ...(note ? { dataNote: note } : {}),
  };
}

export function evaluate(rules: Rule[], ctx: Context): { cards: WarningCard[]; questions: SafetyQuestion[] } {
  // Safety questions come first. Unanswered means no card, never a guess; the gate asks and re-evaluates.
  const questions: SafetyQuestion[] = [];
  const held = new Set<string>();
  for (const r of rules) {
    const p = r.safetyPrompt;
    if (!p || !p.applies(ctx)) continue;
    const answer = ctx.answers[p.answerKey];
    if (answer === undefined) {
      questions.push({ ruleId: r.id, question: p.question, answerKey: p.answerKey });
    } else if (answer === false) {
      held.add(r.id); // answered no: the hazard condition is absent, whatever the rule's own level() says
    }
  }
  if (questions.length > 0) return { cards: [], questions };

  const built: { card: WarningCard; order: number }[] = [];
  rules.forEach((rule, order) => {
    if (held.has(rule.id)) return;
    const res = evaluateRule(rule, ctx);
    if (!res) return;
    built.push({
      order,
      card: {
        ruleId: rule.id,
        mergedFrom: [],
        level: res.level,
        title: rule.title,
        concern: rule.concern,
        cause: rule.cause,
        evidence: rule.evidence,
        horizon: rule.horizon,
        portionNote: rule.portionNote(ctx),
        alternatives: rule.alternatives ?? [],
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

  merged.sort((x, y) => RANK[y.card.level] - RANK[x.card.level] || x.order - y.order);
  return { cards: merged.slice(0, MAX_CARDS).map((m) => m.card), questions: [] };
}
