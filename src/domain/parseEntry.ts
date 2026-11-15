import { parseQuantity, type Quantity } from '@/domain/quantity';

export type ParsedItem = { rawFragment: string; quantity: Quantity; foodQuery: string };

const MAX_INPUT = 1000;
const MAX_QUERY = 100;

const FILLER = /^(?:(?:i|we)(?:'ve| have)?\s+)?(?:just\s+|also\s+)?(?:ate|eaten|had|drank|drunk|consumed|eat|drink|have)\s+/;
const SPLIT = /\s*[,;+\n\r]\s*|\s+and\s+/;

// Keyboard-row runs and single-letter runs are how people mash keys ("asdf", "xxxx"). With no
// dataset here this is the only signal available for gibberish; Task 7 handles real misses.
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
function isMash(word: string): boolean {
  if (/(.)\1{3,}/.test(word)) return true;
  const w = word.replace(/[^a-z]/g, '');
  if (w.length < 4) return false;
  return ROWS.some((r) => {
    const rev = [...r].reverse().join('');
    return r.includes(w) || rev.includes(w);
  });
}

function plausibleFood(q: string): boolean {
  if (!/\p{L}/u.test(q) || q.length > MAX_QUERY) return false;
  const words = q.split(/[^\p{L}]+/u).filter(Boolean);
  return words.some((w) => !isMash(w));
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

  for (const piece of stripFiller(t).split(SPLIT)) {
    const fragment = stripFiller(piece.trim());
    if (!fragment) continue;
    const parsed = parseQuantity(fragment);
    const quantity: Quantity = parsed ? parsed.quantity : { count: 1 };
    const foodQuery = (parsed ? parsed.rest : fragment).replace(/[.!?]+$/, '').trim();
    if (plausibleFood(foodQuery)) items.push({ rawFragment: fragment, quantity, foodQuery });
    else unparseable.push(fragment.slice(0, MAX_QUERY));
  }
  return { items, unparseable };
}
