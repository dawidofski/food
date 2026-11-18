/** A parsed amount. Weight/volume units set `grams`; kitchen units set `count` + `unitLabel` only. */
export type Quantity = { count?: number; grams?: number; unitLabel?: string };

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, half: 0.5,
  // Spanish, because the owner shops and eats in Spain and a packet in his hand is in Spanish. These cost
  // nothing and work with no key and no network, which the AI fallback cannot claim. Only the amount words
  // are here: units (g, ml, kg) are already language-neutral, and a decimal comma already parses.
  cero: 0, uno: 1, una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
  // `once` (11) and `doce` (12) are deliberately absent: `once` is an ordinary English word, and "once a
  // day" parsing as eleven is a worse error than someone writing 11 when they mean eleven.
  nueve: 9, diez: 10, medio: 0.5, media: 0.5,
};

/** Spanish words that mean "half", which take an article after them exactly as "half" does. */
const HALF_WORDS = new Set(['half', 'medio', 'media']);

// Weight and volume units convert straight to grams. ml and l are treated as grams 1:1: exact for
// water-like liquids and close enough for the rest (milk, juice, cola). Density is not modelled.
const GRAM_UNITS: Record<string, number> = {
  g: 1, gram: 1, grams: 1, kg: 1000, kilogram: 1000, kilograms: 1000,
  ml: 1, millilitre: 1, millilitres: 1, milliliter: 1, milliliters: 1,
  l: 1000, litre: 1000, litres: 1000, liter: 1000, liters: 1000,
};

// Kitchen units have NO gram weight here: a tablespoon of oil and of flour differ in mass, so the
// weight comes from the food's own portion rows later.
const KITCHEN_UNITS: Record<string, string> = {
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  cup: 'cup', cups: 'cup',
  slice: 'slice', slices: 'slice',
  piece: 'piece', pieces: 'piece',
  glass: 'glass', glasses: 'glass',
};

// Numbers: decimal point or decimal comma ("1.5", "1,5"), and fractions.
// A comma between digits is ALWAYS a decimal separator, never a thousands separator. This app treats
// it that way because its user writes a decimal comma: "1,500 kg" means 1.5 kg, and "1,000 g" reads as 1 g.
// Do not "helpfully" restore thousands handling: understating a gram count is far safer than
// inflating one 1000x, and nobody types 1,000 g for a kilo.
const NUMERIC = /^(-?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:\/\d+(?:\.\d+)?)?)/;
const MIXED = /^(-?\d+) (\d+)\/(\d+)(?![\d.\/])/;
const WORD_NUM = new RegExp(`^(${Object.keys(NUMBER_WORDS).join('|')})(?![a-z])`);
const UNIT = /^\s*([a-z]+)(?![a-z])/;

function parseNumeric(token: string): number | null {
  const [a, b] = token.split('/');
  const plain = a!.replace(',', '.');
  const n = Number(plain);
  if (b === undefined) return Number.isFinite(n) ? n : null;
  const d = Number(b);
  if (d === 0) return null;
  const v = n / d;
  return Number.isFinite(v) ? v : null;
}

function finish(count: number, after: string): { quantity: Quantity; rest: string } | null {
  const u = UNIT.exec(after);
  if (u) {
    const word = u[1]!;
    const factor = GRAM_UNITS[word];
    if (factor !== undefined) {
      const grams = count * factor;
      if (!Number.isFinite(grams)) return null;
      return { quantity: { grams }, rest: stripOf(after.slice(u[0].length)) };
    }
    const label = KITCHEN_UNITS[word];
    if (label !== undefined) {
      return { quantity: { count, unitLabel: label }, rest: stripOf(after.slice(u[0].length)) };
    }
  }
  return { quantity: { count }, rest: after.trim() };
}

/**
 * Drops the preposition between an amount and the food: "200 g of chicken", "200 g de pollo".
 *
 * `de` is here beside `of` because the common Spanish form is a digit, a metric unit, `de`, then the food —
 * which is the path every Spanish entry takes, metric units being language-neutral. It must be followed by
 * whitespace, so the `de` of an English hyphenated word ("two de-boned thighs") is left alone.
 */
function stripOf(s: string): string {
  return s.trim().replace(/^(of|de)\s+/, '').trim();
}

/** Reads a leading quantity. Returns null when the text does not start with one (or it is malformed). */
export function parseQuantity(text: string): { quantity: Quantity; rest: string } | null {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return null;

  // Mixed fraction first: "1 1/2 cups".
  const mixed = MIXED.exec(t);
  if (mixed) {
    const d = Number(mixed[3]);
    if (d === 0 || t[mixed[0].length] === '%') return null;
    const whole = Number(mixed[1]);
    const frac = Number(mixed[2]) / d;
    const n = (mixed[1]!.startsWith('-') ? -1 : 1) * (Math.abs(whole) + frac);
    return Number.isFinite(n) ? finish(n, t.slice(mixed[0].length)) : null;
  }

  const num = NUMERIC.exec(t);
  if (num) {
    // "2% milk", "100% orange juice": the number names the food, it is not a quantity.
    if (t[num[0].length] === '%') return null;
    const n = parseNumeric(num[1]!);
    return n === null ? null : finish(n, t.slice(num[0].length));
  }

  const word = WORD_NUM.exec(t);
  if (word) {
    let after = t.slice(word[0].length);
    // "half a banana" / "medio un aguacate": the article after a half-word is not part of the food.
    if (HALF_WORDS.has(word[1] ?? '')) after = after.replace(/^\s+(an?|el|la|un|una|de)(?![a-z])/, '');

    return finish(NUMBER_WORDS[word[1]!]!, after);
  }

  const article = /^an?(?= )/.exec(t);
  if (article) {
    const after = t.slice(article[0].length);
    // "a half" means 0.5, not one item called "half".
    const half = /^\s+half(?![a-z])/.exec(after);
    if (half) return finish(0.5, after.slice(half[0].length));
    return finish(1, after);
  }
  return null;
}
