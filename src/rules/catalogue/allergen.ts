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
 * Tags use the EU group names, plural ("peanuts", "nuts"). People type "peanut" or "tree nuts". Fold case, plural and a
 * leading "tree " so that a flag the user meant is never missed. Folding errs toward matching: the cost of an extra card
 * for someone who flagged that allergen is small, and the cost of a missed one is the worst this app can produce.
 */
export function foldAllergen(s: string): string {
  return s.trim().toLowerCase().replace(/^tree\s+/, '').replace(/s$/, '');
}

type Hit = { food: FoodIdentity; tags: string[] };

function hits(ctx: Context): Hit[] {
  const flagged = new Set((ctx.profile?.flaggedAllergens ?? []).map(foldAllergen).filter((f) => f !== ''));
  if (flagged.size === 0) return [];
  const out: Hit[] = [];
  for (const food of ctx.foods) {
    const tags = food.allergens.filter((t) => flagged.has(foldAllergen(t)));
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
    if (h.length === 0) return 'No food in this entry carries a tag matching an allergen you flagged. That is not a statement that none is present.';
    return h
      .map(({ food, tags }) =>
        food.source === 'custom'
          ? `${food.name}: you set the tag ${tags.join(', ')} on this custom food, so this is your own statement.`
          : `${food.name}: tagged ${tags.join(', ')}. The tag is indicative and the food may contain more than it lists.`,
      )
      .join(' ');
  },
};
