import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { allEntriesIncludingTombstones, eraseEverything, putProfile } from '@/data/db';
import { loadFoods, resetFoodRepository } from '@/data/foodRepository';
import { setAiSwitch, setApiKey } from '@/state/aiSettings';
import { defaultDeps, type FlowDeps } from '@/state/useEntryFlow';
import Log from '@/ui/screens/Log';
import { ownerProfile } from '../fixtures/profile';

const fromDisk = (async (url: string) => {
  const rel = String(url).replace(import.meta.env.BASE_URL, '');
  const body = readFileSync(resolve(__dirname, '../../public', rel), 'utf8');
  return { ok: true, status: 200, text: async () => body } as Response;
}) as typeof fetch;

beforeAll(async () => {
  resetFoodRepository();
  await loadFoods(fromDisk);
}, 60_000);

beforeEach(async () => {
  await eraseEverything();
  await putProfile(ownerProfile);
  setApiKey('k');
  setAiSwitch(true);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** Deps whose dish breakdown answers with components, and whose phrase lookup never finds anything. */
const withDish = (): FlowDeps => ({
  ...defaultDeps,
  loadData: () => loadFoods(fromDisk),
  ai: {
    isEnabled: () => true,
    getKey: () => 'k',
    isOnline: () => true,
    interpret: vi.fn(async () => []),
    breakDownDish: vi.fn(async () => [
      { description: 'boiled white rice', quantity: 9000, unit: 'g' },
      { description: 'chicken breast', quantity: 250, unit: 'g' },
    ]),
  },
});

const live = async () => (await allEntriesIncludingTombstones()).filter((e) => e.state === 'active');

async function askForDish() {
  render(<Log deps={withDish()} />);
  fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'zzqqxx dish' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^log$/i })); });
  const ask = await screen.findByRole('button', { name: /work out what/i }, { timeout: 8000 });
  await act(async () => { fireEvent.click(ask); });
}

describe('breaking a dish down', () => {
  test('the amounts are shown for checking and nothing is saved until the person agrees', async () => {
    // The defect this pins: the dish path committed straight through the gate, so amounts the model invented
    // — here a deliberately absurd 9 kg of rice — reached the diary with nobody having seen them.
    await askForDish();
    await screen.findByTestId('ai-review', undefined, { timeout: 8000 });
    expect(await live()).toHaveLength(0);
    expect(screen.getByRole('button', { name: /use this reading/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /don.t use it/i })).toBeInTheDocument();
  }, 30000);

  test('it says the amounts are the AI’s guess, not the database’s', async () => {
    await askForDish();
    const panel = await screen.findByTestId('ai-review', undefined, { timeout: 8000 });
    const said = panel.textContent ?? '';
    expect(said).toMatch(/AMOUNTS are the AI/);
    expect(said).toMatch(/starting point/i);
    // The phrase path's sentence would be false here, so it must not be the one shown.
    expect(said).not.toMatch(/The amounts below come from the database, not from the AI/);
  }, 30000);

  test('declining it saves nothing and returns to adding it yourself', async () => {
    await askForDish();
    await screen.findByTestId('ai-review', undefined, { timeout: 8000 });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /don.t use it/i })); });
    await waitFor(() => expect(screen.queryByTestId('ai-review')).toBeNull());
    expect(await live()).toHaveLength(0);
  }, 30000);
});
