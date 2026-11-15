import { parseQuantity, type Quantity } from '@/domain/quantity';

export type ParsedItem = { rawFragment: string; quantity: Quantity; foodQuery: string };

const MAX_INPUT = 1000;
const MAX_UNPARSEABLE = 100;

const FILLER = /^(?:(?:i|we)(?:'ve| have)?\s+)?(?:just\s+|also\s+)?(?:ate|eaten|had|drank|drunk|consumed|eat|drink|have)\s+/;
const SPLIT = /\s*[,;+\n\r]\s*/;

// Compound dish names that contain " and " but are ONE food. Splitting on " and " is right by
// default ("eggs and bacon" is two foods), so add dishes here when they would be torn apart.
// Matched case-insensitively as whole words inside a segment. Commas, "+" and newlines always split.
const COMPOUND_FOODS = [
  'mac and cheese', 'macaroni and cheese', 'salt and pepper', 'fish and chips', 'bangers and mash',
  'oil and vinegar', 'peaches and cream', 'biscuits and gravy', 'chicken and rice', 'beans and rice',
  'ham and cheese', 'surf and turf',
];
const COMPOUND_RE = new RegExp(String.raw`(?<!\p{L})(?:${COMPOUND_FOODS.join('|')})(?!\p{L})`, 'giu');
const GLUE = '\u0001';

function splitSegment(segment: string): string[] {
  const protectedText = segment.replace(COMPOUND_RE, (m) => m.replace(/ and /gi, `${GLUE}and${GLUE}`));
  return protectedText.split(/\s+and\s+/).map((p) => p.split(GLUE).join(' '));
}

// No judgement here on whether a word names a food: without the dataset a nonsense word cannot be
// told from a brand name or loanword. Task 7 resolves phrases and routes misses to needsHelp.
// This layer only requires that the phrase contains at least one letter or digit.
function plausibleFood(q: string): boolean {
  return /[\p{L}\p{N}]/u.test(q);
}

function stripFiller(s: string): string {
  let out = s;
  for (let i = 0; i < 3; i++) {
    const next = out.replace(/^and\s+/, '').replace(FILLER, '');
    if (next === out) break;
    out = next;
  }
  return out.trim();
}

export function parseEntry(text: string): { items: ParsedItem[]; unparseable: string[] } {
  const items: ParsedItem[] = [];
  const unparseable: string[] = [];
  const t = text.slice(0, MAX_INPUT).toLowerCase().replace(/[ \t]+/g, ' ').trim();

  for (const piece of stripFiller(t).split(SPLIT).flatMap(splitSegment)) {
    const fragment = stripFiller(piece.trim());
    if (!fragment) continue;
    const parsed = parseQuantity(fragment);
    const quantity: Quantity = parsed ? parsed.quantity : { count: 1 };
    const foodQuery = (parsed ? parsed.rest : fragment).replace(/[.!?]+$/, '').trim();
    if (plausibleFood(foodQuery)) items.push({ rawFragment: fragment, quantity, foodQuery });
    else unparseable.push(fragment.slice(0, MAX_UNPARSEABLE));
  }
  return { items, unparseable };
}
