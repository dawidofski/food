import type { FoodSource, Level, Resolution } from '@/types/diary';
import type { NutrientKey } from '@/types/nutrients';
import type { Profile, Targets } from '@/types/profile';
import type { DayTotals, WeekContext } from '@/domain/totals';

export type { Level };

export type EvidenceStrength = 'strong' | 'moderate' | 'limited' | 'uncertain';

export type Citation = {
  title: string;
  publisher: string;
  year: number;
  url: string;
  /** A short verbatim statement of what the source concludes. The app works offline; a URL alone is not content. */
  conclusion: string;
};

export type Alternative = {
  label: string;
  reason: string;
  /** The source's own replacement advice. An alternative with no citation is a taste, not evidence. */
  citation: Citation;
};

export type Evidence = {
  strength: EvidenceStrength;
  /** The issuing body: "IARC", "WHO", "EFSA". */
  body: string;
  /** Plain-language statement of what is actually shown. */
  summary: string;
  citation: Citation;
  /**
   * Further sources for a card that makes more than one sourced claim. `citation` supports the claim that fires the
   * card; each claim the prose attributes to another body (a classification, say) is owed that body's own citation here.
   */
  supportingCitations?: Citation[];
  /** True forces hedged phrasing downstream: never "causes". */
  isAssociational: boolean;
};

export type Horizon = 'occasional' | 'habitual' | 'both';

/**
 * The identity of one resolved food in the pending entry, as the caller knows it. Safety rules match on THIS, never on
 * what the user typed: USDA identity cannot tell how a food was handled, and free text is user input.
 */
export type FoodIdentity = {
  name: string;
  /** Indicative tags from the build pipeline (or set by the user on a custom food). An absent tag is NOT "allergen-free". */
  allergens: string[];
  source: FoodSource;
};

export type Context = {
  pending: Resolution;
  /** The resolved foods of the pending entry. Empty when the caller cannot name them: identity rules then stay silent. */
  foods: FoodIdentity[];
  /**
   * What the user typed. Present for display and tracing ONLY: no rule may read it to raise a level. A safety rule that
   * did could be triggered by anything a person types, on the one tier that cannot be collapsed.
   */
  rawText?: string;
  today: DayTotals;
  week: WeekContext;
  targets: Targets;
  profile: Profile | null;
  /** The caller supplies the clock; nothing in the engine reads it. */
  now: Date;
  /** Answers to safety questions, keyed by SafetyPrompt.answerKey. Absent = unanswered. */
  answers: Record<string, boolean>;
};

/** A hazard that depends on how the food was handled, which cannot be inferred from the food itself. */
export type SafetyPrompt = {
  /** Key under which the answer is stored in `Context.answers`. */
  answerKey: string;
  /** Whether this question is relevant to the pending entry at all. */
  applies: (ctx: Context) => boolean;
  question: string;
};

export type Rule = {
  id: string;
  title: string;
  /** CRITICAL is reserved for 'safety'. `evaluate` throws when a 'nutrition' rule returns it. */
  category: 'nutrition' | 'safety';
  /** null = stay silent, which is the normal case. */
  level: (ctx: Context) => Level | null;
  concern: string;
  cause: string;
  evidence: Evidence;
  horizon: Horizon;
  portionNote: (ctx: Context) => string;
  /** Omitted entirely when none is honest. */
  alternatives?: Alternative[];

  /** The rule stays silent if any of these is not known in the pending entry. Absent means unknown, never zero. */
  requiresNutrients: NutrientKey[];
  /**
   * SAFETY RULES ONLY. True when, for this context, the rule cannot do its job without `ctx.foods`. If the entry has
   * resolved items but `foods` is empty, the engine reports a failure instead of letting the rule go silent: a caller
   * that forgets to supply identity must not quietly disable every allergen and hazard check.
   */
  identityRequired?: (ctx: Context) => boolean;
  /**
   * SAFETY RULES ONLY. A reason this rule cannot fully check the entry (for example a flagged allergen it has no tag for),
   * or null. The engine reports it as a `failures` entry whenever the entry has items, and still evaluates the rule.
   */
  cannotCheck?: (ctx: Context) => string | null;
  /**
   * SAFETY RULES ONLY. Where the card's authority comes from: a safety card is exempt from the evidence ceiling and must
   * still say why it is CRITICAL. 'user-flag': the person told the app they react to it (definitional, not evidential).
   * 'food-safety-body': a food-safety authority's published advice, which `evidence.citation` carries.
   */
  safetyAuthority?: 'user-flag' | 'food-safety-body';
  /**
   * Which total the rule reads, REQUIRED so no default can mislead. 'entry' reads only the pending entry.
   * 'daily' reads today's running total plus the pending entry, so the coverage gate applies to it.
   */
  scope: 'entry' | 'daily';
  /** Minimum share (0..1) of the day's energy with known values for each required nutrient. Default 0.8. */
  minCoverage?: number;
  /** Cards on the same nutrient merge into one. */
  nutrientKey?: NutrientKey;
  /** When set, the gate asks this question first; the rule is only evaluated once it is answered yes. */
  safetyPrompt?: SafetyPrompt;
};

/** A claim absorbed into a merged card, with its OWN evidence: a claim is never shown under another rule's source. */
export type MergedClaim = {
  ruleId: string;
  /** The level this claim had as its own card before it was absorbed. */
  level: Level;
  concern: string;
  portionNote: string;
  evidence: Evidence;
  citation: Citation;
};

export type WarningCard = {
  ruleId: string;
  /** Rule ids merged into this card (same nutrient), excluding `ruleId`. */
  mergedFrom: string[];
  /** Same-nutrient rules absorbed into this card, each with its own concern, note and citation. */
  merged: MergedClaim[];
  level: Level;
  title: string;
  concern: string;
  cause: string;
  evidence: Evidence;
  horizon: Horizon;
  portionNote: string;
  alternatives: Alternative[];
  nutrientKey?: NutrientKey;
  /** Set when an input was only partly known, so the number may be understated. */
  dataNote?: string;
};

export type SafetyQuestion = { ruleId: string; question: string; answerKey: string };

/** A rule that could not run. Reported, never silently dropped and never blocking: the caller shows it. */
export type RuleFailure = { ruleId: string; category: 'nutrition' | 'safety'; message: string };
