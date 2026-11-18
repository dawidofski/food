import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { eraseEverything, putProfile } from '@/data/db';
import { loadFoods, resetFoodRepository } from '@/data/foodRepository';
import { skipSetup } from '@/state/setup';
import App from '@/App';
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
  skipSetup();
});
afterEach(cleanup);

describe('logging from the sheet, then looking at the diary behind it', () => {
  test('the day shows the food straight away, with no reload', async () => {
    // Logging used to be a tab, so returning to the diary remounted it. As an overlay it closes over a diary
    // that never unmounted — so without a reload the person logs a meal, closes the sheet and reads "Nothing
    // logged on this day" about food that is already saved. Found by using the deployed app, not by a test.
    render(<App />);
    await screen.findByRole('heading', { name: /^diary$/i });
    // Wait for the day to have loaded before claiming it is empty.
    await screen.findByTestId('meal-breakfast', undefined, { timeout: 8000 });
    expect(screen.getByText(/nothing logged on this day/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Log what you ate' }));
    const sheet = await screen.findByRole('dialog', { name: 'Log what you ate' });
    fireEvent.change(within(sheet).getByRole('textbox'), { target: { value: 'two eggs' } });
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: /^log$/i })); });

    // Pass the gate if it appears; a quiet entry commits on its own.
    await waitFor(() => expect(screen.getByText(/added\.|add anyway/i)).toBeInTheDocument(), { timeout: 8000 });
    const anyway = screen.queryByRole('button', { name: /add anyway/i });
    if (anyway) await act(async () => { fireEvent.click(anyway); });
    await screen.findByText(/added\./i, undefined, { timeout: 8000 });

    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Close' })); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // The diary behind must now know about it.
    await waitFor(() => expect(screen.queryByText(/nothing logged on this day/i)).toBeNull(), { timeout: 8000 });
    expect(await screen.findByText(/two eggs/i)).toBeInTheDocument();
  }, 40000);
});
