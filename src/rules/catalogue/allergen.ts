import type { Citation, Context, Evidence, FoodIdentity, Rule } from '../types';

/**
 * Authority: the user's own flag. An allergen card is CRITICAL because the person told the app they react to the
 * allergen, which is definitional, not evidential. It borrows no study's weight, so it declares
 * `safetyAuthority: 'user-flag'` and says so in its text. Safety rules are exempt from the evidence ceiling (engine.ts);
 * exempt is not exempt from saying why.
 *
 * The one sourced claim on the card is the advice to check labels: NHS, "Food allergy", read at source 2026-11-16 ("You
 * can manage a food allergy by checking food labels carefully ..."). The year is the access year, as for WCRF in
 * the classification rules, because the page carries no publication year.
 *
 * THE LOAD-BEARING SENTENCE. The dataset's allergen tags were derived from food category and description and are
 * incomplete (public/data/meta.json: of 5,431 foods, 2,942 carry tags, and "Bacon bits" carries none). So this rule
 * can only ever say "a tag lists this allergen"; it can never say "no tag, so none". Three consequences, all pinned in
 * tests: the card says "may be present" and "check the label"; it says outright that a missing tag does not mean a food
 * is free of the allergen; and the rule is silent when no tag matches, which is the absence of a card, not a claim.
 * Whatever shows this to the user MUST NOT render silence as "no allergens found" or "allergen-free".
 *
 * Shipped default: the flagged list (Profile.flaggedAllergens) is empty, so the rule is silent. Adding an allergen later
 * is a profile edit; no migration, because every dataset food already carries `allergens: string[]`.
 *
 * Reads identity and the profile, not a nutrient, so it declares no requiresNutrients and the coverage gate does not
 * protect it.
 */
const citation: Citation = {
  title: 'Food allergy',
  publisher: 'NHS',
  year: 2026,
  url: 'https://www.nhs.uk/conditions/food-allergy/',
  conclusion:
    'You can manage a food allergy by checking food labels carefully, carrying emergency medicine at all times, and telling people about your allergy. ' +
    "Do: check food labels and restaurant menus carefully to make sure they do not contain the food you're allergic to.",
};

const evidence: Evidence = {
  strength: 'strong',
  body: 'Your own allergen flag',
  summary:
    'The authority for this card is your own allergen flag, not a study: you told the app you react to this allergen. ' +
    'The NHS advises people with a food allergy to check food labels carefully, which is the one step this card asks for.',
  citation,
  isAssociational: false,
};

/**
 * The dataset's tags are the EU's 14 groups under their own names (scripts/classification.ts EU_ALLERGENS): gluten,
 * crustaceans, eggs, fish, peanuts, soybeans, milk, nuts, celery, mustard, sesame, sulphites, lupin, molluscs. People
 * type the ordinary word for their own allergy: "soy", "shellfish", "dairy", "wheat". A flag that does not reach a tag is
 * a missed allergen, the worst outcome this app can produce, so each ordinary word maps to the tag(s) it means, and a flag
 * that maps to nothing is REPORTED as a failure (`cannotCheck`), never left silent.
 *
 * Mappings err toward matching: "wheat" maps to the gluten tag although a wheat allergy is not coeliac disease, because the
 * dataset has no finer tag and an extra card for someone who flagged wheat costs far less than a missed one.
 */
const fold = (s: string): string => s.trim().toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');
/** Singular form of a tag or flag, so "peanut" and "peanuts" meet. */
const singular = (s: string): string => s.replace(/s$/, '');

/** Folded, singular tag -> itself; each synonym -> the folded, singular dataset tag(s) it means. */
const CANONICAL = ['gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soybeans', 'milk', 'nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs'].map(singular);
const SYNONYMS: Record<string, string[]> = {
  soy: ['soybean'], soya: ['soybean'], shellfish: ['crustacean', 'mollusc'], mollusk: ['mollusc'],
  dairy: ['milk'], "cow's milk": ['milk'], 'cows milk': ['milk'], lactose: ['milk'],
  wheat: ['gluten'], barley: ['gluten'], rye: ['gluten'], oat: ['gluten'], 'cereals containing gluten': ['gluten'],
  groundnut: ['peanut'], 'tree nut': ['nut'], almond: ['nut'], hazelnut: ['nut'], walnut: ['nut'], cashew: ['nut'],
  pecan: ['nut'], pistachio: ['nut'], 'brazil nut': ['nut'], macadamia: ['nut'],
  sulfite: ['sulphite'], seafood: ['fish', 'crustacean', 'mollusc'], finfish: ['fish'], 'sesame seed': ['sesame'],
};

/** The folded, singular dataset tags a typed flag stands for. Always includes the flag itself, so a custom tag still matches. */
export function expandAllergenFlag(flag: string): string[] {
  const key = singular(fold(flag));
  return key === '' ? [] : [...new Set([key, ...(SYNONYMS[key] ?? [])])];
}

/** Flags that reach none of the dataset's tags and are not a known synonym. They can still match a custom food's own tag. */
export function unrecognisedAllergenFlags(flagged: string[]): string[] {
  return flagged
    .filter((f) => f.trim() !== '')
    .filter((f) => !expandAllergenFlag(f).some((t) => CANONICAL.includes(t)))
    .map((f) => f.trim());
}

type Hit = { food: FoodIdentity; tags: string[] };

/**
 * Foods whose allergen list came from Open Food Facts. Crowdsourced: anyone may edit a product, and the allergen
 * list is EMPTY for a great many products that do contain the allergen. The dataset's own tags already carry this
 * caveat (see THE LOAD-BEARING SENTENCE above); for a scanned product it is stronger still, because nobody at all
 * has to have looked at the packet.
 *
 * Silence would read as "checked, nothing found" at the gate, so a flagged allergen plus a scanned food is always
 * reported through `cannotCheck`, whether or not a tag happened to match. That is the project's standing choice:
 * a check that could not be made is reported, never left to look like a clean result.
 */
function scannedFoods(ctx: Context): FoodIdentity[] {
  return ctx.foods.filter((f) => f.source === 'off');
}

function hits(ctx: Context): Hit[] {
  const flagged = new Set((ctx.profile?.flaggedAllergens ?? []).flatMap(expandAllergenFlag));
  if (flagged.size === 0) return [];
  const out: Hit[] = [];
  for (const food of ctx.foods) {
    const tags = food.allergens.filter((t) => flagged.has(singular(fold(t))));
    if (tags.length > 0) out.push({ food, tags });
  }
  return out;
}

export const allergenRule: Rule = {
  id: 'allergen-flagged',
  title: 'Flagged allergen',
  category: 'safety',
  safetyAuthority: 'user-flag',
  // There is a check to fail only when the user flagged something; at the shipped default (empty list) there is nothing to run.
  cannotCheck: (ctx) => {
    const flagged = (ctx.profile?.flaggedAllergens ?? []).filter((f) => f.trim() !== '');
    if (flagged.length === 0) return null;
    const parts: string[] = [];
    const bad = unrecognisedAllergenFlags(flagged);
    if (bad.length > 0) {
      parts.push(
        `could not check ${bad.map((b) => `"${b}"`).join(', ')}: ${bad.length === 1 ? 'it is' : 'they are'} not an allergen the app has tags for, so foods are not checked against ${bad.length === 1 ? 'it' : 'them'}. Check labels yourself.`,
      );
    }
    // Reported whether or not a tag matched: an empty Open Food Facts allergen list is not an all-clear.
    const scanned = scannedFoods(ctx);
    if (scanned.length > 0) {
      parts.push(
        `could not fully check ${scanned.map((f) => f.name).join(', ')}: the allergen list for a scanned product comes from Open Food Facts, where anyone can edit it and where products that do contain an allergen often list none. Read the packet yourself before you eat it.`,
      );
    }
    return parts.length === 0 ? null : parts.map((p) => `rule "allergen-flagged" ${p}`).join(' ');
  },
  identityRequired: (ctx) => (ctx.profile?.flaggedAllergens ?? []).some((f) => f.trim() !== ''),
  scope: 'entry',
  // Reads food identity and the profile, not a nutrient: the coverage gate does not protect this rule.
  requiresNutrients: [],
  horizon: 'occasional',
  evidence,
  concern:
    'This entry includes a food tagged as possibly containing an allergen you flagged, so the allergen may be present. ' +
    "Allergen tags in this app are indicative: they were derived from each food's category and description, and they are incomplete. " +
    'Check the product label, or ask whoever prepared the food, before you eat it. ' +
    'A missing tag does not mean a food is free of an allergen, and this app cannot tell you that a food is free of one.',
  cause:
    'You told the app you react to this allergen, and the food is tagged with it. ' +
    'This card rests on your own flag, not on a study.',
  level: (ctx) => (hits(ctx).length > 0 ? 'CRITICAL' : null),
  portionNote: (ctx) => {
    const h = hits(ctx);
    if (h.length === 0) {
      return scannedFoods(ctx).length > 0
        ? 'No food in this entry carries a tag matching an allergen you flagged, and a scanned product’s allergen list comes from Open Food Facts and is often empty for products that do contain one. That is not a statement that none is present.'
        : 'No food in this entry carries a tag matching an allergen you flagged. That is not a statement that none is present.';
    }
    return h
      .map(({ food, tags }) => {
        if (food.source === 'custom') return `${food.name}: you set the tag ${tags.join(', ')} on this custom food, so this is your own statement.`;
        if (food.source === 'off') {
          return `${food.name}: Open Food Facts lists ${tags.join(', ')} for this product. That list is contributed by the public, not measured, and may name less than the packet does.`;
        }
        return `${food.name}: tagged ${tags.join(', ')}. The tag is indicative and the food may contain more than it lists.`;
      })
      .join(' ');
  },
};
