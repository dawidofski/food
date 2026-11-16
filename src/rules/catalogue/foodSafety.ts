import type { Citation, Context, Rule, SafetyQuestion } from '../types';
import { evaluate } from '../engine';

/**
 * Food-handling hazards. Authority: a food-safety body's published advice (FSA or FDA), cited per hazard.
 *
 * THE DESIGN RULE. Whether rice was held warm or beans were raw is a fact about the person's kitchen, not about a USDA
 * food identity, and guessing it from the user's text would put false positives on the one tier that cannot be
 * collapsed. So each hazard (1) matches only on the RESOLVED FOOD'S NAME (`ctx.foods`), never on `ctx.rawText`; (2) asks
 * one direct question through the engine's safety-prompt mechanism; (3) raises CRITICAL only on an explicit yes. No
 * question, no card; unanswered, no card; answered no, no card and no repeated question.
 *
 * RAW EGGS ARE DELIBERATELY NOT A HAZARD HERE. The FDA advises against raw or undercooked eggs, but the UK FSA (2017)
 * treats Lion-marked runny eggs as low risk, and the owner is in the EU, where salmonella controls are
 * comparable to the UK's. A CRITICAL card, which cannot be collapsed, on a soft-boiled egg or homemade mayonnaise would
 * teach the user to dismiss the tier the allergen card depends on. The hazard is real for some people (pregnancy,
 * immunosuppression). The hook to re-add it is `Profile.conditions`: when such a condition is flagged, add a hazard
 * with the FDA egg-safety citation (see the verification log) and gate it on that condition. Rice, kidney beans
 * and raw milk are hazards regardless of jurisdiction and stay.
 *
 * RAW SPROUTS ARE ALSO NOT A HAZARD HERE, for the same reason. The FDA's advice to skip raw or lightly cooked sprouts is
 * addressed to people more vulnerable to foodborne illness, and the card cannot say who that is. A healthy person logging bean
 * sprouts on pho would answer yes honestly and get a red card that cannot be collapsed. Same hook: `Profile.conditions`;
 * when pregnancy, immunosuppression or similar is flagged, re-add a sprouts hazard (FDA, "Selecting and Serving Produce
 * Safely", see the verification log) gated on it.
 *
 * RICE QUESTION FATIGUE. The rice pattern matches 146 dataset foods, so the question appears on nearly every rice entry. It
 * asks about the thing the FSA page is about (cooked rice standing at room temperature) and not a rice cooker's keep-warm
 * setting, so for most entries the answer is an instant no. On this tier credibility depends on rarity; this is the most
 * exposed surface in the catalogue and should be revisited if users find the question tiresome.
 *
 * Matching is deliberately narrow and anchored at the start of the name, so look-alikes ("Kidney", "Brussels sprouts",
 * "Rice milk", "Eggnog") do not ask. The cost is a false negative for foods the patterns do not name, such as a mixed dish
 * that contains rice: the card is silent there, which is the safe direction for a tier that must stay trustworthy, and
 * this list is not an exhaustive hazard screen. Cheese and other dairy are not matched: the cited page concerns raw milk
 * and nothing in it supports a claim about cheese.
 *
 * These rules read identity and answers, not nutrients, so `requiresNutrients` is empty and the coverage gate does NOT
 * protect them. Their protection is the identity match plus the answer.
 *
 * Every hazard sentence and every action below restates its citation's conclusion and adds nothing. Each source was
 * read at the publisher's own page on 2026-11-16 (spec "Verification log", Task 13). Years are the page's published
 * or current-as-of year. Nothing here says what to do with a serving already eaten: none of the sources do, so the card
 * states the hazard and the source's own handling advice.
 */
export type Hazard = {
  id: string;
  title: string;
  foodMatch: RegExp;
  questionId: string;
  question: string;
  /** What the source says the hazard is, in the app's plain voice. */
  hazard: string;
  /** What the source says to do. */
  action: string;
  citation: Citation;
};

const fsa = 'Food Standards Agency (FSA)';
const fda = 'U.S. Food and Drug Administration (FDA)';

export const HAZARDS: Hazard[] = [
  {
    id: 'food-safety-rice',
    title: 'Rice held warm or cooled slowly',
    foodMatch: /^(?:fried rice|rice)\b(?!\s+(?:cake|croquette|dessert|dressing|milk|noodles?|paper|pudding|krispie|cereal|flour))/i,
    questionId: 'reheatedRice',
    question: 'Was this rice left at room temperature for more than an hour or two before it was chilled or reheated?',
    hazard:
      'The FSA says uncooked rice can contain spores of a bacterium called Bacillus cereus, that this bacteria can cause food poisoning, ' +
      'and that the spores can survive cooking. The longer cooked rice is left at room temperature, the more likely it is that the bacteria or toxins will make the rice a food-poisoning risk.',
    action:
      'The FSA advises chilling leftover rice as quickly as possible, ideally within one hour, and reheating it only once, until it is steaming hot all the way through.',
    citation: {
      title: 'Home food fact checker',
      publisher: fsa,
      year: 2020,
      url: 'https://www.food.gov.uk/safety-hygiene/home-food-fact-checker',
      conclusion:
        'Uncooked rice can contain spores of a bacterium called Bacillus cereus. This bacteria can cause food poisoning. ' +
        'The spores of Bacillus cereus can survive being cooked. The longer cooked rice is left at room temperature, the more likely it is that the bacteria or toxins will make the rice unsafe to eat. ' +
        'Yes, but you should never reheat rice more than once. And when you do reheat rice, make sure it is steaming hot all the way through. ' +
        'If you have leftover rice you should chill it as quickly as possible, ideally within one hour.',
    },
  },
  {
    id: 'food-safety-kidney-beans',
    title: 'Raw or undercooked kidney beans',
    // Plain bean identities only ("Kidney beans, from dried ...", "Kidney beans, NFS"); "Kidney beans with meat" and "Kidney beans and rice" are cooked dishes and do not ask.
    // Dried-bean identities only. The FDA page says canned and properly cooked kidney beans are low in the lectin, so
    // canned entries do not ask; "fast food" entries are restaurant dishes the user cannot have boiled themselves.
    foodMatch: /^kidney beans(?:,|\s*$)(?!.*\b(?:canned|fast food)\b)/i,
    questionId: 'rawKidneyBeans',
    question: 'Were these kidney beans eaten raw, or without being soaked and then boiled?',
    hazard:
      'The FDA says phytohaemagglutinin (PHA) is a lectin found in raw or undercooked beans, and that at high levels in raw beans it can lead to nausea, severe vomiting, and diarrhea.',
    action:
      'The FDA says soaking the beans for a minimum of 5 hours and then boiling them in fresh water for at least 30 minutes will remove and destroy this toxin.',
    citation: {
      title: 'Natural Toxins in Food',
      publisher: fda,
      year: 2024,
      url: 'https://www.fda.gov/food/chemical-contaminants-pesticides/natural-toxins-food',
      conclusion:
        'Phytohaemagglutinin (PHA) is a lectin found in raw or undercooked beans. In canned and properly cooked kidney beans, the low levels of PHA won’t affect you. ' +
        'But at high levels in raw beans, PHA can lead to nausea, severe vomiting, and diarrhea. ' +
        'Soaking the beans for a minimum of 5 hours and then boiling them in fresh water for at least 30 minutes will remove and destroy this toxin.',
    },
  },
  {
    id: 'food-safety-raw-milk',
    title: 'Unpasteurised milk',
    foodMatch: /^(?:goat milk\b|milk,\s*(?:whole|reduced fat|low fat|fat free|nfs)\b)/i,
    questionId: 'rawMilk',
    question: 'Was this milk raw (unpasteurised)?',
    hazard: 'The FDA says raw milk can contain a variety of disease-causing pathogens, as demonstrated by numerous scientific studies.',
    action: 'The FDA says pasteurization effectively kills raw milk pathogens without any significant impact on milk nutritional quality.',
    citation: {
      title: 'Raw Milk Misconceptions and the Danger of Raw Milk Consumption',
      publisher: fda,
      year: 2024,
      url: 'https://www.fda.gov/food/buy-store-serve-safe-food/raw-milk-misconceptions-and-danger-raw-milk-consumption',
      conclusion:
        'Raw milk can contain a variety of disease-causing pathogens, as demonstrated by numerous scientific studies. ' +
        'Pasteurization effectively kills raw milk pathogens without any significant impact on milk nutritional quality.',
    },
  },
];

const matches = (h: Hazard, ctx: Context): boolean => ctx.foods.some((f) => h.foodMatch.test(f.name));

function ruleFor(h: Hazard): Rule {
  const body = h.citation.publisher.includes('FSA') ? 'FSA' : 'FDA';
  return {
    id: h.id,
    title: h.title,
    category: 'safety',
    safetyAuthority: 'food-safety-body',
    identityRequired: () => true,
    scope: 'entry',
    // Reads identity and an answer, not a nutrient: the coverage gate does not protect this rule.
    requiresNutrients: [],
    horizon: 'occasional',
    evidence: {
      strength: 'strong',
      body,
      summary: `${body} publishes this as handling advice for the food. The card appears only after you answered yes to the question about how it was handled.`,
      citation: { ...h.citation },
      isAssociational: false,
    },
    concern: h.hazard,
    cause: `You answered yes to: "${h.question}" The card rests on that answer and on the food named, not on guesswork from what was typed.`,
    // Identity AND an explicit yes. The identity check is repeated here so a stale yes can never raise a card for another food.
    level: (ctx) => (matches(h, ctx) && ctx.answers[h.questionId] === true ? 'CRITICAL' : null),
    portionNote: () => `What the source advises: ${h.action} This card cannot tell whether this particular serving is a problem.`,
    safetyPrompt: {
      answerKey: h.questionId,
      applies: (ctx) => matches(h, ctx),
      question: h.question,
    },
  };
}

export const foodSafetyRules: Rule[] = HAZARDS.map(ruleFor);

/** The questions the gate would ask for this entry, through the engine's own safety-prompt flow. */
export function foodSafetyQuestionsFor(ctx: Context): SafetyQuestion[] {
  return evaluate(foodSafetyRules, ctx).questions;
}
