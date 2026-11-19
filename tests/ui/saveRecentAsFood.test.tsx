import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { addEntry, allCustomFoods, eraseEverything, putProfile } from '@/data/db';
import { loadFoods, resetFoodRepository } from '@/data/foodRepository';
import { defaultDeps, type FlowDeps } from '@/state/useEntryFlow';
import type { DiaryEntry } from '@/types/diary';
import type { ClassificationFlags } from '@/types/nutrients';
import Log from '@/ui/screens/Log';
import { ownerProfile } from '../fixtures/profile';

const fromDisk = (async (url: string) => {
  const rel = String(url).replace(import.meta.env.BASE_URL, '');
  return { ok: true, status: 200, text: async () => readFileSync(resolve(__dirname, '../../public', rel), 'utf8') } as Response;
}) as typeof fetch;

const realDeps: FlowDeps = { ...defaultDeps, loadData: () => loadFoods(fromDisk) };

const flags: ClassificationFlags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};

beforeAll(async () => { resetFoodRepository(); await loadFoods(fromDisk); }, 60_000);
beforeEach(async () => { await eraseEverything(); await putProfile(ownerProfile); });
afterEach(cleanup);

async function seed(over: Partial<DiaryEntry> = {}) {
  await addEntry({
    id: globalThis.crypto.randomUUID(),
    at: new Date().toISOString(),
    rawText: 'my usual porridge',
    resolution: 'local',
    items: [{ source: 'dataset', foodId: 'x', grams: 250, classification: flags }],
    nutrients: { energyKcal: 325, proteinG: 12.5, satFatG: 3 },
    coverage: { energyKcal: 'known', proteinG: 'known', satFatG: 'known' },
    classification: flags,
    warningsShown: [],
    userAction: 'added',
    state: 'active',
    ...over,
  });
}

const open = async () => {
  render(<Log deps={realDeps} />);
  // Found outside act: awaiting inside it swallows testing-library's retries while the recent list loads.
  const save = await screen.findByRole('button', { name: /save my usual porridge to my foods/i }, { timeout: 8000 });
  await act(async () => { fireEvent.click(save); });
};

describe('saving something you logged as one of your foods', () => {
  test('offers it on a recent entry and opens the form filled in', async () => {
    await seed();
    await open();
    expect((screen.getByLabelText(/^name$/i) as HTMLInputElement).value).toMatch(/usual porridge/i);
    // 325 kcal across 250 g is 130 per 100 g.
    expect((screen.getByLabelText(/energy/i) as HTMLInputElement).value).toBe('130');
    expect((screen.getByLabelText(/protein/i) as HTMLInputElement).value).toBe('5');
  });

  test('leaves a figure the entry could only vouch for as a floor empty, and says why', async () => {
    await seed({ coverage: { energyKcal: 'known', proteinG: 'known', satFatG: 'partial' } });
    await open();
    expect((screen.getByLabelText(/saturated fat/i) as HTMLInputElement).value).toBe('');
    expect(screen.getByText(/could only vouch for as a floor is left empty/i)).toBeInTheDocument();
  });

  test('saves it so it can be found by name later', async () => {
    await seed();
    await open();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^save food$/i })); });
    await waitFor(async () => {
      const foods = await allCustomFoods();
      expect(foods).toHaveLength(1);
      expect(foods[0]?.nutrientsPer100g.energyKcal).toBe(130);
      expect(foods[0]?.referencePortion.grams).toBe(250);
    });
  });

  test('refuses an entry with no weight behind it rather than inventing one', async () => {
    // The store itself rejects a non-finite gram figure, so the reachable case is an entry carrying no food
    // refs at all: there is no denominator, and inventing one would put a made-up table in their own foods.
    await seed({ items: [] });
    render(<Log deps={realDeps} />);
    const save = await screen.findByRole('button', { name: /save my usual porridge to my foods/i }, { timeout: 8000 });
    await act(async () => { fireEvent.click(save); });
    expect(await screen.findByRole('alert')).toHaveTextContent(/no weight behind it/i);
    expect(screen.queryByLabelText(/^name$/i)).toBeNull();
  });
});
