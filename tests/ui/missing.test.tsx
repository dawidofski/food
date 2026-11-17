import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { addEntry, eraseEverything, putHealthDay, putProfile } from '@/data/db';
import { lastNDayKeys } from '@/domain/dayBoundary';
import { computeTargets } from '@/domain/targets';
import type { Rule } from '@/rules/types';
import type { DatasetFood } from '@/types/food';
import { defaultDeps, useEntryFlow, type FlowDeps } from '@/state/useEntryFlow';
import ProfileSettings from '@/ui/screens/ProfileSettings';
import type { DiaryEntry } from '@/types/diary';
import type { ClassificationFlags } from '@/types/nutrients';
import { directionOf } from '@/domain/targetDirection';
import Missing, { MICRO_ORDER } from '@/ui/screens/Missing';
import { ownerProfile } from '../fixtures/profile';

beforeEach(async () => {
  await eraseEverything();
});
afterEach(cleanup);

const flags: ClassificationFlags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};

function daysAgo(n: number, hour = 12): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - n, hour).toISOString();
}

async function seedEntry(over: Partial<DiaryEntry> = {}): Promise<void> {
  await addEntry({
    id: globalThis.crypto.randomUUID(),
    at: daysAgo(0),
    rawText: 'a meal',
    resolution: 'local',
    items: [{ source: 'dataset', foodId: 'x', grams: 100, classification: flags }],
    nutrients: { energyKcal: 500, proteinG: 20, fibreG: 5 },
    coverage: { energyKcal: 'known', proteinG: 'known', fibreG: 'known' },
    classification: flags,
    fped: { vegCupEq: 0, fruitCupEq: 0, wholeGrainOzEq: 0 },
    warningsShown: [],
    userAction: 'added',
    state: 'active',
    ...over,
  });
}

/** Six logged days (today and five before it): veg on three of them, none on three. The seventh day is empty. */
async function seedWeek() {
  for (let i = 0; i < 6; i++) {
    const veg = i % 2 === 0 ? 1 : 0;
    await seedEntry({ at: daysAgo(i), fped: { vegCupEq: veg, fruitCupEq: 0, wholeGrainOzEq: 0 } });
  }
}

describe('missing view', () => {
  test('reports days without a vegetable serving as a fact', async () => {
    await seedWeek();
    render(<Missing />);
    expect(await screen.findByText(/3 days without a vegetable serving/i)).toBeInTheDocument();
    expect(screen.getByText(/based on 6 of the last 7 days/i)).toBeInTheDocument();
    expect(screen.queryByText(/failed|should have|must|bad/i)).not.toBeInTheDocument();
  });

  test('an empty day is not counted as a day without vegetables', async () => {
    await seedWeek(); // one empty day: the library alone would say 4
    render(<Missing />);
    await screen.findByText(/3 days without a vegetable serving/i);
    expect(screen.queryByText(/4 days without/i)).not.toBeInTheDocument();
  });

  test('too few logged days: no gap is announced, and the view says why', async () => {
    await seedEntry({ at: daysAgo(0) });
    await seedEntry({ at: daysAgo(1) });
    const { container } = render(<Missing />);
    expect(await screen.findByText(/only 2 of the last 7 days have entries/i)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/without a vegetable/i);
  });

  test('a fresh diary renders with no gap and no NaN', async () => {
    const { container } = render(<Missing />);
    expect(await screen.findByText(/nothing logged today/i)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN|Infinity|without a vegetable/);
  });

  test('days whose foods carry no vegetable data are unknown, not vegetable-free', async () => {
    for (let i = 0; i < 5; i++) await seedEntry({ at: daysAgo(i), fped: undefined });
    render(<Missing />);
    expect(await screen.findByText(/5 days where vegetable data is missing/i)).toBeInTheDocument();
    expect(screen.queryByText(/without a vegetable serving/i)).not.toBeInTheDocument();
  });

  test('shows no score, grade, rating or streak, and no alarm styling', async () => {
    await seedWeek();
    const { container } = render(<Missing />);
    await screen.findByText(/3 days without a vegetable serving/i);
    expect(screen.queryByTestId('health-score')).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/score|grade|rating|streak/i);
    expect(container.innerHTML).not.toMatch(/red-|rose-|orange-/);
  });

  test('a partially covered nutrient shows a floor, not a clean total', async () => {
    await seedEntry({ nutrients: { energyKcal: 200, addedSugarsG: 10 }, coverage: { energyKcal: 'known', addedSugarsG: 'known' } });
    await seedEntry({ nutrients: { energyKcal: 300 }, coverage: { energyKcal: 'known' } });
    render(<Missing />);
    const bar = await screen.findByTestId('bar-addedSugarsG');
    expect(within(bar).getByText(/at least 10 g/i)).toBeInTheDocument();
  });

  test('the floor shows even when the unknown entry has no energy figure (share reads 1.0)', async () => {
    await seedEntry({ nutrients: { energyKcal: 200, addedSugarsG: 10 }, coverage: { energyKcal: 'known', addedSugarsG: 'known' } });
    await seedEntry({ nutrients: { proteinG: 5 }, coverage: { proteinG: 'known' } });
    render(<Missing />);
    const bar = await screen.findByTestId('bar-addedSugarsG');
    expect(within(bar).getByText(/at least 10 g/i)).toBeInTheDocument();
  });

  test('a nutrient nobody knew today has no figure at all', async () => {
    await seedEntry({ nutrients: { energyKcal: 200 }, coverage: { energyKcal: 'known' } });
    render(<Missing />);
    const bar = await screen.findByTestId('bar-sodiumMg');
    expect(within(bar).getByText(/no sodium data/i)).toBeInTheDocument();
  });

  test('a fully known total is a plain figure with the target marked', async () => {
    await seedEntry();
    render(<Missing />);
    const bar = await screen.findByTestId('bar-proteinG');
    expect(within(bar).getByText(/^20 g$/)).toBeInTheDocument();
    expect(within(bar).queryByText(/at least/i)).not.toBeInTheDocument();
    expect(within(bar).getByRole('progressbar')).toBeInTheDocument();
  });

  test('standing micronutrient gaps are stated as facts about days with complete data', async () => {
    await putProfile(ownerProfile);
    for (let i = 0; i < 5; i++) {
      await seedEntry({ at: daysAgo(i), nutrients: { energyKcal: 500, calciumMg: 300 }, coverage: { energyKcal: 'known', calciumMg: 'known' } });
    }
    render(<Missing />);
    const gap = await screen.findByTestId('gap-calciumMg');
    expect(gap.textContent).toMatch(/calcium/i);
    expect(gap.textContent).toMatch(/5 of 5 days/);
    expect(gap.textContent).toMatch(/950 mg/);
  });

  test('each gap says which kind of reference it is measured against', async () => {
    await putProfile(ownerProfile);
    for (let i = 0; i < 5; i++) {
      await seedEntry({ at: daysAgo(i), nutrients: { energyKcal: 500, calciumMg: 300, magnesiumMg: 100 }, coverage: { energyKcal: 'known', calciumMg: 'known', magnesiumMg: 'known' } });
    }
    render(<Missing />);
    expect((await screen.findByTestId('gap-magnesiumMg')).textContent).toMatch(/adequate intake/i);
    expect(screen.getByTestId('gap-calciumMg').textContent).toMatch(/population reference intake/i);
  });

  test('weight is shown with history and no evaluative text', async () => {
    await putProfile({ ...ownerProfile, weightLog: [{ date: '2026-09-01', kg: 101.5 }, { date: '2026-10-01', kg: 100.2 }] });
    const { container } = render(<Missing />);
    expect(await screen.findByText(/101\.5 kg/)).toBeInTheDocument();
    expect(screen.getByText(/100\.2 kg/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /weight trend/i })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/bmi|overweight|underweight|obese|ideal weight|healthy weight/i);
  });
});

describe('the energy and fibre targets are labelled as the app\'s own', () => {
  test('the Missing screen says the energy and fibre targets are not a published recommendation, and names the sources of the protein targets', async () => {
    await putProfile(ownerProfile);
    render(<Missing />);
    const note = await screen.findByTestId('own-targets-note');
    expect(note.textContent).toMatch(/own working figures[^.]*not a published recommendation/i);
    expect(note.textContent).toMatch(/WHO advises at least 25 g of fibre/i);
    expect(note.textContent).toMatch(/Any goal offset is added to the energy target/);
    expect(note.textContent).toMatch(/goal offset and the fibre rule are this app.s own working figures/i);
    expect(note.textContent).toMatch(/EFSA[^.]*0\.83 g/);
    expect(note.textContent).toMatch(/International Society of Sports Nutrition[^.]*1\.4 to 2\.0 g/);
    expect(note.textContent).toMatch(/this app uses the middle, 1\.7 g, and the top, 2\.0 g, when your goal is to lose weight/);
    expect(note.textContent).not.toMatch(/1\.2 g/);
  });
});

describe('for general targets the screen accounts for the energy figure and claims no goal offset', () => {
  test('a profile with no usable weight names the equation and the activity factor, and never says an offset is applied', async () => {
    await putProfile({ ...ownerProfile, weightLog: [], goal: { kind: 'lose', rateKgPerWeek: 0.5 } });
    render(<Missing />);
    const source = (await screen.findByTestId('energy-source')).textContent ?? '';
    expect(source).toMatch(/Mifflin-St Jeor equation/);
    expect(source).toMatch(/light activity factor of 1\.375 \(this app.s own working figure/);
    expect(source).not.toMatch(/offset|goal/i);
    const note = screen.getByTestId('own-targets-note').textContent ?? '';
    expect(note).toMatch(/activity factor and the fibre rule are this app.s own working figures/i);
    expect(note).not.toMatch(/goal offset/i);
    expect(screen.getByText(/general adult guidelines until your profile is set up/i)).toBeTruthy();
  });

  test('Settings says the same sentence for the same general targets', async () => {
    await putProfile({ ...ownerProfile, weightLog: [], goal: { kind: 'lose', rateKgPerWeek: 0.5 } });
    render(<Missing />);
    const onMissing = (await screen.findByTestId('energy-source')).textContent;
    cleanup();
    render(<ProfileSettings />);
    const line = await screen.findByText(/^Energy:/);
    expect(line.textContent).toBe(onMissing);
  });
});

describe('a ceiling is never framed as a target, and a floor below the target is shown', () => {
  const fullDay = {
    nutrients: { energyKcal: 500, proteinG: 20, fibreG: 5, sodiumMg: 800, satFatG: 5, addedSugarsG: 10 },
    coverage: { energyKcal: 'known', proteinG: 'known', fibreG: 'known', sodiumMg: 'known', satFatG: 'known', addedSugarsG: 'known' },
  } as const;

  test('no ceiling on the screen is described as a target', async () => {
    await putProfile({ ...ownerProfile, activityLevel: 'moderate' });
    await seedEntry({ nutrients: { ...fullDay.nutrients }, coverage: { ...fullDay.coverage } });
    render(<Missing />);
    for (const key of ['sodiumMg', 'satFatG', 'addedSugarsG'] as const) {
      const bar = await screen.findByTestId(`bar-${key}`);
      expect(bar.textContent).toMatch(/limit \d/i);
      expect(bar.textContent).not.toMatch(/target/i);
      expect(bar.getAttribute('aria-label') ?? '').not.toMatch(/target/i);
      expect(within(bar).getByRole('progressbar').getAttribute('aria-label')).not.toMatch(/target/i);
      expect(within(bar).getByRole('progressbar').getAttribute('aria-valuetext')).not.toMatch(/target/i);
    }
  });

  test('protein shows the EFSA floor as a second mark below its target, labelled as the EFSA reference intake', async () => {
    await putProfile({ ...ownerProfile, activityLevel: 'moderate' }); // 80 kg: target 1.7 g/kg = 136 g, floor 0.83 g/kg = 66 g
    await seedEntry({ nutrients: { ...fullDay.nutrients }, coverage: { ...fullDay.coverage } });
    render(<Missing />);
    const bar = await screen.findByTestId('bar-proteinG');
    expect(bar.querySelector('[data-mark="second"]')).not.toBeNull();
    expect(bar.textContent).toMatch(/EFSA reference intake for adults, 0\.83 g per kg: 66 g/);
    expect(bar.textContent).toMatch(/target 136 g/);
  });

  test('added sugars shows WHO\'s stricter conditional figure as a second mark, not as another limit', async () => {
    await putProfile({ ...ownerProfile, activityLevel: 'moderate' });
    await seedEntry({ nutrients: { ...fullDay.nutrients }, coverage: { ...fullDay.coverage } });
    render(<Missing />);
    const bar = await screen.findByTestId('bar-addedSugarsG');
    expect(bar.querySelector('[data-mark="second"]')).not.toBeNull();
    expect(bar.textContent).toMatch(/WHO's stricter, conditional advice, 5% of energy: \d+ g/);
    expect(bar.textContent).toMatch(/limit \d+ g/);
    expect(bar.textContent).not.toMatch(/target/i);
  });

  test('no second mark is drawn when the floor equals the target (a person who does not exercise)', async () => {
    await putProfile({ ...ownerProfile, activityLevel: 'sedentary' });
    await seedEntry({ nutrients: { ...fullDay.nutrients }, coverage: { ...fullDay.coverage } });
    render(<Missing />);
    const bar = await screen.findByTestId('bar-proteinG');
    expect(bar.querySelector('[data-mark="second"]')).toBeNull();
  });

  test('no second mark when an overridden protein target sits within a gram of the floor', async () => {
    await putProfile({ ...ownerProfile, activityLevel: 'moderate', overrides: { proteinG: 67 } }); // floor is 66 g
    await seedEntry({ nutrients: { ...fullDay.nutrients }, coverage: { ...fullDay.coverage } });
    render(<Missing />);
    const bar = await screen.findByTestId('bar-proteinG');
    expect(bar.textContent).toMatch(/target 67 g/);
    expect(bar.querySelector('[data-mark="second"]')).toBeNull();
  });

  test('characterisation: the weekly gap list covers floors only (structural, independent of any data)', () => {
    expect(MICRO_ORDER.length).toBeGreaterThan(0);
    for (const key of MICRO_ORDER) expect(directionOf(key), key).toBe('floor');
  });
});

describe('the screens and the warning engine agree about the energy figure', () => {
  async function seedBurn(kcal: number, count: number) {
    const t = new Date();
    const keys = lastNDayKeys(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1, 12), 7).reverse();
    for (const date of keys.slice(0, count)) await putHealthDay({ date, energyBurnedKcal: kcal });
  }

  /** The energy target the rules receive through useEntryFlow's path, captured by a rule that stays silent. */
  async function targetSeenByRules(): Promise<number> {
    const seen: number[] = [];
    const probe: Rule = {
      id: 'probe', title: 'Probe', category: 'nutrition', level: (ctx) => { seen.push(ctx.targets.energyKcal); return null; },
      concern: 'c', cause: 'c', horizon: 'both', portionNote: () => '', requiresNutrients: [], scope: 'entry',
      evidence: { strength: 'strong', body: 'B', summary: 's', isAssociational: false, citation: { title: 't', publisher: 'B', year: 2020, url: 'https://example.org', conclusion: 'c' } },
    };
    const food: DatasetFood = {
      id: 'apple', name: 'apple', synonyms: [], per100g: { energyKcal: 52 }, portions: [{ label: 'one', grams: 100 }], allergens: [],
      classification: { ...flags, fruit: true },
    };
    const deps: FlowDeps = {
      ...defaultDeps, rules: [probe], loadData: async () => undefined, isDataReady: () => true,
      lookup: { search: (q) => (q.includes('apple') ? [{ source: 'dataset' as const, food, score: 0.03 }] : []), get: (_s, id) => (id === 'apple' ? food : undefined) },
    };
    function Harness() {
      const flow = useEntryFlow(deps);
      return <button onClick={() => void flow.submit('an apple')}>go</button>;
    }
    render(<Harness />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'go' })); });
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    cleanup();
    return seen[0]!;
  }

  test('the warning engine sees the same energy target the screen shows', async () => {
    await putProfile(ownerProfile);
    await seedBurn(3000, 5);
    const reported = computeTargets(ownerProfile, new Date(), 3000).energyKcal;
    expect(reported).not.toBe(computeTargets(ownerProfile, new Date()).energyKcal);

    expect(await targetSeenByRules()).toBe(reported);

    render(<Missing />);
    const bar = await screen.findByTestId('own-targets-note');
    expect(bar).toBeInTheDocument();
    // The energy row is drawn against the same figure the rules received.
    const energyRow = (await screen.findAllByText(new RegExp(`${reported.toLocaleString('en')}|${reported}`)))[0];
    expect(energyRow).toBeDefined();
  });

  test('with too few reported days the rules fall back to the formula figure', async () => {
    await putProfile(ownerProfile);
    await seedBurn(3000, 3);
    expect(await targetSeenByRules()).toBe(computeTargets(ownerProfile, new Date()).energyKcal);
  });

  test('a raw figure no day produces reaches neither the rules nor the screen', async () => {
    await putProfile(ownerProfile);
    await seedBurn(1e308, 7);
    expect(await targetSeenByRules()).toBe(computeTargets(ownerProfile, new Date()).energyKcal);
  });

  test('the Missing screen and Settings say the same sentence about the energy source', async () => {
    await putProfile(ownerProfile);
    await seedBurn(3000, 5);
    render(<Missing />);
    const onMissing = (await screen.findByTestId('energy-source')).textContent;
    cleanup();
    render(<ProfileSettings />);
    const line = await screen.findByText(/^Energy:/);
    expect(onMissing).toBe(line.textContent);
    expect(onMissing).toMatch(/5 of the last 7 days/);
  });
});
