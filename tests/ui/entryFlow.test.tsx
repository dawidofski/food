import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { addEntry, allEntriesIncludingTombstones, entriesBetween, eraseEverything, getProfile, putProfile } from '@/data/db';
import { loadFoods, resetFoodRepository } from '@/data/foodRepository';
import { localDayKey, localDayRange } from '@/domain/dayBoundary';
import type { FoodLookup } from '@/domain/foodLookup';
import { catalogue } from '@/rules/catalogue';
import { allergenRule } from '@/rules/catalogue/allergen';
import type { Rule, WarningCard as Card } from '@/rules/types';
import { defaultDeps, type FlowDeps } from '@/state/useEntryFlow';
import Log from '@/ui/screens/Log';
import WarningCard from '@/ui/components/WarningCard';
import type { DatasetFood } from '@/types/food';
import type { ClassificationFlags } from '@/types/nutrients';
import { ownerProfile } from '../fixtures/profile';

const fromDisk = (async (url: string) => {
  const rel = String(url).replace(import.meta.env.BASE_URL, '');
  const body = readFileSync(resolve(__dirname, '../../public', rel), 'utf8');
  return { ok: true, status: 200, text: async () => body } as Response;
}) as typeof fetch;

const realDeps: FlowDeps = { ...defaultDeps, loadData: () => loadFoods(fromDisk) };

beforeAll(async () => {
  resetFoodRepository();
  await loadFoods(fromDisk);
}, 60_000);

beforeEach(async () => {
  await eraseEverything();
});
afterEach(cleanup);

// ---- helpers ----

async function entriesToday() {
  const { fromISO, toISO } = localDayRange(localDayKey(new Date()));
  return entriesBetween(fromISO, toISO);
}

function typeText(text: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
}
async function submit() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^log$/i }));
  });
}
async function typeAndSubmit(text: string, deps: FlowDeps = realDeps) {
  render(<Log deps={deps} />);
  typeText(text);
  await submit();
}
async function click(name: RegExp) {
  const button = await screen.findByRole('button', { name });
  await act(async () => {
    fireEvent.click(button);
  });
}

const flags: ClassificationFlags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};
const citation = (publisher: string) => ({
  title: `${publisher} source`, publisher, year: 2020, url: `https://example.org/${publisher}`,
  conclusion: `${publisher} concludes something specific.`,
});
const baseCard: Card = {
  ruleId: 'r', mergedFrom: [], merged: [], level: 'INFO', title: 'A title', concern: 'A concern.', cause: 'A cause.',
  evidence: { strength: 'moderate', body: 'WHO', summary: 'A summary.', citation: citation('WHO'), isAssociational: true },
  horizon: 'habitual', portionNote: 'Your portion: 100 g.', alternatives: [],
};
const infoCard: Card = { ...baseCard, ruleId: 'info', level: 'INFO' };
const criticalCard: Card = { ...baseCard, ruleId: 'crit', level: 'CRITICAL', title: 'Flagged allergen' };
const processedMeatCard: Card = {
  ...baseCard, ruleId: 'processed-meat', level: 'HIGH', title: 'Processed meat',
  evidence: { strength: 'strong', body: 'IARC', summary: 'IARC Monograph Vol. 114.', citation: citation('IARC'), isAssociational: true },
};

const rule = (over: Partial<Rule>): Rule => ({
  id: 'x', title: 'X', category: 'nutrition', level: () => null, concern: 'concern', cause: 'cause',
  evidence: { strength: 'strong', body: 'B', summary: 's', citation: citation('B'), isAssociational: false },
  horizon: 'both', portionNote: () => 'note', requiresNutrients: [], scope: 'entry', ...over,
});
const food = (id: string, name: string, portions: { label: string; grams: number }[], over: Partial<DatasetFood> = {}): DatasetFood => ({
  id, name, synonyms: [], per100g: { energyKcal: 100 }, portions, classification: flags, allergens: [], ...over,
});
const lookupOf = (foods: DatasetFood[]): FoodLookup => ({
  search: (q) => foods.filter((f) => f.name.toLowerCase().includes(q.toLowerCase())).map((f) => ({ source: 'dataset' as const, food: f, score: 0.03 })),
  get: (_s, id) => foods.find((f) => f.id === id),
});
const fakeDeps = (foods: DatasetFood[], rules: Rule[] = []): FlowDeps => ({
  ...realDeps, lookup: lookupOf(foods), rules, loadData: async () => undefined, isDataReady: () => true,
});

// ---- the ten tests from the brief ----

describe('the flow', () => {
  test('an ordinary food commits with no warning card', async () => {
    await typeAndSubmit('an apple');
    await waitFor(async () => expect(await entriesToday()).toHaveLength(1));
    expect(screen.queryByTestId('warning-card')).not.toBeInTheDocument();
  });

  test('two hot dogs shows the processed meat card before committing', async () => {
    await typeAndSubmit('I ate two hot dogs');
    const card = (await screen.findAllByTestId('warning-card'))[0]!;
    expect(within(card).getByRole('heading', { name: /processed meat/i })).toBeInTheDocument();
    expect(await entriesToday()).toHaveLength(0);
  });

  test('the gate offers exactly the three spec actions', async () => {
    await typeAndSubmit('two hot dogs');
    for (const label of [/add anyway/i, /show healthier alternatives/i, /cancel/i]) {
      expect(await screen.findByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  test('add anyway commits the entry with the warnings that were shown', async () => {
    await typeAndSubmit('two hot dogs');
    await click(/add anyway/i);
    await waitFor(async () => expect(await entriesToday()).toHaveLength(1));
    const [e] = await entriesToday();
    expect(e!.userAction).toBe('added');
    expect(e!.warningsShown.map((w) => w.ruleId)).toContain('processed-meat');
  });

  test('cancel stores the entry as cancelled and keeps it out of totals', async () => {
    await typeAndSubmit('two hot dogs');
    await click(/cancel/i);
    await waitFor(async () => expect(await allEntriesIncludingTombstones()).toHaveLength(1));
    expect(await entriesToday()).toHaveLength(0);
    expect((await allEntriesIncludingTombstones())[0]!.userAction).toBe('cancelled');
  });

  test('an unresolved food offers manual entry rather than failing silently', async () => {
    await typeAndSubmit('one frikandel');
    expect(await screen.findByText(/don.t know/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add .*own food/i })).toBeInTheDocument();
    expect(await entriesToday()).toHaveLength(0);
  });

  test('a safety question is asked before any card is shown', async () => {
    await typeAndSubmit('rice');
    expect(await screen.findByText(/room temperature/i)).toBeInTheDocument();
    expect(screen.queryByTestId('warning-card')).not.toBeInTheDocument();
  });

  test('an INFO card renders neutral, not alarming', () => {
    render(<WarningCard card={infoCard} />);
    expect(screen.getByTestId('warning-card').className).not.toMatch(/red|orange|amber/);
  });

  test('a CRITICAL card cannot be collapsed', () => {
    render(<WarningCard card={criticalCard} />);
    expect(screen.queryByRole('button', { name: /collapse|hide/i })).not.toBeInTheDocument();
    expect(screen.getByText(baseCard.concern)).toBeInTheDocument();
  });

  test('a card shows its evidence strength and source', () => {
    render(<WarningCard card={processedMeatCard} />);
    expect(screen.getByText(/evidence strength/i)).toBeInTheDocument();
    expect(screen.getAllByText(/IARC/).length).toBeGreaterThan(0);
  });
});

// ---- the ten review requirements ----

describe('requirement 1 and 2: snapshots at commit', () => {
  const veg = { vegCupEq: 1, fruitCupEq: 0, wholeGrainOzEq: 0 };
  const foods = [
    food('a', 'Carrots', [{ label: '1 medium', grams: 60 }], { fped: veg, classification: { ...flags, vegetable: true } }),
    food('b', 'Cola', [{ label: '1 can', grams: 355 }], { classification: { ...flags, sweetDrink: true } }),
    food('c', 'Peas', [{ label: '1 cup', grams: 100 }], { fped: veg }),
  ];

  test('entry and each item carry nutrients, classification and gram-scaled fped; entry fped absent when any item lacks it', async () => {
    await typeAndSubmit('two carrots and a cola', fakeDeps(foods));
    await waitFor(async () => expect(await entriesToday()).toHaveLength(1));
    const [e] = await entriesToday();
    expect(e!.nutrients.energyKcal).toBeCloseTo(120 + 355, 5);
    expect(e!.coverage.energyKcal).toBe('known');
    expect(e!.classification.sweetDrink).toBe(true);
    expect(e!.classification.vegetable).toBe(true);
    const [carrots, cola] = e!.items;
    expect(carrots!.classification.vegetable).toBe(true);
    expect(carrots!.classification.sweetDrink).toBe(false);
    expect(carrots!.fped!.vegCupEq).toBeCloseTo(1.2, 5);
    expect(cola!.fped).toBeUndefined();
    expect(e!.fped).toBeUndefined();
  });

  test('entry fped is the sum when every item has it', async () => {
    await typeAndSubmit('a carrots and 100 g peas', fakeDeps(foods));
    await waitFor(async () => expect(await entriesToday()).toHaveLength(1));
    const [e] = await entriesToday();
    expect(e!.fped!.vegCupEq).toBeCloseTo(0.6 + 1, 5);
  });
});

describe('requirement 3: Context.foods is populated', () => {
  test('rules see resolved names and allergen tags', async () => {
    let seen: { name: string; allergens: string[] }[] | undefined;
    const spy = rule({ level: (ctx) => { seen = ctx.foods; return null; } });
    await typeAndSubmit('a peanut butter', fakeDeps([food('p', 'Peanut butter', [{ label: '1 tbsp', grams: 16 }], { allergens: ['peanuts'] })], [spy]));
    await waitFor(async () => expect(await entriesToday()).toHaveLength(1));
    expect(seen).toEqual([{ name: 'Peanut butter', allergens: ['peanuts'], source: 'dataset' }]);
  });

  test('with the real catalogue the identity-required safety rules do not report cannotCheck', async () => {
    await typeAndSubmit('rice');
    await screen.findByText(/room temperature/i);
    expect(screen.queryByTestId('check-note')).not.toBeInTheDocument();
  });
});

describe('requirement 4: the resolved food, portion and weight are shown', () => {
  test('the gate names the resolved food, portion label and gram weight', async () => {
    await typeAndSubmit('two hot dogs');
    const lines = await screen.findAllByTestId('resolved-line');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.textContent).toMatch(/2 ×/);
    expect(lines[0]!.textContent).toMatch(/hot dog/i);
    expect(lines[0]!.textContent).toMatch(/\d+ g each/);
    expect(lines[0]!.textContent).toMatch(/— \d+ g/);
  });

  test('an entry committed with no card still shows what it resolved to', async () => {
    await typeAndSubmit('an apple');
    const line = await screen.findByTestId('resolved-line');
    expect(line.textContent).toMatch(/apple/i);
    expect(line.textContent).toMatch(/\d+ g/);
  });
});

describe('requirement 5: unusual serving sizes are flagged', () => {
  const pie = food('pie', 'Meat pie', [{ label: '1 regular', grams: 1200 }, { label: '1 slice', grams: 150 }]);

  test('a bare count that lands over 1 kg asks "is that right?" and holds the entry at the gate', async () => {
    await typeAndSubmit('a meat pie', fakeDeps([pie]));
    const flag = await screen.findByTestId('unusual-serving');
    expect(flag.textContent).toMatch(/1,200 g/);
    expect(flag.textContent).toMatch(/is that right\?/i);
    expect(await entriesToday()).toHaveLength(0);
    expect(screen.getByRole('button', { name: /add anyway/i })).toBeInTheDocument();
  });

  test('a tiny pick (under 5 g) and one under 20% of the largest portion are flagged, an explicit gram weight is not', async () => {
    const salt = food('s', 'Sea salt', [{ label: '1 pinch', grams: 0.4 }, { label: '1 tsp', grams: 6 }]);
    const soup = food('o', 'Oat soup', [{ label: '1 cup', grams: 240 }, { label: '1 regular', grams: 30 }]);
    await typeAndSubmit('a sea salt', fakeDeps([salt, soup]));
    expect(await screen.findByTestId('unusual-serving')).toBeInTheDocument();
    cleanup();
    await typeAndSubmit('an oat soup', fakeDeps([salt, soup]));
    expect(await screen.findByTestId('unusual-serving')).toBeInTheDocument();
    cleanup();
    await typeAndSubmit('3 g sea salt', fakeDeps([salt, soup]));
    await waitFor(async () => expect(await entriesToday()).toHaveLength(1));
  });
});

describe('requirement 6: merged claims sit under their own citation', () => {
  test('each absorbed claim renders with its own source and never the primary card\'s', () => {
    const card: Card = {
      ...processedMeatCard,
      mergedFrom: ['sodium'],
      merged: [{
        ruleId: 'sodium', level: 'MODERATE', concern: 'Sodium claim.', portionNote: 'Sodium note.',
        evidence: { strength: 'moderate', body: 'WHO', summary: 'WHO sodium summary.', citation: citation('WHOSODIUM'), isAssociational: true },
        citation: citation('WHOSODIUM'),
      }],
    };
    render(<WarningCard card={card} />);
    const claim = screen.getByTestId('merged-claim');
    expect(within(claim).getByText('Sodium claim.')).toBeInTheDocument();
    expect(claim.textContent).toMatch(/WHOSODIUM/);
    expect(claim.textContent).not.toMatch(/IARC/);
    const outer = screen.getByTestId('warning-card');
    // the primary claim is not inside the merged block
    expect(within(claim).queryByText(processedMeatCard.concern)).not.toBeInTheDocument();
    expect(outer.textContent).toMatch(/IARC/);
  });
});

describe('merged claims are recorded in warningsShown', () => {
  test('every claim of a merged card is stored at its own level', async () => {
    const hi = rule({ id: 'hi', level: () => 'HIGH', nutrientKey: 'sodiumMg', title: 'Hi' });
    const lo = rule({ id: 'lo', level: () => 'MODERATE', nutrientKey: 'sodiumMg', title: 'Lo' });
    const info = rule({ id: 'inf', level: () => 'INFO', nutrientKey: 'sodiumMg', title: 'Inf' });
    await typeAndSubmit('an apple', fakeDeps([food('ap', 'Apple', [{ label: '1 medium', grams: 180 }])], [lo, hi, info]));
    await screen.findAllByTestId('merged-claim');
    await click(/add anyway/i);
    await waitFor(async () => expect(await entriesToday()).toHaveLength(1));
    const [e] = await entriesToday();
    expect(e!.warningsShown).toEqual([
      { ruleId: 'hi', level: 'HIGH' },
      { ruleId: 'lo', level: 'MODERATE' },
      { ruleId: 'inf', level: 'INFO' },
    ]);
  });
});

describe('requirement 7: failures are visible and never block', () => {
  const apple = food('ap', 'Apple', [{ label: '1 medium', grams: 180 }]);

  test('an unrecognised allergen flag is named plainly at the gate by the REAL allergen rule, and the entry can still be added', async () => {
    await putProfile({ ...ownerProfile, flaggedAllergens: ['kryptonite'] });
    await typeAndSubmit('an apple', fakeDeps([apple], [allergenRule]));
    const note = await screen.findByTestId('check-note');
    expect(note.textContent).toMatch(/^We could not check this entry for your flagged allergens\./i);
    expect(note.textContent).toMatch(/kryptonite/);
    expect(note.textContent).not.toMatch(/could not run a safety check/i);
    expect((note.textContent!.match(/allergen-flagged/g) ?? []).length).toBeLessThanOrEqual(1);
    await click(/add anyway/i);
    await waitFor(async () => expect(await entriesToday()).toHaveLength(1));
  });

  test('a non-safety failure does not hold the entry; the note shows after it is added', async () => {
    const throwing = rule({ id: 'boom', level: () => { throw new Error('bad rule'); } });
    await typeAndSubmit('an apple', fakeDeps([apple], [throwing]));
    await waitFor(async () => expect(await entriesToday()).toHaveLength(1));
    expect((await screen.findByTestId('check-note')).textContent).toMatch(/boom/);
  });
});

describe('requirement 8: silence is not reassurance', () => {
  test('a committed entry and a gate with no allergen card never say "no allergens"', async () => {
    await typeAndSubmit('an apple');
    await screen.findByTestId('resolved-line');
    expect(document.body.textContent).not.toMatch(/no allergen|allergen.free|free of allergen|✓|✔/i);
  });
});

describe('requirement 9: questions come first, CRITICAL shows through', () => {
  const critical = rule({ id: 'crit', category: 'safety', safetyAuthority: 'user-flag', level: () => 'CRITICAL', title: 'Flagged allergen' });
  const asker = rule({
    id: 'ask', category: 'safety', safetyAuthority: 'food-safety-body', level: () => 'CRITICAL', title: 'Handling hazard',
    safetyPrompt: { answerKey: 'q1', applies: () => true, question: 'Was it left out overnight?' },
  });
  const nutr = rule({ id: 'nut', level: () => 'HIGH', title: 'A nutrition card' });
  const rice = food('r', 'Rice', [{ label: '1 cup', grams: 160 }]);

  test('the question and the CRITICAL card render together; lower cards wait', async () => {
    await typeAndSubmit('rice', fakeDeps([rice], [critical, asker, nutr]));
    expect(await screen.findByText(/left out overnight/i)).toBeInTheDocument();
    const cards = screen.getAllByTestId('warning-card');
    expect(cards).toHaveLength(1);
    expect(within(cards[0]!).getByRole('heading', { name: /flagged allergen/i })).toBeInTheDocument();
  });

  test('answering keeps the CRITICAL card and then shows the rest', async () => {
    await typeAndSubmit('rice', fakeDeps([rice], [critical, asker, nutr]));
    await click(/^no$/i);
    await screen.findByRole('button', { name: /add anyway/i });
    const titles = screen.getAllByTestId('warning-card').map((c) => within(c).getByRole('heading').textContent);
    expect(titles).toEqual(['Flagged allergen', 'A nutrition card']);
  });

  test('cancelling while a question is pending stores a cancelled entry', async () => {
    await typeAndSubmit('rice', fakeDeps([rice], [critical, asker]));
    await click(/cancel/i);
    await waitFor(async () => expect(await allEntriesIncludingTombstones()).toHaveLength(1));
    expect((await allEntriesIncludingTombstones())[0]!.userAction).toBe('cancelled');
  });
});

describe('requirement 10: addEntry rules hold', () => {
  test('the committed rows are active with no revision fields', async () => {
    await typeAndSubmit('an apple');
    await waitFor(async () => expect(await entriesToday()).toHaveLength(1));
    const [e] = await entriesToday();
    expect(e!.state).toBe('active');
    expect(e!.revisionOf).toBeUndefined();
    expect(e!.supersededBy).toBeUndefined();
  });
});

describe('alternatives and recents', () => {
  test('showing alternatives then adding records addedAfterAlternatives', async () => {
    await typeAndSubmit('two hot dogs');
    await click(/show healthier alternatives/i);
    expect(await screen.findByRole('heading', { name: /healthier alternatives/i })).toBeInTheDocument();
    await click(/add anyway/i);
    await waitFor(async () => expect(await entriesToday()).toHaveLength(1));
    expect((await entriesToday())[0]!.userAction).toBe('addedAfterAlternatives');
  });

  test('a recent entry can be logged again in one tap, through the gate', async () => {
    await typeAndSubmit('an apple');
    await waitFor(async () => expect(await entriesToday()).toHaveLength(1));
    await click(/log .*apple.* again/i);
    await waitFor(async () => expect(await entriesToday()).toHaveLength(2));
  });

  test('the profile flag path reaches the allergen rule (flagged peanuts, peanut food)', async () => {
    await putProfile({ ...ownerProfile, flaggedAllergens: ['peanuts'] });
    expect(await getProfile()).not.toBeNull();
    const pb = food('pb', 'Peanut butter', [{ label: '1 tbsp', grams: 16 }], { allergens: ['peanuts'] });
    await typeAndSubmit('a peanut butter', fakeDeps([pb], catalogue));
    const card = await screen.findByTestId('warning-card');
    expect(card.getAttribute('data-level')).toBe('CRITICAL');
    expect(screen.queryByRole('button', { name: /collapse|hide/i })).not.toBeInTheDocument();
  });
});

void addEntry;

describe('a "no" to a safety question is remembered per food', () => {
  test('after saying no once about rice, rice commits without asking again, in a fresh session', async () => {
    await typeAndSubmit('rice');
    await screen.findByText(/room temperature/i);
    await click(/^no$/i);
    await waitFor(async () => expect(await entriesToday()).toHaveLength(1));
    cleanup();
    await typeAndSubmit('rice');
    await waitFor(async () => expect(await entriesToday()).toHaveLength(2));
    expect(screen.queryByText(/room temperature/i)).not.toBeInTheDocument();
  });

  test('a yes is never remembered: the question is asked again', async () => {
    await typeAndSubmit('rice');
    await screen.findByText(/room temperature/i);
    await click(/^yes$/i);
    await click(/cancel/i);
    cleanup();
    await typeAndSubmit('rice');
    expect(await screen.findByText(/room temperature/i)).toBeInTheDocument();
  });

  test('erase everything forgets the remembered answers', async () => {
    await typeAndSubmit('rice');
    await screen.findByText(/room temperature/i);
    await click(/^no$/i);
    await waitFor(async () => expect(await entriesToday()).toHaveLength(1));
    cleanup();
    await eraseEverything();
    await typeAndSubmit('rice');
    expect(await screen.findByText(/room temperature/i)).toBeInTheDocument();
  });
});

describe('fail visibly when only some foods lose their identity', () => {
  test('a ref whose food the lookup cannot return is reported, not silently dropped', async () => {
    const apple = food('ap', 'Apple', [{ label: '1 medium', grams: 180 }]);
    const pear = food('pe', 'Pear', [{ label: '1 medium', grams: 180 }]);
    const base = lookupOf([apple, pear]);
    const deps: FlowDeps = { ...fakeDeps([apple, pear], []), lookup: { ...base, get: (s, id) => (id === 'pe' ? undefined : base.get(s, id)) } };
    await typeAndSubmit('an apple and a pear', deps);
    const note = await screen.findByTestId('check-note');
    expect(note.textContent).toMatch(/could not be identified/i);
  });
});

describe('the alternatives button', () => {
  const apple = food('ap', 'Apple', [{ label: '1 medium', grams: 180 }]);
  test('is not offered when no card carries an alternative', async () => {
    await typeAndSubmit('an apple', fakeDeps([apple], [rule({ id: 'bare', level: () => 'HIGH' })]));
    await screen.findByTestId('warning-card');
    expect(screen.queryByRole('button', { name: /healthier alternatives/i })).not.toBeInTheDocument();
  });
  test('is offered when a card has one', async () => {
    const alt = { label: 'x', reason: 'a reason long enough', citation: citation('WHO') };
    await typeAndSubmit('an apple', fakeDeps([apple], [rule({ id: 'has', level: () => 'HIGH', alternatives: [alt] })]));
    expect(await screen.findByRole('button', { name: /healthier alternatives/i })).toBeInTheDocument();
  });
});
