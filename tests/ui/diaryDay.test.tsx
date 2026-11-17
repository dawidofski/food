import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { addEntry, eraseEverything, putProfile } from '@/data/db';
import { loadFoods, resetFoodRepository } from '@/data/foodRepository';
import { defaultDeps, type FlowDeps } from '@/state/useEntryFlow';
import type { DiaryEntry, MealSlot } from '@/types/diary';
import type { ClassificationFlags } from '@/types/nutrients';
import Diary from '@/ui/screens/Diary';
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
  await putProfile(ownerProfile);
});
afterEach(cleanup);

const flags: ClassificationFlags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};

async function seed(over: Partial<DiaryEntry> = {}): Promise<void> {
  await addEntry({
    id: globalThis.crypto.randomUUID(),
    at: new Date().toISOString(),
    rawText: 'something',
    resolution: 'local',
    items: [{ source: 'dataset', foodId: 'x', grams: 100, classification: flags }],
    nutrients: { energyKcal: 100 },
    coverage: { energyKcal: 'known' },
    classification: flags,
    warningsShown: [],
    userAction: 'added',
    state: 'active',
    ...over,
  });
}

const known = (n: Partial<Record<string, number>>) =>
  Object.fromEntries(Object.keys(n).map((k) => [k, 'known'])) as DiaryEntry['coverage'];

async function show() {
  render(<Diary deps={realDeps} />);
  await waitFor(() => expect(screen.getByTestId('meal-breakfast')).toBeInTheDocument());
}

describe('the diary shows one day whole', () => {
  test('puts the day figures above the food and the food above sleep and steps', async () => {
    await seed({ meal: 'breakfast' });
    await show();
    const figures = screen.getByTestId('figures-provenance');
    const breakfast = screen.getByTestId('meal-breakfast');
    const health = screen.getByText('Sleep, steps and energy burned');
    // DOCUMENT_POSITION_FOLLOWING: the second argument comes after the first.
    expect(figures.compareDocumentPosition(breakfast) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(breakfast.compareDocumentPosition(health) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('shows each meal with its own energy and protein', async () => {
    await seed({ meal: 'breakfast', rawText: 'toast', nutrients: { energyKcal: 320, proteinG: 12 }, coverage: known({ energyKcal: 0, proteinG: 0 }) });
    await seed({ meal: 'dinner', rawText: 'pork belly', nutrients: { energyKcal: 880, proteinG: 52 }, coverage: known({ energyKcal: 0, proteinG: 0 }) });
    await show();
    const b = within(screen.getByTestId('meal-breakfast'));
    expect(b.getByText('320 kcal')).toBeInTheDocument();
    expect(b.getByText(/12 g/)).toBeInTheDocument();
    expect(b.getByText('toast')).toBeInTheDocument();
    const d = within(screen.getByTestId('meal-dinner'));
    expect(d.getByText('880 kcal')).toBeInTheDocument();
    expect(d.getByText(/52 g/)).toBeInTheDocument();
  });

  test('shows an empty slot as a dash, not a zero', async () => {
    await seed({ meal: 'breakfast', nutrients: { energyKcal: 320 }, coverage: known({ energyKcal: 0 }) });
    await show();
    const snack = within(screen.getByTestId('meal-snack'));
    expect(snack.getByText('—')).toBeInTheDocument();
    expect(snack.queryByText(/0 kcal/)).toBeNull();
    expect(snack.queryByText(/\b0 g/)).toBeNull();
  });

  test('says at least for a slot one of whose entries had no saturated fat figure', async () => {
    await seed({ meal: 'dinner', nutrients: { energyKcal: 500, satFatG: 19 }, coverage: known({ energyKcal: 0, satFatG: 0 }) });
    await seed({ meal: 'dinner', nutrients: { energyKcal: 300 }, coverage: known({ energyKcal: 0 }) });
    await show();
    const d = within(screen.getByTestId('meal-dinner'));
    expect(d.getByText(/at least 19 g/)).toBeInTheDocument();
  });

  test('shows nothing for a slot whose entries all lack a figure', async () => {
    await seed({ meal: 'lunch', nutrients: { energyKcal: 400 }, coverage: known({ energyKcal: 0 }) });
    await show();
    const l = within(screen.getByTestId('meal-lunch'));
    expect(l.getByText('400 kcal')).toBeInTheDocument();
    // No saturated-fat figure at all for this slot — not "0 g", and not "at least 0 g".
    expect(l.queryByText(/0 g/)).toBeNull();
    expect(l.queryByText(/at least/)).toBeNull();
  });

  test('heads unslotted entries Earlier, and only when there are some', async () => {
    await seed({ meal: 'lunch' });
    await show();
    expect(screen.queryByTestId('meal-earlier')).toBeNull();
    cleanup();
    await seed({ rawText: 'an older entry' });
    await show();
    const e = within(screen.getByTestId('meal-earlier'));
    expect(e.getByText('an older entry')).toBeInTheDocument();
  });

  test('puts an entry whose slot this build does not know under Earlier rather than dropping it', async () => {
    await seed({ rawText: 'brunchy thing', meal: 'brunch' as MealSlot });
    await show();
    const e = within(screen.getByTestId('meal-earlier'));
    expect(e.getByText('brunchy thing')).toBeInTheDocument();
  });
});
