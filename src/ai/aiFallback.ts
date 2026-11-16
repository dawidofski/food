import type { FoodLookup } from '@/domain/foodLookup';
import type { ParsedItem } from '@/domain/parseEntry';
import { parseQuantity, type Quantity } from '@/domain/quantity';
import { resolveItems } from '@/domain/resolveItems';
import type { Resolution } from '@/types/diary';
import type { AiSuggestion, InterpretOptions } from '@/ai/deepseek';

/** What the flow needs from the AI path, injectable so tests never touch the network or localStorage. */
export type AiDeps = {
  isEnabled: () => boolean;
  getKey: () => string | null;
  isOnline: () => boolean;
  interpret: (text: string, candidates: string[], opts: InterpretOptions) => Promise<AiSuggestion[]>;
};

/** One unresolved phrase and how the model read it, for the person to check before any rule runs. */
export type AiReading = { phrase: string; reads: string[] };

export type AiApplied = { items: ParsedItem[]; resolution: Resolution; readings: AiReading[] };

/**
 * A resolution is "low confidence" below this. NOTE this does no real work: the search requires
 * every query token to appear in a food's name and has no length normalisation, so any real match
 * scores ~0.03 (confidence ~1) and a non-match returns nothing at all. Confidence therefore does
 * not separate good matches from bad ones. The real trigger is `needsHelp` (see `unresolvedPhrases`);
 * this is kept only as a cheap secondary guard should the search ever start returning weak hits.
 */
export const LOW_CONFIDENCE = 0.6;

/**
 * Whether to engage at all. The trigger is `needsHelp` being non-empty: the phrase genuinely did
 * not resolve. The confidence clause is a secondary guard only (see LOW_CONFIDENCE).
 */
export function shouldEngage(res: Resolution): boolean {
  return res.needsHelp.length > 0 || (res.refs.length > 0 && res.confidence < LOW_CONFIDENCE);
}

/** The phrases worth sending: only items that did not resolve. Never the whole entry, never a resolved item. */
export const unresolvedPhrases = (res: Resolution): ParsedItem[] => res.needsHelp;

// Broad dataset queries so the model has real names to choose from even when the person's word
// (a Dutch snack, a brand) shares no token with any dataset entry. Names only; no user data.
const BROAD_QUERIES = [
  'sausage', 'frankfurter', 'beef', 'pork', 'chicken', 'fish', 'cheese', 'bread', 'pasta', 'rice',
  'potato', 'soup', 'salad', 'pastry', 'cake', 'cookie', 'sandwich', 'pizza',
];
const MAX_SHORTLIST = 40;
const MAX_TOKEN_NAMES = 20;

/** Dataset food names to offer the model. Custom foods and batches are the person's own and never leave the device. */
export function shortlist(phrase: string, lookup: FoodLookup): string[] {
  const names = new Set<string>();
  const add = (q: string, limit: number, cap: number) => {
    for (const h of lookup.search(q, limit)) {
      if (h.source === 'dataset' && names.size < cap) names.add(h.food.name);
    }
  };
  const words = phrase.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  for (const w of new Set(words)) add(w, 6, MAX_TOKEN_NAMES);
  for (const q of BROAD_QUERIES) add(q, 2, MAX_SHORTLIST);
  return [...names];
}

// Words that mean "one of it", not a measure the dataset has a portion row for. "1 piece" must not
// demand a portion labelled "piece": it is a bare count, and the ordinary serving rules pick the weight.
const COUNT_WORDS = new Set(['piece', 'pieces', 'item', 'items', 'serving', 'servings', 'portion', 'portions', 'each', 'unit', 'units', 'whole']);

function toQuantity(s: AiSuggestion): { quantity: Quantity; label: string } {
  const label = `${s.quantity} ${s.unit}`;
  if (COUNT_WORDS.has(s.unit)) return { quantity: { count: s.quantity }, label };
  const parsed = parseQuantity(label);
  // A recognised unit (g, ml, tbsp, slice...) converts; any other word is a bare count.
  return { quantity: parsed !== null && parsed.rest === '' ? parsed.quantity : { count: s.quantity }, label };
}

/** Resolves a suggested dataset NAME to exactly that dataset food, so the number comes from that entry and no other. */
function pinned(base: FoodLookup): FoodLookup {
  return {
    get: (source, id) => base.get(source, id),
    search: (query, limit) => {
      const hits = base.search(query, Math.max(limit ?? 10, 50));
      const exact = hits.filter((h) => h.source === 'dataset' && h.food.name === query);
      return (exact.length > 0 ? exact : hits).slice(0, limit ?? 10);
    },
  };
}

/**
 * Asks the model about each unresolved phrase and folds anything that resolves back into the
 * items. Returns null when the AI path adds nothing (off, offline, no suggestion survived).
 * Nothing here reads a nutrient from the model: each suggestion becomes a ParsedItem that the
 * ordinary resolveItems turns into grams and nutrients from the bundled dataset.
 */
export async function applyAi(
  items: ParsedItem[],
  resolution: Resolution,
  lookup: FoodLookup,
  ai: AiDeps | undefined,
): Promise<AiApplied | null> {
  if (!ai || !ai.isEnabled() || !ai.isOnline()) return null;
  const key = ai.getKey();
  const targets = unresolvedPhrases(resolution);
  if (!key || !shouldEngage(resolution) || targets.length === 0) return null;

  const base = pinned(lookup);
  const replacements = new Map<ParsedItem, ParsedItem[]>();
  const readings: AiReading[] = [];
  for (const target of targets) {
    const suggestions = await ai.interpret(target.rawFragment, shortlist(target.rawFragment, lookup), { apiKey: key });
    const accepted: ParsedItem[] = [];
    const reads: string[] = [];
    for (const s of suggestions) {
      const { quantity, label } = toQuantity(s);
      const item: ParsedItem = { rawFragment: target.rawFragment, quantity, foodQuery: s.candidateName };
      // Keep only what the dataset can actually resolve; the rest stays unresolved for manual entry.
      if (resolveItems([item], base).needsHelp.length > 0) continue;
      accepted.push(item);
      reads.push(`${label} ${s.candidateName}`);
    }
    if (accepted.length > 0) {
      replacements.set(target, accepted);
      readings.push({ phrase: target.rawFragment, reads });
    }
  }
  if (replacements.size === 0) return null;
  const merged = items.flatMap((i) => replacements.get(i) ?? [i]);
  return { items: merged, resolution: resolveItems(merged, base), readings };
}
