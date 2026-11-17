import type { FoodLookup } from '@/domain/foodLookup';
import type { DatasetFood } from '@/types/food';
import type { ParsedItem } from '@/domain/parseEntry';
import { parseQuantity, type Quantity } from '@/domain/quantity';
import { resolveItems } from '@/domain/resolveItems';
import type { Resolution } from '@/types/diary';
import type { AiFailure, AiSuggestion, InterpretOptions } from '@/ai/deepseek';

/** What the flow needs from the AI path, injectable so tests never touch the network or localStorage. */
export type AiDeps = {
  isEnabled: () => boolean;
  getKey: () => string | null;
  isOnline: () => boolean;
  interpret: (text: string, opts: InterpretOptions) => Promise<AiSuggestion[]>;
};

/** One unresolved phrase, the model's plain-English description of it, and the dataset foods that description landed on. */
export type AiReading = { phrase: string; description: string; reads: string[] };

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

const STOPWORDS = new Set(['the', 'and', 'with', 'for', 'from', 'made', 'type', 'kind', 'style']);

type Seen = { food: DatasetFood; covered: Set<string> };

/**
 * Step two: OUR search, not the model's choice. The description is plain words from the model, used
 * only as search terms against the bundled dataset (never as a food id or a number). The search
 * needs every query word in a food's name, so a long description rarely matches whole; each word is
 * searched on its own and the food covering the most description words wins, ties going to the
 * food that also matches the last word (the head noun: "...pork sausage" is a sausage), then to
 * the shorter name. Custom foods and batches are never candidates for an AI reading.
 */
export function findFoodByDescription(description: string, lookup: FoodLookup): DatasetFood | null {
  const whole = lookup.search(description, 5).find((h) => h.source === 'dataset');
  if (whole) return whole.food;
  const words = [...new Set(description.toLowerCase().match(/[a-z]{3,}/g) ?? [])].filter((w) => !STOPWORDS.has(w));
  if (words.length === 0) return null;
  const head = words[words.length - 1]!;
  const seen = new Map<string, Seen>();
  for (const w of words) {
    for (const h of lookup.search(w, 15)) {
      if (h.source !== 'dataset') continue;
      const e = seen.get(h.food.id) ?? { food: h.food, covered: new Set<string>() };
      e.covered.add(w);
      seen.set(h.food.id, e);
    }
  }
  let best: Seen | null = null;
  const better = (e: Seen, b: Seen): boolean => {
    if (e.covered.size !== b.covered.size) return e.covered.size > b.covered.size;
    if (e.covered.has(head) !== b.covered.has(head)) return e.covered.has(head);
    return e.food.name.length < b.food.name.length;
  };
  for (const e of seen.values()) if (best === null || better(e, best)) best = e;
  return best?.food ?? null;
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
 * Asks the model to DESCRIBE each unresolved phrase (or the whole text, when nothing parsed at all),
 * searches the dataset ourselves with that description, and folds anything that resolves back into
 * the items. Returns null when the AI path adds nothing (off, offline, nothing usable came back).
 * Nothing here reads a nutrient or a food choice from the model: each description is looked up in
 * the bundled dataset and the ordinary resolveItems turns the found food into grams and nutrients.
 */
export async function applyAi(
  text: string,
  items: ParsedItem[],
  resolution: Resolution,
  lookup: FoodLookup,
  ai: AiDeps | undefined,
  onFailure?: (f: AiFailure) => void,
): Promise<AiApplied | null> {
  if (!ai || !ai.isEnabled() || !ai.isOnline()) return null;
  const key = ai.getKey();
  if (!key) return null;
  // Nothing parsed at all is the most unresolvable case: the whole text is the unresolved phrase.
  const nothingParsed = items.length === 0 && /\p{L}{2,}/u.test(text);
  const targets: { key: ParsedItem | null; phrase: string }[] = nothingParsed
    ? [{ key: null, phrase: text.trim() }]
    : shouldEngage(resolution) ? unresolvedPhrases(resolution).map((i) => ({ key: i, phrase: i.rawFragment })) : [];
  if (targets.length === 0) return null;

  const base = pinned(lookup);
  const replacements = new Map<ParsedItem, ParsedItem[]>();
  const added: ParsedItem[] = [];
  const readings: AiReading[] = [];
  for (const target of targets) {
    const suggestions = await ai.interpret(target.phrase, { apiKey: key, ...(onFailure ? { onFailure } : {}) });
    const accepted: ParsedItem[] = [];
    const reads: string[] = [];
    const described: string[] = [];
    for (const s of suggestions) {
      const found = findFoodByDescription(s.description, lookup);
      if (!found) continue;
      const { quantity, label } = toQuantity(s);
      const item: ParsedItem = { rawFragment: target.phrase, quantity, foodQuery: found.name };
      // Keep only what the dataset can actually resolve; the rest stays unresolved for manual entry.
      if (resolveItems([item], base).needsHelp.length > 0) continue;
      accepted.push(item);
      reads.push(`${label} ${found.name}`);
      described.push(s.description);
    }
    if (accepted.length === 0) continue;
    if (target.key) replacements.set(target.key, accepted);
    else added.push(...accepted);
    readings.push({ phrase: target.phrase, description: described.join('; '), reads });
  }
  if (readings.length === 0) return null;
  const merged = [...items.flatMap((i) => replacements.get(i) ?? [i]), ...added];
  return { items: merged, resolution: resolveItems(merged, base), readings };
}
