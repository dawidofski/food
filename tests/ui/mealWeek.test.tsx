import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { eraseEverything } from '@/data/db';
import { defaultTrendsDeps, type TrendsDeps } from '@/ui/screens/WeekTrends';
import WeekTrends from '@/ui/screens/WeekTrends';
import type { DiaryEntry, MealSlot } from '@/types/diary';
import type { ClassificationFlags } from '@/types/nutrients';

const flags: ClassificationFlags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};

const NOW = new Date('2026-11-18T12:00:00');

let seq = 0;
function entry(daysAgo: number, meal: MealSlot, kcal: number, proteinG?: number): DiaryEntry {
  const at = new Date(NOW);
  at.setDate(at.getDate() - daysAgo);
  at.setHours(12, 0, 0, 0);
  return {
    id: `e${++seq}`,
    at: at.toISOString(),
    rawText: `${meal} ${seq}`,
    resolution: 'local',
    items: [{ source: 'dataset', foodId: 'x', grams: 100, classification: flags }],
    nutrients: proteinG === undefined ? { energyKcal: kcal } : { energyKcal: kcal, proteinG },
    coverage: proteinG === undefined ? { energyKcal: 'known' } : { energyKcal: 'known', proteinG: 'known' },
    classification: flags,
    warningsShown: [],
    userAction: 'added',
    state: 'active',
    meal,
  };
}

const depsWith = (rows: DiaryEntry[]): TrendsDeps => ({
  ...defaultTrendsDeps,
  now: () => NOW,
  store: { entriesBetween: async () => rows },
});

beforeEach(async () => { await eraseEverything(); });
afterEach(cleanup);

const mealWeek = async () => {
  await waitFor(() => expect(screen.getByTestId('meal-week')).toBeInTheDocument());
  return within(screen.getByTestId('meal-week'));
};

describe('each meal across the week', () => {
  test('shows an average per slot with the number of days behind it', async () => {
    const rows = [0, 1, 2, 3].map((d) => entry(d, 'breakfast', 300, 12));
    render(<WeekTrends deps={depsWith(rows)} />);
    const w = await mealWeek();
    expect(w.getByText(/Breakfast/)).toBeInTheDocument();
    expect(w.getByText(/300 kcal/)).toBeInTheDocument();
    expect(w.getByText(/12 g protein/)).toBeInTheDocument();
    expect(w.getByText(/4 days/)).toBeInTheDocument();
  });

  test('averages over the days a slot was logged, not over seven', async () => {
    // Two breakfasts of 600 in a seven-day window. Dividing by seven would report 171 kcal and turn five
    // unlogged mornings into five zeroes.
    const rows = [0, 1].map((d) => entry(d, 'breakfast', 600));
    render(<WeekTrends deps={depsWith(rows)} />);
    const w = await mealWeek();
    expect(w.getByText(/600 kcal/)).toBeInTheDocument();
    expect(w.queryByText(/171 kcal/)).toBeNull();
    expect(w.getByText(/2 days/)).toBeInTheDocument();
  });

  test('says nothing for a slot never logged, rather than zero', async () => {
    const rows = [0, 1].map((d) => entry(d, 'dinner', 700));
    render(<WeekTrends deps={depsWith(rows)} />);
    const w = await mealWeek();
    expect(w.getByText(/Dinner/)).toBeInTheDocument();
    expect(w.queryByText(/Breakfast/)).toBeNull();
    // Word-boundary: an unanchored /0 kcal/ matches "700 kcal" and would pass whatever the code did.
    expect(w.queryByText(/\b0 kcal/)).toBeNull();
  });
});
