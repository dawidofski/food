import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { addEntry, allEntriesIncludingTombstones, entriesBetween, eraseEverything, putProfile } from '@/data/db';
import { loadFoods, resetFoodRepository } from '@/data/foodRepository';
import { localDayKey, localDayRange } from '@/domain/dayBoundary';
import { defaultDeps, type FlowDeps } from '@/state/useEntryFlow';
import type { DiaryEntry } from '@/types/diary';
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

async function seed(over: Partial<DiaryEntry> = {}): Promise<DiaryEntry> {
  const e: DiaryEntry = {
    id: globalThis.crypto.randomUUID(),
    at: new Date().toISOString(),
    rawText: 'an apple',
    resolution: 'local',
    items: [{ source: 'dataset', foodId: 'x', grams: 100, classification: flags }],
    nutrients: { energyKcal: 52, sodiumMg: 1 },
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

async function entriesToday() {
  const { fromISO, toISO } = localDayRange(localDayKey(new Date()));
  return entriesBetween(fromISO, toISO);
}
async function press(name: RegExp | string) {
  const b = await screen.findByRole('button', { name });
  await act(async () => { fireEvent.click(b); });
}

describe('diary', () => {
  test('editing an entry re-runs the warning gate', async () => {
    const original = await seed({ rawText: 'an apple' });
    render(<Diary deps={realDeps} />);
    await press(/an apple/i);
    await press(/^edit$/i);
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'three hot dogs' } });
    await press(/save correction/i);

    // The gate is shown BEFORE anything is changed.
    expect(await screen.findByRole('heading', { name: /processed meat/i })).toBeInTheDocument();
    expect((await entriesToday()).map((e) => e.rawText)).toEqual(['an apple']);

    await press(/add anyway/i);
    await waitFor(async () => expect((await entriesToday()).map((e) => e.rawText)).toEqual(['three hot dogs']));
    const all = await allEntriesIncludingTombstones();
    expect(all).toHaveLength(2);
    expect(all.find((e) => e.id === original.id)?.state).toBe('superseded');
    const revised = all.find((e) => e.rawText === 'three hot dogs')!;
    expect(revised.revisionOf).toBe(original.id);
    expect(revised.warningsShown.map((w) => w.ruleId)).toContain('processed-meat');
    expect(revised.at).toBe(original.at);
  });

  test('cancelling a correction leaves the original untouched', async () => {
    await seed({ rawText: 'an apple' });
    render(<Diary deps={realDeps} />);
    await press(/an apple/i);
    await press(/^edit$/i);
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'two hot dogs' } });
    await press(/save correction/i);
    await screen.findByRole('heading', { name: /processed meat/i });
    await press(/^cancel$/i);
    await waitFor(() => expect(screen.queryByTestId('warning-gate')).not.toBeInTheDocument());
    expect(await allEntriesIncludingTombstones()).toHaveLength(1);
    expect((await entriesToday())[0]!.rawText).toBe('an apple');
  });

  test('deleting asks first and says what it changes about today', async () => {
    await seed({ rawText: 'two hot dogs', nutrients: { energyKcal: 290, sodiumMg: 1240 }, coverage: { energyKcal: 'known', sodiumMg: 'known' } });
    render(<Diary deps={realDeps} />);
    await press(/two hot dogs/i);
    await press(/^delete$/i);
    expect(await screen.findByText(/remove .*1,?240 mg sodium.* from today/i)).toBeInTheDocument();
    expect(screen.getByText(/today/i)).toBeInTheDocument();
    expect(await entriesToday()).toHaveLength(1); // nothing happened yet
    await press(/keep it/i);
    expect(await entriesToday()).toHaveLength(1);
  });

  test('a deleted entry leaves the diary and the totals but is not destroyed', async () => {
    await seed({ rawText: 'two hot dogs' });
    render(<Diary deps={realDeps} />);
    await press(/two hot dogs/i);
    await press(/^delete$/i);
    await press(/yes, delete it/i);
    await waitFor(async () => expect(await entriesToday()).toHaveLength(0));
    const all = await allEntriesIncludingTombstones();
    expect(all).toHaveLength(1);
    expect(all[0]!.state).toBe('deleted');
    await waitFor(() => expect(screen.queryByRole('button', { name: /two hot dogs/i })).not.toBeInTheDocument());
  });

  test('entry detail shows the warnings that were shown at the time', async () => {
    await seed({ rawText: 'two hot dogs', warningsShown: [{ ruleId: 'processed-meat', level: 'HIGH' }] });
    render(<Diary deps={realDeps} />);
    await press(/two hot dogs/i);
    expect(await screen.findByText(/processed meat/i)).toBeInTheDocument();
    expect(screen.getByText(/shown when you logged this/i)).toBeInTheDocument();
  });

  test('an empty diary renders without NaN', async () => {
    const { container } = render(<Diary deps={realDeps} />);
    await screen.findByText(/nothing logged/i);
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
  });
});
