import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { addEntry, allEntriesIncludingTombstones, allSavedMeals, eraseEverything, putProfile, putSavedMeal } from '@/data/db';
import { loadFoods, resetFoodRepository } from '@/data/foodRepository';
import { defaultDeps, type FlowDeps } from '@/state/useEntryFlow';
import type { ClassificationFlags } from '@/types/nutrients';
import Log from '@/ui/screens/Log';
import { ownerProfile } from '../fixtures/profile';

const fromDisk = (async (u: string) =>
  ({ ok: true, status: 200, text: async () => readFileSync(resolve(__dirname, '../../public', String(u).replace(import.meta.env.BASE_URL, '')), 'utf8') } as Response)) as typeof fetch;
const realDeps: FlowDeps = { ...defaultDeps, loadData: () => loadFoods(fromDisk) };

const flags: ClassificationFlags = {
  processedMeat: false, redMeat: false, sweetDrink: false, alcohol: false, novaGroup: 1,
  refinedGrain: false, vegetable: false, fruit: false, legume: false, oilyFish: false,
};

beforeAll(async () => { resetFoodRepository(); await loadFoods(fromDisk); }, 60_000);
beforeEach(async () => { await eraseEverything(); await putProfile(ownerProfile); });
afterEach(cleanup);

/** A real dataset food id, so a replay can actually find it. */
let realId = '';
beforeAll(async () => {
  const { datasetLookup } = await import('@/data/datasetLookup');
  realId = datasetLookup.search('rice', 5).find((h) => h.source === 'dataset')?.food.id ?? '';
}, 60_000);

const seedEntry = () =>
  addEntry({
    id: globalThis.crypto.randomUUID(), at: new Date().toISOString(), rawText: '200 g rice',
    resolution: 'local', items: [{ source: 'dataset', foodId: realId, grams: 200, classification: flags }],
    nutrients: { energyKcal: 260 }, coverage: { energyKcal: 'known' }, classification: flags,
    warningsShown: [], userAction: 'added', state: 'active',
  });

describe('saving a meal from something you logged', () => {
  test('asks for a name and remembers the foods, not their figures', async () => {
    await seedEntry();
    render(<Log deps={realDeps} />);
    const save = await screen.findByRole('button', { name: /save 200 g rice as a meal/i }, { timeout: 8000 });
    await act(async () => { fireEvent.click(save); });
    fireEvent.change(screen.getByLabelText(/call it/i), { target: { value: 'my usual rice' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^save it$/i })); });
    await waitFor(async () => {
      const meals = await allSavedMeals();
      expect(meals).toHaveLength(1);
      expect(meals[0]?.name).toBe('my usual rice');
      expect(meals[0]?.refs).toHaveLength(1);
      // No nutrition is stored, which is the whole point of the shape.
      expect(JSON.stringify(meals[0])).not.toMatch(/energyKcal/);
    });
  }, 30000);

  test('will not save it without a name', async () => {
    await seedEntry();
    render(<Log deps={realDeps} />);
    const save = await screen.findByRole('button', { name: /save 200 g rice as a meal/i }, { timeout: 8000 });
    await act(async () => { fireEvent.click(save); });
    expect(screen.getByRole('button', { name: /^save it$/i })).toBeDisabled();
  }, 30000);
});

describe('logging a saved meal again', () => {
  test('works the figures out fresh and still passes the warning gate', async () => {
    await putSavedMeal({
      id: 'm1', name: 'my usual rice', savedAt: new Date().toISOString(),
      refs: [{ source: 'dataset', foodId: realId, grams: 200, classification: flags }],
    });
    render(<Log deps={realDeps} />);
    const log = await screen.findByRole('button', { name: 'Log my usual rice' }, { timeout: 8000 });
    await act(async () => { fireEvent.click(log); });
    // The gate runs exactly as it does for anything typed: a safety question first where one applies, then
    // the confirmation. Nothing is stored until both are satisfied.
    const gateUp = () => screen.queryByRole('button', { name: /^no$/i }) ?? screen.queryByRole('button', { name: /add anyway/i });
    await waitFor(() => { expect(gateUp()).not.toBeNull(); }, { timeout: 10000 });
    const question = screen.queryByRole('button', { name: /^no$/i });
    if (question) await act(async () => { fireEvent.click(question); });
    await waitFor(() => { expect(screen.queryByRole('button', { name: /add anyway/i })).not.toBeNull(); }, { timeout: 10000 });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /add anyway/i })); });
    await waitFor(async () => {
      const rows = (await allEntriesIncludingTombstones()).filter((e) => e.state === 'active');
      expect(rows).toHaveLength(1);
      // The figure came from the dataset just now, not from anything the meal stored.
      expect(rows[0]?.nutrients.energyKcal).toBeGreaterThan(0);
    }, { timeout: 10000 });
  }, 40000);

  test('says a food is gone rather than logging a smaller meal', async () => {
    await putSavedMeal({
      id: 'm2', name: 'vanished meal', savedAt: new Date().toISOString(),
      refs: [{ source: 'dataset', foodId: 'no-such-food', grams: 200, classification: flags }],
    });
    render(<Log deps={realDeps} />);
    const log = await screen.findByRole('button', { name: 'Log vanished meal' }, { timeout: 8000 });
    await act(async () => { fireEvent.click(log); });
    expect(await screen.findByRole('alert', undefined, { timeout: 10000 })).toHaveTextContent(/none of the foods .* could be found any more, so nothing was logged/i);
    expect((await allEntriesIncludingTombstones()).filter((e) => e.state === 'active')).toHaveLength(0);
  }, 40000);
});
