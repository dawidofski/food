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

async function seed(over: Partial<DiaryEntry> = {}): Promise<DiaryEntry> {
  const e: DiaryEntry = {
    id: globalThis.crypto.randomUUID(),
    at: new Date().toISOString(),
    rawText: 'a slice of toast',
    resolution: 'local',
    items: [{ source: 'dataset', foodId: 'not-in-the-database', grams: 40, classification: flags }],
    nutrients: { energyKcal: 100, sodiumMg: 150 },
    coverage: { energyKcal: 'known', sodiumMg: 'known' },
    classification: flags,
    warningsShown: [],
    userAction: 'added',
    state: 'active',
    ...over,
  };
  await addEntry(e);
  return e;
}

async function openForm(e: DiaryEntry, onChanged: () => void = () => {}) {
  render(<EntryDetail entry={e} deps={realDeps} onClose={() => {}} onChanged={onChanged} />);
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /correct the figures/i })); });
}
const field = (name: RegExp) => screen.getByLabelText(name) as HTMLInputElement;
const type = (name: RegExp, value: string) => fireEvent.change(field(name), { target: { value } });
const save = async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save figures/i })); }); };

describe('correcting figures from the entry screen', () => {
  test('each field pre-fills with the figure the entry holds', async () => {
    await openForm(await seed());
    expect(field(/energy/i).value).toBe('100');
    expect(field(/sodium/i).value).toBe('150');
  });

  test('a field the app does not know is blank, not zero', async () => {
    await openForm(await seed());
    for (const n of [/protein/i, /fibre/i, /saturated fat/i, /added sugars/i]) expect(field(n).value).toBe('');
  });

  test('emptying a field that had a value clears it, and a blank one left blank changes nothing', async () => {
    const e = await seed();
    await openForm(e);
    type(/sodium/i, '');
    await save();
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /add anyway/i })); });
    await waitFor(async () => expect(await allEntriesIncludingTombstones()).toHaveLength(2));
    const revision = (await allEntriesIncludingTombstones()).find((x) => x.id !== e.id)!;
    expect('sodiumMg' in revision.nutrients).toBe(false);
    expect(revision.coverage.sodiumMg).toBe('unknown');
    expect(revision.nutrients.energyKcal).toBe(100);
    expect('proteinG' in revision.nutrients).toBe(false);
    expect(revision.correctedKeys ?? []).not.toContain('proteinG');
  });

  test('saving opens the gate rather than writing straight away', async () => {
    const e = await seed();
    await openForm(e);
    type(/sodium/i, '6000');
    await save();
    expect(await screen.findByTestId('warning-gate')).toBeInTheDocument();
    const all = await allEntriesIncludingTombstones();
    expect(all).toHaveLength(1);
    expect(all[0]!.nutrients.sodiumMg).toBe(150);
  });

  test('the form says a blank field means unknown', async () => {
    await openForm(await seed());
    expect(screen.getByText(/blank field means the figure is unknown, not zero/i)).toBeInTheDocument();
  });

  test('a negative or non-finite value is refused at the form with a message, and nothing is run', async () => {
    const e = await seed();
    await openForm(e);
    type(/sodium/i, '-5');
    await save();
    expect(screen.getByRole('alert')).toHaveTextContent(/zero or more/i);
    expect(screen.queryByTestId('warning-gate')).toBeNull();
    expect(await allEntriesIncludingTombstones()).toHaveLength(1);
  });

  test('only the fields that changed are sent, so a figure corrected elsewhere is not dropped', async () => {
    const e = await seed({
      nutrients: { energyKcal: 100, sodiumMg: 150, calciumMg: 80 },
      coverage: { energyKcal: 'known', sodiumMg: 'known', calciumMg: 'known' },
      correctedKeys: ['calciumMg'],
    });
    await openForm(e);
    type(/energy/i, '120');
    await save();
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /add anyway/i })); });
    await waitFor(async () => expect(await allEntriesIncludingTombstones()).toHaveLength(2));
    const revision = (await allEntriesIncludingTombstones()).find((x) => x.id !== e.id)!;
    expect(revision.nutrients.energyKcal).toBe(120);
    expect(revision.nutrients.calciumMg).toBe(80);
    expect([...(revision.correctedKeys ?? [])].sort()).toEqual(['calciumMg', 'energyKcal']);
  });

  test('which figures were corrected is said in visible text, and an unknown key does not crash', async () => {
    const e = await seed({ correctedKeys: ['sodiumMg', 'futureKey' as never] });
    render(<EntryDetail entry={e} deps={realDeps} onClose={() => {}} onChanged={() => {}} />);
    expect(screen.getByText(/you corrected sodium by hand/i)).toBeInTheDocument();
  });

  test('several corrected figures are joined with "and"', async () => {
    const e = await seed({ correctedKeys: ['sodiumMg', 'energyKcal', 'proteinG'] });
    render(<EntryDetail entry={e} deps={realDeps} onClose={() => {}} onChanged={() => {}} />);
    expect(screen.getByText(/you corrected sodium, energy and protein by hand/i)).toBeInTheDocument();
  });

  test('an entry whose only corrected key is unknown shows no corrected paragraph', async () => {
    const e = await seed({ correctedKeys: ['futureKey' as never] });
    render(<EntryDetail entry={e} deps={realDeps} onClose={() => {}} onChanged={() => {}} />);
    expect(screen.queryByText(/you corrected/i)).toBeNull();
    expect(screen.queryByTestId('corrected')).toBeNull();
  });

  test('a non-finite value is refused at the form', async () => {
    // jsdom sanitises "1e999" to '' like a browser does, and a browser reports badInput for it; stub that report.
    const e = await seed();
    await openForm(e);
    Object.defineProperty(field(/sodium/i), 'validity', { configurable: true, get: () => ({ badInput: true }) });
    type(/sodium/i, '1e999');
    await save();
    expect(screen.getByRole('alert')).toHaveTextContent(/not a number yet/i);
    expect(await allEntriesIncludingTombstones()).toHaveLength(1);
  });

  test('half-typed text is refused rather than read as an emptied field', async () => {
    const e = await seed();
    await openForm(e);
    const input = field(/sodium/i);
    Object.defineProperty(input, 'validity', { configurable: true, get: () => ({ badInput: true }) });
    type(/sodium/i, '');
    await save();
    expect(screen.getByRole('alert')).toHaveTextContent(/not a number yet/i);
    expect(screen.queryByTestId('warning-gate')).toBeNull();
    expect(await allEntriesIncludingTombstones()).toHaveLength(1);
  });

  test('the blank-field sentence is true for any figure, typed or from the database', async () => {
    await openForm(await seed());
    expect(screen.getByText(/emptying a field makes that figure unknown/i)).toBeInTheDocument();
  });

  test('after half-typed text is cleared, the field reads as emptied and the save is accepted', async () => {
    const e = await seed();
    await openForm(e);
    let bad = true;
    Object.defineProperty(field(/sodium/i), 'validity', { configurable: true, get: () => ({ badInput: bad }) });
    type(/sodium/i, '');
    await save();
    expect(screen.getByRole('alert')).toHaveTextContent(/not a number yet/i);
    bad = false; // the person clears the field: the DOM flips with no React change event
    await save();
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /add anyway/i })); });
    await waitFor(async () => expect(await allEntriesIncludingTombstones()).toHaveLength(2));
    const revision = (await allEntriesIncludingTombstones()).find((r) => r.id !== e.id)!;
    expect('sodiumMg' in revision.nutrients).toBe(false);
  });
});
