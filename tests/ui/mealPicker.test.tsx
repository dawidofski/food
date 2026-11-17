import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { addEntry, allEntriesIncludingTombstones, eraseEverything, putProfile } from '@/data/db';
import { loadFoods, resetFoodRepository } from '@/data/foodRepository';
import { defaultDeps, type FlowDeps } from '@/state/useEntryFlow';
import type { DiaryEntry } from '@/types/diary';
import type { ClassificationFlags } from '@/types/nutrients';
import EntryDetail from '@/ui/screens/EntryDetail';
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

function entryOf(over: Partial<DiaryEntry> = {}): DiaryEntry {
  return {
    id: globalThis.crypto.randomUUID(),
    at: new Date().toISOString(),
    rawText: 'an apple',
    resolution: 'local',
    items: [{ source: 'dataset', foodId: 'x', grams: 100, classification: flags }],
    nutrients: { energyKcal: 52 },
    coverage: { energyKcal: 'known' },
    classification: flags,
    warningsShown: [],
    userAction: 'added',
    state: 'active',
    ...over,
  };
}

const live = async () => (await allEntriesIncludingTombstones()).filter((e) => e.state === 'active');

describe('choosing a meal slot after saving', () => {
  test('offers the four slots and marks the one in force', async () => {
    const e = entryOf({ meal: 'dinner' });
    await addEntry(e);
    render(<EntryDetail entry={e} deps={realDeps} onClose={() => undefined} onChanged={() => undefined} />);
    for (const label of ['Breakfast', 'Lunch', 'Dinner', 'Snack']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Dinner' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Lunch' })).toHaveAttribute('aria-pressed', 'false');
  });

  test("says on screen that a suggested slot uses the app's own times, without claiming this one was guessed", async () => {
    const e = entryOf({ meal: 'lunch' });
    await addEntry(e);
    render(<EntryDetail entry={e} deps={realDeps} onClose={() => undefined} onChanged={() => undefined} />);
    // Said on screen, not only in a comment: the boundaries are this app's choice, not a published definition.
    expect(screen.getByText(/this app’s own working times for meals\s+rather than a published definition/)).toBeInTheDocument();
    // Nothing stored says whether this entry's slot was the clock's guess or the person's own pick, so the
    // screen must not assert either about it.
    const note = screen.getByText(/A slot is suggested from the time/);
    expect(note.textContent).not.toMatch(/Suggested from the time you logged it/);
  });

  test('does not offer the picker while a correction is waiting at the warning gate', async () => {
    const e = entryOf({ meal: 'lunch' });
    await addEntry(e);
    render(<EntryDetail entry={e} deps={realDeps} onClose={() => undefined} onChanged={() => undefined} />);
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /correct the figures/i })); });
    fireEvent.change(screen.getByLabelText(/energy/i), { target: { value: '70' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save figures/i })); });
    await screen.findByRole('button', { name: /add anyway/i });
    // Changing the slot here would supersede the row the pending correction is about and discard it.
    expect(screen.getByRole('button', { name: 'Dinner' })).toBeDisabled();
  });

  test('keeps the slot the person chose when the text is corrected, and invents none for an entry that had none', async () => {
    // The text path goes through submit(), which does not set `kept`. Before this was fixed it recomputed the
    // slot from the clock: a chosen slot was silently replaced, and an entry from before slots existed had one
    // guessed onto it from its timestamp, which the field's own contract forbids.
    const chosen = entryOf({ meal: 'snack', rawText: 'an apple' });
    await addEntry(chosen);
    render(<EntryDetail entry={chosen} deps={realDeps} onClose={() => undefined} onChanged={() => undefined} />);
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /^edit$/i })); });
    fireEvent.change(screen.getByLabelText(/correct what you ate/i), { target: { value: 'two apples' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save/i })); });
    // The gate only appears when something is worth saying; confirm it if it does.
    const anyway = screen.queryByRole('button', { name: /add anyway/i });
    if (anyway) await act(async () => { fireEvent.click(anyway); });
    await waitFor(async () => expect((await live())[0]?.rawText).toBe('two apples'), { timeout: 4000 });
    expect((await live())[0]?.meal).toBe('snack');
  });

  test('changes the slot and keeps the entry otherwise identical', async () => {
    const e = entryOf({ meal: 'lunch', fped: { vegCupEq: 2, fruitCupEq: 1, wholeGrainOzEq: 0 }, correctedKeys: ['energyKcal'] });
    await addEntry(e);
    render(<EntryDetail entry={e} deps={realDeps} onClose={() => undefined} onChanged={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dinner' }));
    await waitFor(async () => expect((await live())[0]?.meal).toBe('dinner'));
    const [now] = await live();
    expect(now?.rawText).toBe('an apple');
    expect(now?.at).toBe(e.at);
    expect(now?.nutrients).toEqual(e.nutrients);
    expect(now?.fped).toEqual(e.fped);
    expect(now?.correctedKeys).toEqual(['energyKcal']);
    // A revision, not a mutation: the original is kept rather than overwritten.
    const all = await allEntriesIncludingTombstones();
    expect(all.find((r) => r.id === e.id)?.state).toBe('superseded');
  });

  test('keeps the meal slot when the figures are corrected', async () => {
    // The revise path rebuilds the entry field by field, so a field not copied across is silently dropped.
    // That has already happened in this codebase, to hand-typed figures; this is the pin against a repeat.
    const e = entryOf({ meal: 'dinner' });
    await addEntry(e);
    render(<EntryDetail entry={e} deps={realDeps} onClose={() => undefined} onChanged={() => undefined} />);
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /correct the figures/i })); });
    fireEvent.change(screen.getByLabelText(/energy/i), { target: { value: '70' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save figures/i })); });
    // A correction still passes the warning gate: food is never stored silently.
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /add anyway/i })); });
    await waitFor(async () => expect((await live())[0]?.nutrients.energyKcal).toBe(70));
    expect((await live())[0]?.meal).toBe('dinner');
  });
});
