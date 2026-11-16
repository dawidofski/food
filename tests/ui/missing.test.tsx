import 'fake-indexeddb/auto';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { addEntry, eraseEverything, putProfile } from '@/data/db';
import type { DiaryEntry } from '@/types/diary';
import type { ClassificationFlags } from '@/types/nutrients';
import Missing from '@/ui/screens/Missing';
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

describe('the protein and fibre targets are labelled as the app\'s own', () => {
  test('the Missing screen says the energy, protein and fibre targets are not a published recommendation', async () => {
    await putProfile(ownerProfile);
    render(<Missing />);
    const note = await screen.findByTestId('own-targets-note');
    expect(note.textContent).toMatch(/own working figures[^.]*not a published recommendation/i);
    expect(note.textContent).toMatch(/WHO advises at least 25 g of fibre/i);
  });
});
