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
    // Nothing is in the diary while the gate is still open: the confirmation is what stores it.
    expect((await allEntriesIncludingTombstones()).filter((e) => e.state === 'active')).toHaveLength(0);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /add anyway/i })); });
    const { datasetLookup } = await import('@/data/datasetLookup');
    const expected = (datasetLookup.get('dataset', realId)?.per100g.energyKcal ?? 0) * 2;
    expect(expected).toBeGreaterThan(0);
    await waitFor(async () => {
      const rows = (await allEntriesIncludingTombstones()).filter((e) => e.state === 'active');
      expect(rows).toHaveLength(1);
      // Exactly 200 g of that food's own figure, worked out just now — not a stored total, not one natural
      // serving, and not the food the meal's name would have matched.
      expect(rows[0]?.nutrients.energyKcal).toBeCloseTo(expected, 6);
      expect(rows[0]?.items.map((i) => [i.foodId, i.grams])).toEqual([[realId, 200]]);
      // The text is the food and its weight, not the meal's name: "Log again" on this row must not send the
      // words "my usual rice" back through the search.
      expect(rows[0]?.rawText).not.toMatch(/my usual rice/);
      expect(rows[0]?.rawText).toMatch(/200 g /);
    }, { timeout: 10000 });
  }, 40000);

  test('says so and logs nothing when every food is gone', async () => {
    await putSavedMeal({
      id: 'm2', name: 'vanished meal', savedAt: new Date().toISOString(),
      refs: [{ source: 'dataset', foodId: 'no-such-food', grams: 200, classification: flags }],
    });
    render(<Log deps={realDeps} />);
    const log = await screen.findByRole('button', { name: 'Log vanished meal' }, { timeout: 8000 });
    await act(async () => { fireEvent.click(log); });
    expect(await screen.findByRole('alert', undefined, { timeout: 10000 })).toHaveTextContent(/nothing in .* is among your foods any more, so nothing was logged/i);
    expect((await allEntriesIncludingTombstones()).filter((e) => e.state === 'active')).toHaveLength(0);
  }, 40000);

  test('logs NOTHING when only one of its foods is gone, and says which count', async () => {
    // The dangerous case: the meal still has a usable food, so the tempting thing is to log that one. An entry
    // holding part of the meal would carry coverage 'known' and read as a complete total.
    await putSavedMeal({
      id: 'm3', name: 'half a meal', savedAt: new Date().toISOString(),
      refs: [
        { source: 'dataset', foodId: realId, grams: 200, classification: flags },
        { source: 'custom', foodId: 'deleted-food', grams: 100, classification: flags },
      ],
    });
    render(<Log deps={realDeps} />);
    const log = await screen.findByRole('button', { name: 'Log half a meal' }, { timeout: 8000 });
    await act(async () => { fireEvent.click(log); });
    expect(await screen.findByRole('alert', undefined, { timeout: 10000 })).toHaveTextContent(/1 of the 2 foods in .* is not among your foods any more. Nothing was logged/i);
    // No gate of ANY kind may open — not the confirmation and not a safety question. Asserting "has not
    // opened yet" would pass for any entry still resolving, so this waits for one and requires the wait to
    // time out. With the refusal removed, the rice alone reaches the rice-reheating question and this goes red.
    await expect(
      waitFor(
        () => {
          const open = screen.queryByRole('button', { name: /add anyway/i }) ?? screen.queryByRole('button', { name: /^no$/i });
          if (!open) throw new Error('no gate open yet');
          return open;
        },
        { timeout: 4000 },
      ),
    ).rejects.toBeTruthy();
    expect((await allEntriesIncludingTombstones()).filter((e) => e.state === 'active')).toHaveLength(0);
  }, 40000);
});
